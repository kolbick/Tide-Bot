from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import re
import time
from typing import Literal
from urllib.parse import parse_qsl, urlsplit
from uuid import uuid4
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import FileResponse
from open_webui.env import ENV, STATIC_DIR, WEBUI_SECRET_KEY
from open_webui.internal.db import get_async_session
from open_webui.models.browser_extension import (
    BrowserPairedDeviceModel,
    BrowserPairedDevices,
    BrowserPairingGrants,
    BrowserScheduleModel,
    BrowserSchedules,
    BrowserWorkflowModel,
    BrowserWorkflows,
)
from open_webui.models.config import Config
from open_webui.models.users import Users
from open_webui.utils.auth import get_verified_user
from open_webui.utils.browser_extension_auth import (
    ACCESS_TOKEN_TTL_SECONDS,
    RefreshCredentialError,
    create_browser_access_token,
    create_pairing_secrets,
    create_refresh_credential,
    decode_refresh_credential,
    validate_server_origin,
)
from open_webui.utils.browser_extension_crypto import (
    decrypt_workflow_definition,
    encrypt_workflow_definition,
    hash_browser_token,
)
from open_webui.utils.browser_extension_permissions import has_browser_extension_permission
from open_webui.utils.rate_limit import RateLimiter
from open_webui.utils.redis import get_redis_client
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter()

DEFAULT_SERVER_ORIGIN = 'https://tide-bot.com'
BROWSER_EXTENSION_ARCHIVE = STATIC_DIR / 'browser-extension' / 'tide-bot-browser-extension.zip'
PAIRING_TTL_SECONDS = 300
PAIRING_POLL_INTERVAL_SECONDS = 2
MAX_DEVICE_LABEL_ATTEMPTS = 5

# Chrome derives this id from the public `key` pinned in the extension manifest,
# so it is identical for every install of the packaged extension. Session-based
# claiming is restricted to it; anything else must use the device-code flow.
BROWSER_EXTENSION_ID = 'pjaanipaolcckdgfjjekkmfnelbkfbaa'

_redis = get_redis_client()
_pairing_start_ip_limiter = RateLimiter(_redis, limit=10, window=300, bucket_size=30)
_pairing_approval_limiter = RateLimiter(_redis, limit=20, window=300, bucket_size=30)
_pairing_poll_grant_limiter = RateLimiter(_redis, limit=90, window=300, bucket_size=30)
_pairing_poll_ip_limiter = RateLimiter(_redis, limit=120, window=300, bucket_size=30)
_refresh_device_limiter = RateLimiter(_redis, limit=60, window=300, bucket_size=30)
_refresh_ip_limiter = RateLimiter(_redis, limit=120, window=300, bucket_size=30)


class BrowserExtensionRuntimeSettings(BaseModel):
    default_permissions: dict = Field(default_factory=lambda: {'features': {'browser_extension': True}})
    custom_origins_unlocked: bool = False
    environment: str = ENV
    default_origin: str = DEFAULT_SERVER_ORIGIN


async def get_browser_extension_runtime_settings() -> BrowserExtensionRuntimeSettings:
    return BrowserExtensionRuntimeSettings(
        default_permissions=(await Config.get('user.permissions', {'features': {'browser_extension': True}})),
        custom_origins_unlocked=bool(await Config.get('browser_extension.custom_origins_unlocked', False)),
        environment=ENV,
        default_origin=(await Config.get('browser_extension.default_origin', DEFAULT_SERVER_ORIGIN)),
    )


