"""ChatGPT subscription authentication helpers.

This module follows the public OAuth device-code flow used by OpenAI Codex.
Secrets are encrypted with the existing Open WebUI OAuth encryption key before
being persisted in the OpenAI connection configuration.
"""

from __future__ import annotations

import base64
import hashlib
import json
import time
from typing import Any

import aiohttp
import jwt
from cryptography.fernet import Fernet
from open_webui.env import OAUTH_CLIENT_INFO_ENCRYPTION_KEY

CHATGPT_AUTH_TYPE = 'chatgpt_subscription'
CHATGPT_AUTH_ISSUER = 'https://auth.openai.com'
CHATGPT_CODEX_BASE_URL = 'https://chatgpt.com/backend-api/codex'
# The catalog filters out models whose minimum Codex version exceeds this value.
# Keep this aligned with a tested official Codex CLI protocol release.
CHATGPT_CODEX_CLIENT_VERSION = '0.146.1'
CHATGPT_OAUTH_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
CHATGPT_DEVICE_CODE_TTL_SECONDS = 15 * 60
CHATGPT_TOKEN_REFRESH_SKEW_SECONDS = 5 * 60
CHATGPT_PRIVATE_CREDENTIALS_KEY = '_chatgpt_oauth_credentials'
CHATGPT_PUBLIC_STATUS_KEY = 'chatgpt_oauth_status'
CHATGPT_ORIGINATOR = 'codex_cli_rs'
CHATGPT_AUTH_HEADERS = {
    'originator': CHATGPT_ORIGINATOR,
    'User-Agent': f'codex_cli_rs/{CHATGPT_CODEX_CLIENT_VERSION} (Tide-Bot)',
}


class ChatGPTSubscriptionError(Exception):
    """A sanitized ChatGPT subscription authentication failure."""


def _fernet() -> Fernet:
    key = OAUTH_CLIENT_INFO_ENCRYPTION_KEY
    if len(key) != 44:
        key_bytes = hashlib.sha256(key.encode()).digest()
        key = base64.urlsafe_b64encode(key_bytes).decode()
    return Fernet(key.encode())


def _encrypt_data(data: dict[str, Any]) -> str:
    return _fernet().encrypt(json.dumps(data).encode()).decode()


def _decrypt_data(value: str) -> dict[str, Any]:
    return json.loads(_fernet().decrypt(value.encode()).decode())


def _jwt_claims(token: str | None) -> dict[str, Any]:
    if not token:
        return {}
    try:
        return jwt.decode(
            token,
            options={
                'verify_signature': False,
                'verify_exp': False,
                'verify_aud': False,
            },
        )
    except Exception:
        return {}


def _auth_claims(claims: dict[str, Any]) -> dict[str, Any]:
    nested = claims.get('https://api.openai.com/auth')
    return nested if isinstance(nested, dict) else {}


def credentials_from_token_response(token_response: dict[str, Any]) -> dict[str, Any]:
    access_token = token_response.get('access_token')
    refresh_token = token_response.get('refresh_token')
    id_token = token_response.get('id_token')
    if not access_token or not refresh_token:
        raise ChatGPTSubscriptionError('OpenAI did not return renewable ChatGPT credentials.')

    id_claims = _jwt_claims(id_token)
    access_claims = _jwt_claims(access_token)
    auth_claims = {**_auth_claims(access_claims), **_auth_claims(id_claims)}

    account_id = (
        auth_claims.get('chatgpt_account_id')
        or id_claims.get('chatgpt_account_id')
        or access_claims.get('chatgpt_account_id')
    )
    if not account_id:
        raise ChatGPTSubscriptionError('The ChatGPT account identifier was missing from the OpenAI token.')

    expires_at = access_claims.get('exp')
    if not isinstance(expires_at, (int, float)):
        expires_at = int(time.time()) + 3600

    return {
        'access_token': access_token,
        'refresh_token': refresh_token,
        'id_token': id_token,
        'account_id': str(account_id),
        'email': id_claims.get('email') or access_claims.get('email'),
        'plan_type': auth_claims.get('chatgpt_plan_type') or access_claims.get('chatgpt_plan_type'),
        'expires_at': int(expires_at),
        'last_refresh': int(time.time()),
    }


