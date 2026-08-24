import asyncio
import base64
import json
import time

import pytest
from open_webui.utils.chatgpt_subscription import (
    CHATGPT_PRIVATE_CREDENTIALS_KEY,
    ChatGPTSubscriptionError,
    create_login_handle,
    credentials_from_token_response,
    credentials_need_refresh,
    decrypt_credentials,
    encrypt_credentials,
    normalize_models_response,
    poll_device_code,
    read_login_handle,
    refresh_credentials,
    request_device_code,
    sanitize_codex_responses_payload,
)


class _FakeResponse:
    def __init__(self, status: int, payload: dict):
        self.status = status
        self.payload = payload

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return None

    async def json(self):
        return self.payload


class _FakeSession:
    def __init__(self, *responses: _FakeResponse):
        self.responses = list(responses)
        self.calls = []

    def post(self, url: str, **kwargs):
        self.calls.append((url, kwargs))
        return self.responses.pop(0)


def _jwt(payload: dict) -> str:
    def encode(value: bytes) -> str:
        return base64.urlsafe_b64encode(value).decode().rstrip('=')

    return '.'.join(
        (
            encode(json.dumps({'alg': 'none'}).encode()),
            encode(json.dumps(payload).encode()),
            encode(b'signature'),
        )
    )


def test_credentials_extract_account_plan_and_expiry():
    expires_at = int(time.time()) + 3600
    token = credentials_from_token_response(
        {
            'access_token': _jwt({'exp': expires_at}),
            'refresh_token': 'refresh-token',
            'id_token': _jwt(
                {
                    'email': 'admin@example.com',
                    'https://api.openai.com/auth': {
                        'chatgpt_account_id': 'account-123',
                        'chatgpt_plan_type': 'plus',
                    },
                }
            ),
        }
    )

    assert token['account_id'] == 'account-123'
    assert token['email'] == 'admin@example.com'
    assert token['plan_type'] == 'plus'
    assert token['expires_at'] == expires_at
    assert not credentials_need_refresh(token)


def test_credentials_require_renewable_token_and_account():
    with pytest.raises(ChatGPTSubscriptionError):
        credentials_from_token_response({'access_token': 'token'})

    with pytest.raises(ChatGPTSubscriptionError):
        credentials_from_token_response(
            {
                'access_token': _jwt({'exp': int(time.time()) + 3600}),
                'refresh_token': 'refresh-token',
                'id_token': _jwt({'email': 'admin@example.com'}),
            }
        )


def test_credentials_round_trip_encrypted():
    credentials = {
        'access_token': 'access-secret',
        'refresh_token': 'refresh-secret',
        'account_id': 'account-123',
        'expires_at': int(time.time()) + 3600,
    }
    encrypted = encrypt_credentials(credentials)

    assert 'access-secret' not in encrypted
    assert 'refresh-secret' not in encrypted
    assert decrypt_credentials(encrypted) == credentials
    assert CHATGPT_PRIVATE_CREDENTIALS_KEY.startswith('_')


def test_device_login_handle_is_opaque_and_round_trips():
    handle = create_login_handle('device-secret', 'ABCD-EFGH', 5)

    assert 'device-secret' not in handle
    assert 'ABCD-EFGH' not in handle
    assert read_login_handle(handle)['device_auth_id'] == 'device-secret'