class PairingStartForm(BaseModel):
    device_label: str = Field(min_length=1, max_length=80)
    origin: str = Field(min_length=1, max_length=512)
    extension_version: str = Field(min_length=1, max_length=40)

    @field_validator('device_label')
    @classmethod
    def validate_device_label(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError('Device label must not be blank')
        return value


class PairingClaimForm(BaseModel):
    device_label: str = Field(min_length=1, max_length=80)
    origin: str = Field(min_length=1, max_length=512)
    extension_version: str = Field(min_length=1, max_length=40)

    @field_validator('device_label')
    @classmethod
    def validate_device_label(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError('Device label must not be blank')
        return value


class PairingApprovalForm(BaseModel):
    device_code: str = Field(min_length=9, max_length=9)
    approved: bool = True


class PairingTokenForm(BaseModel):
    grant_id: str = Field(min_length=1, max_length=80)
    device_code: str = Field(min_length=9, max_length=9)
    verifier: str = Field(min_length=43, max_length=256)


class RefreshTokenForm(BaseModel):
    refresh_token: str = Field(min_length=80, max_length=2_048)
    origin: str = Field(min_length=1, max_length=512)
    extension_version: str = Field(min_length=1, max_length=40)


class DeviceRenameForm(BaseModel):
    label: str = Field(min_length=1, max_length=80)

    @field_validator('label')
    @classmethod
    def validate_label(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError('Device label must not be blank')
        return value


class BrowserExtensionSettingsForm(BaseModel):
    custom_origins_unlocked: bool


class PairedDeviceResponse(BaseModel):
    id: str
    label: str
    allowed_origin: str
    extension_version: str
    last_seen_at: int | None = None
    revoked_at: int | None = None
    created_at: int
    updated_at: int


class DeviceTokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = 'Bearer'
    expires_in: int = ACCESS_TOKEN_TTL_SECONDS
    token_family_id: str
    device: PairedDeviceResponse


class WorkflowCreateForm(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    definition: dict


class WorkflowUpdateForm(WorkflowCreateForm):
    version: int = Field(ge=1)


class WorkflowResponse(BaseModel):
    id: str
    name: str
    version: int
    definition: dict
    created_at: int
    updated_at: int


class ScheduleForm(BaseModel):
    workflow_id: str = Field(min_length=1, max_length=128)
    device_id: str = Field(min_length=1, max_length=128)
    name: str = Field(min_length=1, max_length=120)
    rrule: str = Field(min_length=1, max_length=256)
    timezone: str = Field(min_length=1, max_length=100)
    is_active: bool = True
    next_run_at: int | None = Field(default=None, ge=1)

    @field_validator('rrule')
    @classmethod
    def validate_rrule(cls, value: str) -> str:
        if not _valid_rrule(value):
            raise ValueError('Unsupported browser schedule rule')
        return value

    @field_validator('timezone')
    @classmethod
    def validate_timezone(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError):
            raise ValueError('Unknown schedule timezone') from None
        return value


class ScheduleResponse(BaseModel):
    id: str
    workflow_id: str
    device_id: str
    name: str
    rrule: str
    timezone: str
    is_active: bool
    last_run_at: int | None
    next_run_at: int | None
    catch_up_pending: bool
    created_at: int
    updated_at: int


class ScheduleRunForm(BaseModel):
    outcome: Literal['complete', 'paused', 'failed']
    last_run_at: int = Field(ge=1)
    next_run_at: int = Field(ge=1)

    @field_validator('next_run_at')
    @classmethod
    def validate_next_run(cls, value: int, info):
        last_run_at = info.data.get('last_run_at')
        if isinstance(last_run_at, int) and value <= last_run_at:
            raise ValueError('Next run must follow the completed run')
        return value


_RRULE_FREQUENCIES = {'MINUTELY', 'HOURLY', 'DAILY', 'WEEKLY'}
_RRULE_KEYS = {'FREQ', 'INTERVAL', 'BYDAY', 'BYHOUR', 'BYMINUTE'}
_TARGET_KEYS = {'role', 'name', 'tag', 'type', 'testId'}


def _valid_rrule(value: str) -> bool:
    parts = [part.split('=', 1) for part in value.split(';')]
    if any(len(part) != 2 for part in parts):
        return False
    rule = dict(parts)
    if len(rule) != len(parts) or set(rule) - _RRULE_KEYS:
        return False
    if rule.get('FREQ') not in _RRULE_FREQUENCIES:
        return False
    interval = rule.get('INTERVAL', '1')
    if not re.fullmatch(r'[1-9][0-9]{0,2}', interval) or int(interval) > 365:
        return False
    if 'BYDAY' in rule and not re.fullmatch(
        r'(?:MO|TU|WE|TH|FR|SA|SU)(?:,(?:MO|TU|WE|TH|FR|SA|SU))*',
        rule['BYDAY'],
    ):
        return False
    if 'BYHOUR' in rule and not re.fullmatch(r'(?:[0-9]|1[0-9]|2[0-3])', rule['BYHOUR']):
        return False
    if 'BYMINUTE' in rule and not re.fullmatch(r'(?:[0-9]|[1-5][0-9])', rule['BYMINUTE']):
        return False
    return True


def _valid_target(value) -> bool:
    if not isinstance(value, dict) or set(value) - _TARGET_KEYS:
        return False
    if not all(isinstance(value.get(key), str) and len(value[key]) <= 256 for key in ('role', 'name', 'tag')):
        return False
    return all(
        key not in value or (isinstance(value[key], str) and len(value[key]) <= limit)
        for key, limit in (('type', 64), ('testId', 128))
    )


def _valid_navigation_url(value) -> bool:
    if not isinstance(value, str) or len(value) > 4096:
        return False
    try:
        parsed = urlsplit(value)
    except ValueError:
        return False
    if parsed.scheme not in {'http', 'https'} or not parsed.hostname or parsed.username or parsed.password:
        return False
    for key, item in parse_qsl(parsed.query, keep_blank_values=True):
        if re.search(r'(?:token|secret|password|passcode|auth|key|session)', key, re.IGNORECASE):
            if item != '%5BREDACTED%5D' and item != '[REDACTED]':
                return False
    return True


def _valid_workflow_origin(value) -> bool:
    if not _valid_navigation_url(value):
        return False
    parsed = urlsplit(value)
    return parsed.path in {'', '/'} and not parsed.query and not parsed.fragment


def _validated_workflow_definition(value: dict) -> dict:
    try:
        encoded_size = len(json.dumps(value, separators=(',', ':')).encode('utf-8'))
    except (TypeError, ValueError):
        encoded_size = 1_000_000
    valid = (
        isinstance(value, dict)
        and set(value) == {'schemaVersion', 'origin', 'steps'}
        and value.get('schemaVersion') == 1
        and isinstance(value.get('origin'), str)
        and len(value['origin']) <= 512
        and _valid_workflow_origin(value['origin'])
        and isinstance(value.get('steps'), list)
        and 0 < len(value['steps']) <= 500
        and encoded_size <= 128_000
    )
    if not valid:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail='invalid_workflow_definition')
    for step in value['steps']:
        if not isinstance(step, dict) or not isinstance(step.get('action'), str):
            raise HTTPException(status_code=422, detail='invalid_workflow_definition')
        action = step['action']
        if action == 'navigate':
            valid_step = set(step) == {'action', 'url'} and _valid_navigation_url(step.get('url'))
        elif action == 'click':
            valid_step = set(step) == {'action', 'target'} and _valid_target(step.get('target'))
        elif action == 'type-intent':
            valid_step = (
                set(step) == {'action', 'target', 'sensitive'}
                and _valid_target(step.get('target'))
                and isinstance(step.get('sensitive'), bool)
            )
        elif action == 'select':
            values = step.get('values')
            valid_step = (
                set(step) == {'action', 'target', 'values'}
                and _valid_target(step.get('target'))
                and isinstance(values, list)
                and len(values) <= 20
                and all(isinstance(item, str) and len(item) <= 256 for item in values)
            )
        else:
            valid_step = action == 'wait' and set(step) == {'action', 'condition'} and step.get('condition') == 'load'
        if not valid_step:
            raise HTTPException(status_code=422, detail='invalid_workflow_definition')
    return value


def _safe_schedule(schedule: BrowserScheduleModel) -> ScheduleResponse:
    return ScheduleResponse.model_validate(schedule, from_attributes=True)


def _safe_workflow(workflow: BrowserWorkflowModel) -> WorkflowResponse:
    definition = decrypt_workflow_definition(
        workflow.encrypted_definition,
        workflow.definition_nonce,
        secret_key=WEBUI_SECRET_KEY,
        user_id=workflow.user_id,
        workflow_id=workflow.id,
        version=workflow.version,
    )
    return WorkflowResponse(
        id=workflow.id,
        name=workflow.name,
        version=workflow.version,
        definition=definition,
        created_at=workflow.created_at,
        updated_at=workflow.updated_at,
    )


def _safe_device(device: BrowserPairedDeviceModel) -> PairedDeviceResponse:
    return PairedDeviceResponse(
        id=device.id,
        label=device.label,
        allowed_origin=device.allowed_origin,
        extension_version=device.extension_version,
        last_seen_at=device.last_seen_at,
        revoked_at=device.revoked_at,
        created_at=device.created_at,
        updated_at=device.updated_at,
    )


def _client_fingerprint(request: Request) -> str:
    address = request.client.host if request.client else 'unknown'
    return hashlib.sha256(address.encode('utf-8')).hexdigest()[:24]


def _check_rate_limit(limiter: RateLimiter, key: str) -> None:
    if limiter.is_limited(key):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail='rate_limited',
            headers={'Retry-After': '30'},
        )


def _validate_origin(origin: str, settings: BrowserExtensionRuntimeSettings) -> str:
    try:
        return validate_server_origin(
            origin,
            default_origin=settings.default_origin,
            custom_origins_unlocked=settings.custom_origins_unlocked,
            environment=settings.environment,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from None


async def _require_browser_permission(
    user,
    settings: BrowserExtensionRuntimeSettings,
    db: AsyncSession,
) -> None:
    if user is None or getattr(user, 'role', None) not in {'user', 'admin'}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='browser_extension_not_allowed')
    if not await has_browser_extension_permission(
        user.id,
        settings.default_permissions,
        db=db,
        user_role=user.role,
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='browser_extension_not_allowed')


def _secret_matches(stored_hash: str, supplied: str) -> bool:
    supplied_hash = hash_browser_token(supplied, WEBUI_SECRET_KEY)
    return hmac.compare_digest(stored_hash, supplied_hash)


def _allowed_extension_origins() -> set[str]:
    return {f'chrome-extension://{BROWSER_EXTENSION_ID}'}


def _sha256_file(path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as archive:
        for chunk in iter(lambda: archive.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def _token_response(
    device: BrowserPairedDeviceModel,
    refresh_token: str,
) -> DeviceTokenResponse:
    return DeviceTokenResponse(
        access_token=create_browser_access_token(
            user_id=device.user_id,
            device_id=device.id,
            token_family_id=device.token_family_id,
            origin=device.allowed_origin,
            secret_key=WEBUI_SECRET_KEY,
        ),
        refresh_token=refresh_token,
        token_family_id=device.token_family_id,
        device=_safe_device(device),
    )


async def _create_paired_device(
    *,
    user_id: str,
    label: str,
    origin: str,
    extension_version: str,
    now_ns: int,
    db: AsyncSession,
) -> tuple[BrowserPairedDeviceModel, str]:
    """Mint a device credential, disambiguating a label the user already holds.

    A revoked device keeps its label forever under the (user_id, label) unique
    constraint, so a stale revoked label cannot be told apart here from a live
    duplicate. Suffix instead of failing, or the extension's fixed default
    label would permanently block re-pairing.
    """
    device_id = str(uuid4())
    token_family_id = str(uuid4())
    refresh_token = create_refresh_credential(
        device_id=device_id,
        token_family_id=token_family_id,
        secret_key=WEBUI_SECRET_KEY,
    )
    for attempt in range(1, MAX_DEVICE_LABEL_ATTEMPTS + 1):
        candidate = label if attempt == 1 else f'{label} ({attempt})'
        try:
            device = await BrowserPairedDevices.insert(
                device_id=device_id,
                user_id=user_id,
                label=candidate,
                refresh_token_hash=hash_browser_token(refresh_token, WEBUI_SECRET_KEY),
                token_family_id=token_family_id,
                allowed_origin=origin,
                extension_version=extension_version,
                now_ns=now_ns,
                db=db,
            )
            return device, refresh_token
        except IntegrityError:
            await db.rollback()
    raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail='device_label_in_use')


@router.post('/pairing/claim', response_model=DeviceTokenResponse)
async def claim_pairing_with_session(
    form_data: PairingClaimForm,
    request: Request,
    user=Depends(get_verified_user),
    settings: BrowserExtensionRuntimeSettings = Depends(get_browser_extension_runtime_settings),
    db: AsyncSession = Depends(get_async_session),
):
    """Pair the packaged extension directly from the caller's signed-in session.

    The device-authorization flow exists for inputs that cannot host a browser.
    This extension runs inside one, beside an authenticated Tide-Bot session, so
    it can prove identity without the verification tab. Only the pinned
    extension origin may claim, which is what keeps another installed extension
    from silently minting a device against the same session.
    """
    client_key = _client_fingerprint(request)
    _check_rate_limit(_pairing_start_ip_limiter, f'browser-pair-claim:{client_key}')
    if request.headers.get('origin') not in _allowed_extension_origins():
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='browser_extension_untrusted_caller')
    await _require_browser_permission(user, settings, db)
    origin = _validate_origin(form_data.origin, settings)
    device, refresh_token = await _create_paired_device(
        user_id=user.id,
        label=form_data.device_label,
        origin=origin,
        extension_version=form_data.extension_version,
        now_ns=time.time_ns(),
        db=db,
    )
    return _token_response(device, refresh_token)


@router.post('/pairing/start')
async def start_pairing(
    form_data: PairingStartForm,
    request: Request,
    settings: BrowserExtensionRuntimeSettings = Depends(get_browser_extension_runtime_settings),
    db: AsyncSession = Depends(get_async_session),
):
    client_key = _client_fingerprint(request)
    _check_rate_limit(_pairing_start_ip_limiter, f'browser-pair-start:{client_key}')
    origin = _validate_origin(form_data.origin, settings)
    pairing_secrets = create_pairing_secrets()
    now = time.time_ns()
    grant = await BrowserPairingGrants.insert(
        device_code_hash=hash_browser_token(pairing_secrets.device_code, WEBUI_SECRET_KEY),
        verifier_hash=hash_browser_token(pairing_secrets.verifier, WEBUI_SECRET_KEY),
        requested_origin=origin,
        device_label=form_data.device_label,
        extension_version=form_data.extension_version,
        expires_at=now + PAIRING_TTL_SECONDS * 1_000_000_000,
        now_ns=now,
        db=db,
    )
    return {
        'grant_id': grant.id,
        'device_code': pairing_secrets.device_code,
        'verifier': pairing_secrets.verifier,
        'verification_uri': f'{origin}/browser-extension/pair?grant_id={grant.id}',
        'interval': PAIRING_POLL_INTERVAL_SECONDS,
        'expires_in': PAIRING_TTL_SECONDS,
    }


@router.post('/pairing/{grant_id}/approve')
async def approve_pairing(
    grant_id: str,
    form_data: PairingApprovalForm,
    request: Request,
    user=Depends(get_verified_user),
    settings: BrowserExtensionRuntimeSettings = Depends(get_browser_extension_runtime_settings),
    db: AsyncSession = Depends(get_async_session),
):
    client_key = _client_fingerprint(request)
    _check_rate_limit(
        _pairing_approval_limiter,
        f'browser-pair-approve:{client_key}:{grant_id}',
    )
    grant = await BrowserPairingGrants.get_by_id(grant_id, db=db)
    now = time.time_ns()
    if grant is None or grant.status != 'pending':
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='pairing_grant_not_found')
    if grant.expires_at <= now:
        raise HTTPException(status_code=status.HTTP_410_GONE, detail='expired_token')
    if not _secret_matches(grant.device_code_hash, form_data.device_code):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='pairing_grant_not_found')

    if not form_data.approved:
        denied = await BrowserPairingGrants.deny(grant_id, now_ns=now, db=db)
        if denied is None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail='pairing_state_changed')
        return {'status': 'denied'}

    await _require_browser_permission(user, settings, db)
    _validate_origin(grant.requested_origin, settings)
    approved = await BrowserPairingGrants.approve(grant_id, user.id, now_ns=now, db=db)
    if approved is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail='pairing_state_changed')
    return {'status': 'approved'}