def credentials_need_refresh(credentials: dict[str, Any]) -> bool:
    expires_at = credentials.get('expires_at')
    return not isinstance(expires_at, (int, float)) or expires_at <= time.time() + CHATGPT_TOKEN_REFRESH_SKEW_SECONDS


def encrypt_credentials(credentials: dict[str, Any]) -> str:
    return _encrypt_data(credentials)


def decrypt_credentials(value: str | None) -> dict[str, Any]:
    if not value:
        raise ChatGPTSubscriptionError('The ChatGPT subscription is not connected.')
    try:
        credentials = _decrypt_data(value)
    except Exception as exc:
        raise ChatGPTSubscriptionError('The stored ChatGPT credentials could not be decrypted.') from exc
    if not isinstance(credentials, dict):
        raise ChatGPTSubscriptionError('The stored ChatGPT credentials are invalid.')
    return credentials


def public_status(credentials: dict[str, Any], state: str = 'connected', error: str | None = None) -> dict[str, Any]:
    return {
        'connected': state == 'connected',
        'state': state,
        'account_id': credentials.get('account_id'),
        'email': credentials.get('email'),
        'plan_type': credentials.get('plan_type'),
        'expires_at': credentials.get('expires_at'),
        'last_refresh': credentials.get('last_refresh'),
        'error': error,
    }


def create_login_handle(device_auth_id: str, user_code: str, interval: int) -> str:
    return _encrypt_data(
        {
            'device_auth_id': device_auth_id,
            'user_code': user_code,
            'interval': interval,
            'expires_at': int(time.time()) + CHATGPT_DEVICE_CODE_TTL_SECONDS,
        }
    )


def read_login_handle(login_handle: str) -> dict[str, Any]:
    try:
        state = _decrypt_data(login_handle)
    except Exception as exc:
        raise ChatGPTSubscriptionError('The ChatGPT sign-in request is invalid or expired.') from exc
    if not isinstance(state, dict) or state.get('expires_at', 0) < time.time():
        raise ChatGPTSubscriptionError('The ChatGPT sign-in request has expired. Start again.')
    if not state.get('device_auth_id') or not state.get('user_code'):
        raise ChatGPTSubscriptionError('The ChatGPT sign-in request is invalid.')
    return state


def _safe_interval(value: Any) -> int:
    try:
        return min(max(int(value), 2), 30)
    except (TypeError, ValueError):
        return 5


async def request_device_code(session: aiohttp.ClientSession) -> dict[str, Any]:
    url = f'{CHATGPT_AUTH_ISSUER}/api/accounts/deviceauth/usercode'
    try:
        async with session.post(
            url,
            json={'client_id': CHATGPT_OAUTH_CLIENT_ID},
            headers=CHATGPT_AUTH_HEADERS,
        ) as response:
            if response.status != 200:
                raise ChatGPTSubscriptionError(
                    'ChatGPT device sign-in is unavailable. Enable device-code login '
                    'in ChatGPT security settings and try again.'
                )
            payload = await response.json()
    except ChatGPTSubscriptionError:
        raise
    except Exception as exc:
        raise ChatGPTSubscriptionError('Could not start ChatGPT sign-in.') from exc

    device_auth_id = payload.get('device_auth_id')
    user_code = payload.get('user_code') or payload.get('usercode')
    if not device_auth_id or not user_code:
        raise ChatGPTSubscriptionError('OpenAI returned an invalid ChatGPT sign-in response.')

    interval = _safe_interval(payload.get('interval'))
    return {
        'verification_url': f'{CHATGPT_AUTH_ISSUER}/codex/device',
        'user_code': user_code,
        'interval': interval,
        'expires_in': CHATGPT_DEVICE_CODE_TTL_SECONDS,
        'login_handle': create_login_handle(device_auth_id, user_code, interval),
    }