def test_device_login_flow_exchanges_code_for_credentials():
    start_session = _FakeSession(
        _FakeResponse(
            200,
            {
                'device_auth_id': 'device-123',
                'user_code': 'ABCD-EFGH',
                'interval': '5',
            },
        )
    )
    login = asyncio.run(request_device_code(start_session))

    assert login['user_code'] == 'ABCD-EFGH'
    assert login['interval'] == 5
    assert 'device-123' not in login['login_handle']

    token_expiry = int(time.time()) + 3600
    complete_session = _FakeSession(
        _FakeResponse(
            200,
            {
                'authorization_code': 'authorization-code',
                'code_challenge': 'challenge',
                'code_verifier': 'verifier',
            },
        ),
        _FakeResponse(
            200,
            {
                'access_token': _jwt({'exp': token_expiry}),
                'refresh_token': 'refresh-token',
                'id_token': _jwt(
                    {
                        'https://api.openai.com/auth': {
                            'chatgpt_account_id': 'account-123',
                            'chatgpt_plan_type': 'plus',
                        }
                    }
                ),
            },
        ),
    )
    credentials = asyncio.run(poll_device_code(complete_session, login['login_handle']))

    assert credentials['account_id'] == 'account-123'
    assert credentials['expires_at'] == token_expiry
    assert complete_session.calls[1][1]['data']['grant_type'] == 'authorization_code'


def test_device_login_pending_and_refresh_rotation():
    login_handle = create_login_handle('device-123', 'ABCD-EFGH', 5)
    assert asyncio.run(poll_device_code(_FakeSession(_FakeResponse(403, {})), login_handle)) is None

    old_credentials = {
        'access_token': _jwt({'exp': int(time.time()) - 60}),
        'refresh_token': 'old-refresh',
        'id_token': _jwt(
            {
                'email': 'admin@example.com',
                'https://api.openai.com/auth': {'chatgpt_account_id': 'account-123'},
            }
        ),
        'account_id': 'account-123',
        'expires_at': int(time.time()) - 60,
    }
    new_expiry = int(time.time()) + 3600
    session = _FakeSession(
        _FakeResponse(
            200,
            {
                'access_token': _jwt({'exp': new_expiry}),
                'refresh_token': 'rotated-refresh',
            },
        )
    )
    refreshed = asyncio.run(refresh_credentials(session, old_credentials))

    assert refreshed['refresh_token'] == 'rotated-refresh'
    assert refreshed['account_id'] == 'account-123'
    assert refreshed['expires_at'] == new_expiry
    assert session.calls[0][1]['json']['grant_type'] == 'refresh_token'


def test_sanitize_codex_responses_payload_removes_unsupported_fields():
    payload = sanitize_codex_responses_payload(
        {
            'model': 'gpt-5.6-luna',
            'instructions': 'Be concise.',
            'input': [],
            'stream': False,
            'include': ['reasoning.encrypted_content'],
            'store': True,
            'previous_response_id': 'response-123',
            'use_mmap': True,
            'temperature': 0.8,
            'top_p': 0.9,
            'frequency_penalty': 0.1,
            'presence_penalty': 0.2,
            'seed': 42,
            'logprobs': True,
            'top_logprobs': 3,
        }
    )

    assert payload == {
        'model': 'gpt-5.6-luna',
        'instructions': 'Be concise.',
        'input': [],
        'stream': False,
        'include': ['reasoning.encrypted_content'],
        'store': False,
    }


def test_normalize_models_response_filters_unavailable_models():
    response = normalize_models_response(
        {
            'models': [
                {
                    'slug': 'gpt-5-codex',
                    'display_name': 'GPT-5 Codex',
                    'description': 'Coding model',
                    'supported_in_api': True,
                    'context_window': 200000,
                },
                {
                    'slug': 'internal-only',
                    'display_name': 'Internal',
                    'supported_in_api': False,
                },
                {
                    'slug': 'hidden-model',
                    'display_name': 'Hidden',
                    'supported_in_api': True,
                    'visibility': 'hide',
                },
            ]
        }
    )

    assert response['object'] == 'list'
    assert response['data'] == [
        {
            'id': 'gpt-5-codex',
            'name': 'GPT-5 Codex',
            'description': 'Coding model',
            'owned_by': 'openai',
            'context_length': 200000,
            'chatgpt': {
                'slug': 'gpt-5-codex',
                'display_name': 'GPT-5 Codex',
                'description': 'Coding model',
                'supported_in_api': True,
                'context_window': 200000,
            },
        }
    ]