@router.post('/pairing/token', response_model=DeviceTokenResponse)
async def exchange_pairing_token(
    form_data: PairingTokenForm,
    request: Request,
    settings: BrowserExtensionRuntimeSettings = Depends(get_browser_extension_runtime_settings),
    db: AsyncSession = Depends(get_async_session),
):
    client_key = _client_fingerprint(request)
    _check_rate_limit(_pairing_poll_ip_limiter, f'browser-pair-poll-ip:{client_key}')
    _check_rate_limit(
        _pairing_poll_grant_limiter,
        f'browser-pair-poll-grant:{form_data.grant_id}',
    )
    grant = await BrowserPairingGrants.get_by_id(form_data.grant_id, db=db)
    now = time.time_ns()
    if grant is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='invalid_grant')
    if not (
        _secret_matches(grant.device_code_hash, form_data.device_code)
        and _secret_matches(grant.verifier_hash, form_data.verifier)
    ):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='invalid_grant')
    if grant.expires_at <= now:
        raise HTTPException(status_code=status.HTTP_410_GONE, detail='expired_token')
    if grant.status == 'pending':
        raise HTTPException(
            status_code=status.HTTP_428_PRECONDITION_REQUIRED,
            detail='authorization_pending',
            headers={'Retry-After': str(PAIRING_POLL_INTERVAL_SECONDS)},
        )
    if grant.status == 'denied':
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='access_denied')
    if grant.status != 'approved' or grant.user_id is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='invalid_grant')

    user = await Users.get_user_by_id(grant.user_id, db=db)
    await _require_browser_permission(user, settings, db)
    origin = _validate_origin(grant.requested_origin, settings)
    consumed = await BrowserPairingGrants.consume(
        grant.id,
        verifier_hash=hash_browser_token(form_data.verifier, WEBUI_SECRET_KEY),
        now_ns=now,
        db=db,
    )
    if consumed is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='invalid_grant')

    device, refresh_token = await _create_paired_device(
        user_id=grant.user_id,
        label=grant.device_label,
        origin=origin,
        extension_version=grant.extension_version,
        now_ns=now,
        db=db,
    )
    return _token_response(device, refresh_token)


