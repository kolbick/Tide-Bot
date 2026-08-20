from __future__ import annotations

import base64
import hashlib
import hmac
import ipaddress
import json
import re
import secrets
import time
from dataclasses import dataclass
from urllib.parse import urlsplit
from uuid import uuid4

import jwt

from open_webui.utils.browser_extension_crypto import derive_browser_extension_keys

ACCESS_TOKEN_AUDIENCE = 'tide-bot-browser-extension'
ACCESS_TOKEN_SCOPE = 'browser-extension'
ACCESS_TOKEN_TTL_SECONDS = 600
REFRESH_CREDENTIAL_PREFIX = 'tbx1'

_PAIRING_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
_CHAT_ID_PATH = re.compile(
    r'^/api/v1/chats/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
    re.IGNORECASE,
)
_RESOURCE_ID = r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
_WORKFLOW_PATH = re.compile(
    rf'^/api/v1/browser-extension/workflows/{_RESOURCE_ID}$',
    re.IGNORECASE,
)
_SCHEDULE_PATH = re.compile(
    rf'^/api/v1/browser-extension/schedules/{_RESOURCE_ID}$',
    re.IGNORECASE,
)
_SCHEDULE_RUN_PATH = re.compile(
    rf'^/api/v1/browser-extension/schedules/{_RESOURCE_ID}/runs$',
    re.IGNORECASE,
)


class BrowserAccessTokenError(ValueError):
    pass


class RefreshCredentialError(ValueError):
    pass


def is_browser_extension_http_request_allowed(method: str, path: str) -> bool:
    if not isinstance(method, str) or not isinstance(path, str) or '..' in path:
        return False
    method = method.upper()
    if method == 'GET' and path == '/api/models':
        return True
    if method == 'GET' and path in {'/api/v1/chats', '/api/v1/chats/'}:
        return True
    if method == 'POST' and path == '/api/v1/chats/new':
        return True
    if method in {'GET', 'POST'} and _CHAT_ID_PATH.fullmatch(path):
        return True
    if method == 'POST' and path in {
        '/api/chat/completions',
        '/api/v1/chat/completions',
        '/api/v1/audio/transcriptions',
        '/api/v1/audio/speech',
    }:
        return True
    if path == '/api/v1/browser-extension/workflows' and method in {'GET', 'POST'}:
        return True
    if _WORKFLOW_PATH.fullmatch(path) and method in {'GET', 'PUT', 'DELETE'}:
        return True
    if path == '/api/v1/browser-extension/schedules' and method in {'GET', 'POST'}:
        return True
    if _SCHEDULE_PATH.fullmatch(path) and method in {'PUT', 'DELETE'}:
        return True
    if _SCHEDULE_RUN_PATH.fullmatch(path) and method == 'POST':
        return True
    return False


@dataclass(frozen=True)
class PairingSecrets:
    device_code: str
    verifier: str


@dataclass(frozen=True)
class RefreshCredentialIdentity:
    device_id: str
    token_family_id: str


def _encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b'=').decode('ascii')


def _decode(value: str) -> bytes:
    padding = '=' * (-len(value) % 4)
    try:
        decoded = base64.b64decode(
            f'{value}{padding}',
            altchars=b'-_',
            validate=True,
        )
    except (ValueError, TypeError) as exc:
        raise RefreshCredentialError('Invalid browser refresh credential') from exc
    if not hmac.compare_digest(_encode(decoded), value):
        raise RefreshCredentialError('Invalid browser refresh credential')
    return decoded


def create_pairing_secrets() -> PairingSecrets:
    code = ''.join(secrets.choice(_PAIRING_ALPHABET) for _ in range(8))
    return PairingSecrets(
        device_code=f'{code[:4]}-{code[4:]}',
        verifier=secrets.token_urlsafe(48),
    )


def _normalize_origin(origin: str) -> tuple[str, str, str]:
    if not isinstance(origin, str) or not origin.strip():
        raise ValueError('Server origin is required')
    parsed = urlsplit(origin.strip())
    if parsed.scheme.lower() not in {'http', 'https'} or not parsed.hostname:
        raise ValueError('Server origin must use HTTP or HTTPS')
    if parsed.username is not None or parsed.password is not None:
        raise ValueError('Server origin must not contain credentials')
    if parsed.path not in {'', '/'} or parsed.query or parsed.fragment:
        raise ValueError('Server origin must not contain a path, query, or fragment')

    scheme = parsed.scheme.lower()
    try:
        port = parsed.port
    except ValueError as exc:
        raise ValueError('Server origin contains an invalid port') from exc

    host = parsed.hostname.encode('idna').decode('ascii').lower()
    display_host = f'[{host}]' if ':' in host else host
    if port is not None and not ((scheme == 'https' and port == 443) or (scheme == 'http' and port == 80)):
        display_host = f'{display_host}:{port}'
    normalized = f'{scheme}://{display_host}'
    return normalized, scheme, host