async def poll_device_code(session: aiohttp.ClientSession, login_handle: str) -> dict[str, Any] | None:
    state = read_login_handle(login_handle)
    url = f'{CHATGPT_AUTH_ISSUER}/api/accounts/deviceauth/token'
    try:
        async with session.post(
            url,
            json={
                'device_auth_id': state['device_auth_id'],
                'user_code': state['user_code'],
            },
            headers=CHATGPT_AUTH_HEADERS,
        ) as response:
            if response.status in (403, 404):
                return None
            if response.status != 200:
                raise ChatGPTSubscriptionError('ChatGPT sign-in failed. Start the connection again.')
            authorization = await response.json()
    except ChatGPTSubscriptionError:
        raise
    except Exception as exc:
        raise ChatGPTSubscriptionError('Could not complete ChatGPT sign-in.') from exc

    required = ('authorization_code', 'code_verifier')
    if any(not authorization.get(field) for field in required):
        raise ChatGPTSubscriptionError('OpenAI returned an invalid ChatGPT authorization response.')

    token_url = f'{CHATGPT_AUTH_ISSUER}/oauth/token'
    redirect_uri = f'{CHATGPT_AUTH_ISSUER}/deviceauth/callback'
    form = {
        'grant_type': 'authorization_code',
        'code': authorization['authorization_code'],
        'redirect_uri': redirect_uri,
        'client_id': CHATGPT_OAUTH_CLIENT_ID,
        'code_verifier': authorization['code_verifier'],
    }
    try:
        async with session.post(token_url, data=form, headers=CHATGPT_AUTH_HEADERS) as response:
            if response.status != 200:
                raise ChatGPTSubscriptionError('OpenAI rejected the ChatGPT authorization exchange.')
            token_response = await response.json()
    except ChatGPTSubscriptionError:
        raise
    except Exception as exc:
        raise ChatGPTSubscriptionError('Could not exchange the ChatGPT authorization code.') from exc

    return credentials_from_token_response(token_response)


async def refresh_credentials(
    session: aiohttp.ClientSession,
    credentials: dict[str, Any],
) -> dict[str, Any]:
    refresh_token = credentials.get('refresh_token')
    if not refresh_token:
        raise ChatGPTSubscriptionError('The ChatGPT subscription must be reconnected.')

    try:
        async with session.post(
            f'{CHATGPT_AUTH_ISSUER}/oauth/token',
            json={
                'client_id': CHATGPT_OAUTH_CLIENT_ID,
                'grant_type': 'refresh_token',
                'refresh_token': refresh_token,
            },
            headers=CHATGPT_AUTH_HEADERS,
        ) as response:
            if response.status != 200:
                raise ChatGPTSubscriptionError('The ChatGPT subscription must be reconnected.')
            token_response = await response.json()
    except ChatGPTSubscriptionError:
        raise
    except Exception as exc:
        raise ChatGPTSubscriptionError('ChatGPT authentication is temporarily unavailable.') from exc

    merged = {
        'access_token': token_response.get('access_token') or credentials.get('access_token'),
        'refresh_token': token_response.get('refresh_token') or refresh_token,
        'id_token': token_response.get('id_token') or credentials.get('id_token'),
    }
    return credentials_from_token_response(merged)


def sanitize_codex_responses_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """Allow only fields supported by the ChatGPT Codex Responses backend."""
    supported_parameters = {
        'model',
        'instructions',
        'input',
        'tools',
        'tool_choice',
        'parallel_tool_calls',
        'reasoning',
        'stream',
        'include',
        'service_tier',
        'prompt_cache_key',
        'text',
    }
    sanitized = {key: value for key, value in payload.items() if key in supported_parameters}
    sanitized['store'] = False
    return sanitized


def normalize_models_response(response: Any) -> Any:
    """Convert the Codex model catalog into OpenAI's list-models shape."""
    if not isinstance(response, dict) or not isinstance(response.get('models'), list):
        return response

    data = []
    for model in response['models']:
        if (
            not isinstance(model, dict)
            or not model.get('slug')
            or not model.get('supported_in_api', True)
            or model.get('visibility') == 'hide'
        ):
            continue
        data.append(
            {
                'id': model['slug'],
                'name': model.get('display_name') or model['slug'],
                'description': model.get('description'),
                'owned_by': 'openai',
                'context_length': model.get('context_window'),
                'chatgpt': model,
            }
        )
    return {'object': 'list', 'data': data}