@router.post('/token/refresh', response_model=DeviceTokenResponse)
async def refresh_device_token(
    form_data: RefreshTokenForm,
    request: Request,
    settings: BrowserExtensionRuntimeSettings = Depends(get_browser_extension_runtime_settings),
    db: AsyncSession = Depends(get_async_session),
):
    client_key = _client_fingerprint(request)
    _check_rate_limit(_refresh_ip_limiter, f'browser-refresh-ip:{client_key}')
    try:
        identity = decode_refresh_credential(form_data.refresh_token, secret_key=WEBUI_SECRET_KEY)
    except RefreshCredentialError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='invalid_refresh_credential') from None
    _check_rate_limit(
        _refresh_device_limiter,
        f'browser-refresh-device:{identity.device_id}',
    )

    device = await BrowserPairedDevices.get_active_by_id(identity.device_id, db=db)
    if device is None or not hmac.compare_digest(device.token_family_id, identity.token_family_id):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='invalid_refresh_credential')

    try:
        approved_origin = validate_server_origin(
            device.allowed_origin,
            default_origin=settings.default_origin,
            custom_origins_unlocked=settings.custom_origins_unlocked,
            environment=settings.environment,
        )
    except ValueError:
        await BrowserPairedDevices.revoke_token_family(device.token_family_id, db=db)
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='server_origin_policy_changed') from None
    request_origin = _validate_origin(form_data.origin, settings)
    if not hmac.compare_digest(approved_origin, request_origin):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='origin_mismatch')

    user = await Users.get_user_by_id(device.user_id, db=db)
    try:
        await _require_browser_permission(user, settings, db)
    except HTTPException:
        await BrowserPairedDevices.revoke_token_family(device.token_family_id, db=db)
        raise

    current_hash = hash_browser_token(form_data.refresh_token, WEBUI_SECRET_KEY)
    if not hmac.compare_digest(device.refresh_token_hash, current_hash):
        await BrowserPairedDevices.revoke_token_family(device.token_family_id, db=db)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='invalid_refresh_credential')

    rotated_token = create_refresh_credential(
        device_id=device.id,
        token_family_id=device.token_family_id,
        secret_key=WEBUI_SECRET_KEY,
    )
    rotated = await BrowserPairedDevices.rotate_refresh_token(
        device.id,
        device.token_family_id,
        current_hash,
        hash_browser_token(rotated_token, WEBUI_SECRET_KEY),
        extension_version=form_data.extension_version,
        db=db,
    )
    if rotated is None:
        await BrowserPairedDevices.revoke_token_family(device.token_family_id, db=db)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='invalid_refresh_credential')
    return _token_response(rotated, rotated_token)