def _is_loopback(host: str) -> bool:
    if host == 'localhost':
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def validate_server_origin(
    origin: str,
    *,
    default_origin: str = 'https://tide-bot.com',
    custom_origins_unlocked: bool = False,
    environment: str = 'prod',
) -> str:
    normalized, scheme, host = _normalize_origin(origin)
    normalized_default, _, _ = _normalize_origin(default_origin)

    if normalized == normalized_default:
        return normalized
    if environment.lower() in {'dev', 'development', 'test'} and _is_loopback(host):
        return normalized
    if not custom_origins_unlocked:
        raise ValueError('Custom server origin is locked by the Tide-Bot administrator')
    if scheme != 'https':
        raise ValueError('Custom server origin must use HTTPS')
    return normalized


def create_browser_access_token(
    *,
    user_id: str,
    device_id: str,
    token_family_id: str,
    origin: str,
    secret_key: str,
    now: int | None = None,
) -> str:
    issued_at = int(time.time()) if now is None else int(now)
    claims = {
        'id': user_id,
        'device_id': device_id,
        'token_family_id': token_family_id,
        'scope': ACCESS_TOKEN_SCOPE,
        'aud': ACCESS_TOKEN_AUDIENCE,
        'origin': origin,
        'iat': issued_at,
        'exp': issued_at + ACCESS_TOKEN_TTL_SECONDS,
        'jti': str(uuid4()),
    }
    signing_key = derive_browser_extension_keys(secret_key).access_signing
    return jwt.encode(claims, signing_key, algorithm='HS256')


def decode_browser_access_token(
    token: str,
    *,
    secret_key: str,
    expected_origin: str | None = None,
) -> dict:
    signing_key = derive_browser_extension_keys(secret_key).access_signing
    try:
        claims = jwt.decode(
            token,
            signing_key,
            algorithms=['HS256'],
            audience=ACCESS_TOKEN_AUDIENCE,
            options={
                'require': [
                    'id',
                    'device_id',
                    'token_family_id',
                    'scope',
                    'aud',
                    'origin',
                    'iat',
                    'exp',
                    'jti',
                ]
            },
        )
    except jwt.PyJWTError as exc:
        raise BrowserAccessTokenError('Invalid browser access token') from exc

    if claims.get('scope') != ACCESS_TOKEN_SCOPE:
        raise BrowserAccessTokenError('Invalid browser access token scope')
    if expected_origin is not None and not hmac.compare_digest(
        str(claims.get('origin', '')),
        expected_origin,
    ):
        raise BrowserAccessTokenError('Browser access token origin mismatch')
    return claims


def create_refresh_credential(
    *,
    device_id: str,
    token_family_id: str,
    secret_key: str,
) -> str:
    payload = _encode(
        json.dumps(
            {
                'v': 1,
                'd': device_id,
                'f': token_family_id,
                'n': secrets.token_urlsafe(32),
            },
            separators=(',', ':'),
            sort_keys=True,
        ).encode('utf-8')
    )
    signing_key = derive_browser_extension_keys(secret_key).refresh_signing
    signature = _encode(hmac.new(signing_key, payload.encode('ascii'), hashlib.sha256).digest())
    return f'{REFRESH_CREDENTIAL_PREFIX}.{payload}.{signature}'


def decode_refresh_credential(
    credential: str,
    *,
    secret_key: str,
) -> RefreshCredentialIdentity:
    try:
        prefix, payload, signature = credential.split('.')
    except (AttributeError, ValueError) as exc:
        raise RefreshCredentialError('Invalid browser refresh credential') from exc
    if prefix != REFRESH_CREDENTIAL_PREFIX:
        raise RefreshCredentialError('Invalid browser refresh credential')

    signing_key = derive_browser_extension_keys(secret_key).refresh_signing
    expected_signature = hmac.new(signing_key, payload.encode('ascii'), hashlib.sha256).digest()
    if not hmac.compare_digest(_decode(signature), expected_signature):
        raise RefreshCredentialError('Invalid browser refresh credential')

    try:
        data = json.loads(_decode(payload))
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise RefreshCredentialError('Invalid browser refresh credential') from exc

    if (
        not isinstance(data, dict)
        or data.get('v') != 1
        or not isinstance(data.get('d'), str)
        or not data['d']
        or not isinstance(data.get('f'), str)
        or not data['f']
        or not isinstance(data.get('n'), str)
        or len(data['n']) < 32
    ):
        raise RefreshCredentialError('Invalid browser refresh credential')
    return RefreshCredentialIdentity(
        device_id=data['d'],
        token_family_id=data['f'],
    )