@router.get('/devices', response_model=list[PairedDeviceResponse])
async def list_paired_devices(
    user=Depends(get_verified_user),
    settings: BrowserExtensionRuntimeSettings = Depends(get_browser_extension_runtime_settings),
    db: AsyncSession = Depends(get_async_session),
):
    await _require_browser_permission(user, settings, db)
    devices = await BrowserPairedDevices.list_by_user_id(user.id, db=db)
    return [_safe_device(device) for device in devices]


@router.get('/download')
async def download_browser_extension(
    user=Depends(get_verified_user),
    settings: BrowserExtensionRuntimeSettings = Depends(get_browser_extension_runtime_settings),
    db: AsyncSession = Depends(get_async_session),
):
    await _require_browser_permission(user, settings, db)
    if not BROWSER_EXTENSION_ARCHIVE.is_file():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail='browser_extension_build_unavailable',
        )
    checksum = await asyncio.to_thread(_sha256_file, BROWSER_EXTENSION_ARCHIVE)
    return FileResponse(
        BROWSER_EXTENSION_ARCHIVE,
        media_type='application/zip',
        filename='tide-bot-browser-extension.zip',
        headers={
            'Cache-Control': 'private, no-store',
            'Content-Security-Policy': 'sandbox',
            'X-Content-Type-Options': 'nosniff',
            'X-Tide-Bot-SHA256': checksum,
        },
    )


@router.put('/devices/{device_id}', response_model=PairedDeviceResponse)
async def rename_paired_device(
    device_id: str,
    form_data: DeviceRenameForm,
    user=Depends(get_verified_user),
    settings: BrowserExtensionRuntimeSettings = Depends(get_browser_extension_runtime_settings),
    db: AsyncSession = Depends(get_async_session),
):
    await _require_browser_permission(user, settings, db)
    try:
        device = await BrowserPairedDevices.rename(
            device_id,
            user.id,
            form_data.label,
            db=db,
        )
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail='device_label_in_use') from None
    if device is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='paired_device_not_found')
    return _safe_device(device)


@router.post('/devices/{device_id}/revoke')
async def revoke_paired_device(
    device_id: str,
    user=Depends(get_verified_user),
    settings: BrowserExtensionRuntimeSettings = Depends(get_browser_extension_runtime_settings),
    db: AsyncSession = Depends(get_async_session),
):
    await _require_browser_permission(user, settings, db)
    device = await BrowserPairedDevices.revoke(device_id, user.id, db=db)
    if device is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='paired_device_not_found')
    return {'status': 'revoked'}


@router.get('/settings')
async def get_browser_extension_settings(
    user=Depends(get_verified_user),
    settings: BrowserExtensionRuntimeSettings = Depends(get_browser_extension_runtime_settings),
    db: AsyncSession = Depends(get_async_session),
):
    await _require_browser_permission(user, settings, db)
    return {
        'custom_origins_unlocked': settings.custom_origins_unlocked,
        'default_origin': settings.default_origin,
        'can_manage': user.role == 'admin',
    }


@router.put('/settings')
async def update_browser_extension_settings(
    form_data: BrowserExtensionSettingsForm,
    user=Depends(get_verified_user),
    settings: BrowserExtensionRuntimeSettings = Depends(get_browser_extension_runtime_settings),
    db: AsyncSession = Depends(get_async_session),
):
    await _require_browser_permission(user, settings, db)
    if user.role != 'admin':
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='admin_required')
    await Config.upsert({'browser_extension.custom_origins_unlocked': form_data.custom_origins_unlocked})
    return {
        'custom_origins_unlocked': form_data.custom_origins_unlocked,
        'default_origin': settings.default_origin,
        'can_manage': True,
    }


@router.get('/workflows', response_model=list[WorkflowResponse])
async def list_workflows(
    user=Depends(get_verified_user),
    settings: BrowserExtensionRuntimeSettings = Depends(get_browser_extension_runtime_settings),
    db: AsyncSession = Depends(get_async_session),
):
    await _require_browser_permission(user, settings, db)
    return [_safe_workflow(item) for item in await BrowserWorkflows.list_by_user_id(user.id, db=db)]


@router.post('/workflows', response_model=WorkflowResponse)
async def create_workflow(
    form_data: WorkflowCreateForm,
    user=Depends(get_verified_user),
    settings: BrowserExtensionRuntimeSettings = Depends(get_browser_extension_runtime_settings),
    db: AsyncSession = Depends(get_async_session),
):
    await _require_browser_permission(user, settings, db)
    definition = _validated_workflow_definition(form_data.definition)
    workflow_id = str(uuid4())
    encrypted = encrypt_workflow_definition(
        definition,
        secret_key=WEBUI_SECRET_KEY,
        user_id=user.id,
        workflow_id=workflow_id,
        version=1,
    )
    workflow = await BrowserWorkflows.insert(
        workflow_id=workflow_id,
        user_id=user.id,
        name=form_data.name.strip(),
        encrypted_definition=encrypted.ciphertext,
        definition_nonce=encrypted.nonce,
        version=1,
        db=db,
    )
    return _safe_workflow(workflow)


@router.get('/workflows/{workflow_id}', response_model=WorkflowResponse)
async def get_workflow(
    workflow_id: str,
    user=Depends(get_verified_user),
    settings: BrowserExtensionRuntimeSettings = Depends(get_browser_extension_runtime_settings),
    db: AsyncSession = Depends(get_async_session),
):
    await _require_browser_permission(user, settings, db)
    workflow = await BrowserWorkflows.get_by_id_and_user_id(workflow_id, user.id, db=db)
    if workflow is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='workflow_not_found')
    return _safe_workflow(workflow)


@router.put('/workflows/{workflow_id}', response_model=WorkflowResponse)
async def update_workflow(
    workflow_id: str,
    form_data: WorkflowUpdateForm,
    user=Depends(get_verified_user),
    settings: BrowserExtensionRuntimeSettings = Depends(get_browser_extension_runtime_settings),
    db: AsyncSession = Depends(get_async_session),
):
    await _require_browser_permission(user, settings, db)
    current = await BrowserWorkflows.get_by_id_and_user_id(workflow_id, user.id, db=db)
    if current is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='workflow_not_found')
    if current.version != form_data.version:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail='workflow_version_conflict')
    definition = _validated_workflow_definition(form_data.definition)
    encrypted = encrypt_workflow_definition(
        definition,
        secret_key=WEBUI_SECRET_KEY,
        user_id=user.id,
        workflow_id=workflow_id,
        version=current.version + 1,
    )
    workflow = await BrowserWorkflows.update(
        workflow_id,
        user.id,
        expected_version=current.version,
        name=form_data.name.strip(),
        encrypted_definition=encrypted.ciphertext,
        definition_nonce=encrypted.nonce,
        db=db,
    )
    if workflow is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail='workflow_version_conflict')
    return _safe_workflow(workflow)


@router.delete('/workflows/{workflow_id}')
async def delete_workflow(
    workflow_id: str,
    user=Depends(get_verified_user),
    settings: BrowserExtensionRuntimeSettings = Depends(get_browser_extension_runtime_settings),
    db: AsyncSession = Depends(get_async_session),
):
    await _require_browser_permission(user, settings, db)
    if not await BrowserWorkflows.delete(workflow_id, user.id, db=db):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='workflow_not_found')
    return {'status': 'deleted'}


@router.get('/schedules', response_model=list[ScheduleResponse])
async def list_schedules(
    request: Request,
    user=Depends(get_verified_user),
    settings: BrowserExtensionRuntimeSettings = Depends(get_browser_extension_runtime_settings),
    db: AsyncSession = Depends(get_async_session),
):
    await _require_browser_permission(user, settings, db)
    schedules = await BrowserSchedules.list_by_user_id(user.id, db=db)
    device_id = getattr(request.state, 'browser_extension_device_id', None)
    if device_id:
        schedules = [item for item in schedules if hmac.compare_digest(item.device_id, device_id)]
    return [_safe_schedule(item) for item in schedules]


@router.post('/schedules', response_model=ScheduleResponse)
async def create_schedule(
    form_data: ScheduleForm,
    request: Request,
    user=Depends(get_verified_user),
    settings: BrowserExtensionRuntimeSettings = Depends(get_browser_extension_runtime_settings),
    db: AsyncSession = Depends(get_async_session),
):
    await _require_browser_permission(user, settings, db)
    request_device_id = getattr(request.state, 'browser_extension_device_id', None)
    if request_device_id and not hmac.compare_digest(request_device_id, form_data.device_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='schedule_device_mismatch')
    try:
        schedule = await BrowserSchedules.insert(
            user_id=user.id,
            workflow_id=form_data.workflow_id,
            device_id=form_data.device_id,
            name=form_data.name.strip(),
            rrule=form_data.rrule,
            timezone=form_data.timezone,
            is_active=form_data.is_active,
            next_run_at=form_data.next_run_at,
            db=db,
        )
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='workflow_or_device_not_found') from None
    return _safe_schedule(schedule)


@router.put('/schedules/{schedule_id}', response_model=ScheduleResponse)
async def update_schedule(
    schedule_id: str,
    form_data: ScheduleForm,
    request: Request,
    user=Depends(get_verified_user),
    settings: BrowserExtensionRuntimeSettings = Depends(get_browser_extension_runtime_settings),
    db: AsyncSession = Depends(get_async_session),
):
    await _require_browser_permission(user, settings, db)
    request_device_id = getattr(request.state, 'browser_extension_device_id', None)
    if request_device_id and not hmac.compare_digest(request_device_id, form_data.device_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='schedule_device_mismatch')
    try:
        schedule = await BrowserSchedules.update(
            schedule_id,
            user.id,
            workflow_id=form_data.workflow_id,
            device_id=form_data.device_id,
            name=form_data.name.strip(),
            rrule=form_data.rrule,
            timezone=form_data.timezone,
            is_active=form_data.is_active,
            next_run_at=form_data.next_run_at,
            db=db,
        )
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='workflow_or_device_not_found') from None
    if schedule is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='schedule_not_found')
    return _safe_schedule(schedule)


@router.post('/schedules/{schedule_id}/runs', response_model=ScheduleResponse)
async def complete_schedule_run(
    schedule_id: str,
    form_data: ScheduleRunForm,
    request: Request,
    user=Depends(get_verified_user),
    settings: BrowserExtensionRuntimeSettings = Depends(get_browser_extension_runtime_settings),
    db: AsyncSession = Depends(get_async_session),
):
    await _require_browser_permission(user, settings, db)
    current = await BrowserSchedules.get_by_id_and_user_id(schedule_id, user.id, db=db)
    if current is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='schedule_not_found')
    request_device_id = getattr(request.state, 'browser_extension_device_id', None)
    if request_device_id and not hmac.compare_digest(request_device_id, current.device_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='schedule_device_mismatch')
    schedule = await BrowserSchedules.mark_run(
        schedule_id,
        user.id,
        last_run_at=form_data.last_run_at,
        next_run_at=form_data.next_run_at,
        db=db,
    )
    if schedule is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail='schedule_run_already_recorded')
    return _safe_schedule(schedule)


@router.delete('/schedules/{schedule_id}')
async def delete_schedule(
    schedule_id: str,
    user=Depends(get_verified_user),
    settings: BrowserExtensionRuntimeSettings = Depends(get_browser_extension_runtime_settings),
    db: AsyncSession = Depends(get_async_session),
):
    await _require_browser_permission(user, settings, db)
    if not await BrowserSchedules.delete(schedule_id, user.id, db=db):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='schedule_not_found')
    return {'status': 'deleted'}
