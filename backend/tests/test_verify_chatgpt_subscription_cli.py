import asyncio
import json

from fastapi import HTTPException

from open_webui.cli import verify_chatgpt_subscription
from open_webui.routers import openai
from open_webui.utils.chatgpt_subscription import CHATGPT_PRIVATE_CREDENTIALS_KEY, ChatGPTSubscriptionError


ENCRYPTED_BLOB = 'ENCRYPTED_BLOB_MARKER'
ACCESS_TOKEN = 'ACCESS_TOKEN_MARKER'
REFRESH_TOKEN = 'REFRESH_TOKEN_MARKER'
ACCOUNT_ID = 'ACCOUNT_ID_MARKER'
EMAIL = 'email-marker@example.test'
CONNECTION_URL = 'https://connection-url-marker.example.test'
PROVIDER_KEY = 'PROVIDER_KEY_MARKER'
RAW_EXCEPTION = 'RAW_EXCEPTION_DETAIL_MARKER'
SENSITIVE_MARKERS = (
    ENCRYPTED_BLOB,
    ACCESS_TOKEN,
    REFRESH_TOKEN,
    ACCOUNT_ID,
    EMAIL,
    CONNECTION_URL,
    PROVIDER_KEY,
    RAW_EXCEPTION,
)


class _FakeModelResponse:
    status = 200

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return None

    async def json(self):
        return {
            'models': [
                {'slug': 'model-one', 'supported_in_api': True},
                {'slug': 'model-two', 'supported_in_api': True},
            ]
        }


class _FakeSession:
    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return None

    def get(self, *_args, **_kwargs):
        return _FakeModelResponse()


def _connection():
    return {
        'auth_type': 'chatgpt_subscription',
        CHATGPT_PRIVATE_CREDENTIALS_KEY: ENCRYPTED_BLOB,
        'provider_key': PROVIDER_KEY,
    }


def _credentials():
    return {
        'access_token': ACCESS_TOKEN,
        'refresh_token': REFRESH_TOKEN,
        'account_id': ACCOUNT_ID,
        'email': EMAIL,
    }


def _install_runtime_config(monkeypatch, connection):
    async def get_runtime_config():
        return True, [CONNECTION_URL], [''], {'0': connection}

    monkeypatch.setattr(openai, 'get_openai_runtime_config', get_runtime_config)


def _install_healthy_probe_dependencies(monkeypatch, credentials):
    monkeypatch.setattr(openai, 'decrypt_credentials', lambda _blob: credentials)

    async def get_valid_credentials(_connection):
        return credentials

    async def get_headers_and_cookies(*_args, **_kwargs):
        return {'Authorization': f'Bearer {ACCESS_TOKEN}'}, None

    monkeypatch.setattr(openai, 'get_valid_chatgpt_credentials', get_valid_credentials)
    monkeypatch.setattr(openai, 'get_headers_and_cookies', get_headers_and_cookies)
    monkeypatch.setattr(openai.aiohttp, 'ClientSession', lambda **_kwargs: _FakeSession())


def _assert_safe(result, expected):
    assert result == expected
    serialized = json.dumps(result, sort_keys=True)
    for marker in SENSITIVE_MARKERS:
        assert marker not in serialized


def test_reports_missing_chatgpt_connection_without_sensitive_values(monkeypatch):
    _install_runtime_config(monkeypatch, {})

    result = asyncio.run(verify_chatgpt_subscription.verify_chatgpt_subscription())

    _assert_safe(
        result,
        {
            'connection_present': False,
            'credential_decryptable': False,
            'credential_state': 'disconnected',
            'model_catalog_available': False,
            'model_count': 0,
        },
    )


def test_reports_connected_catalog_for_decryptable_unexpired_credentials(monkeypatch):
    connection = _connection()
    _install_runtime_config(monkeypatch, connection)
    _install_healthy_probe_dependencies(monkeypatch, _credentials())

    result = asyncio.run(verify_chatgpt_subscription.verify_chatgpt_subscription())

    _assert_safe(
        result,
        {
            'connection_present': True,
            'credential_decryptable': True,
            'credential_state': 'connected',
            'model_catalog_available': True,
            'model_count': 2,
        },
    )


def test_reports_connected_catalog_after_expired_credentials_refresh(monkeypatch):
    connection = _connection()
    refreshed_credentials = {**_credentials(), 'access_token': f'{ACCESS_TOKEN}_REFRESHED'}
    _install_runtime_config(monkeypatch, connection)
    _install_healthy_probe_dependencies(monkeypatch, refreshed_credentials)

    result = asyncio.run(verify_chatgpt_subscription.verify_chatgpt_subscription())

    _assert_safe(
        result,
        {
            'connection_present': True,
            'credential_decryptable': True,
            'credential_state': 'connected',
            'model_catalog_available': True,
            'model_count': 2,
        },
    )


def test_reports_reconnect_required_when_credentials_cannot_decrypt(monkeypatch):
    connection = _connection()
    _install_runtime_config(monkeypatch, connection)

    def decrypt_credentials(_blob):
        raise ChatGPTSubscriptionError(RAW_EXCEPTION)

    monkeypatch.setattr(openai, 'decrypt_credentials', decrypt_credentials)

    result = asyncio.run(verify_chatgpt_subscription.verify_chatgpt_subscription())

    _assert_safe(
        result,
        {
            'connection_present': True,
            'credential_decryptable': False,
            'credential_state': 'reconnect_required',
            'model_catalog_available': False,
            'model_count': 0,
        },
    )


def test_reports_reconnect_required_when_refresh_is_revoked(monkeypatch):
    connection = _connection()
    _install_runtime_config(monkeypatch, connection)
    monkeypatch.setattr(openai, 'decrypt_credentials', lambda _blob: _credentials())

    async def get_valid_credentials(_connection):
        raise HTTPException(status_code=401, detail=RAW_EXCEPTION)

    monkeypatch.setattr(openai, 'get_valid_chatgpt_credentials', get_valid_credentials)

    result = asyncio.run(verify_chatgpt_subscription.verify_chatgpt_subscription())

    _assert_safe(
        result,
        {
            'connection_present': True,
            'credential_decryptable': True,
            'credential_state': 'reconnect_required',
            'model_catalog_available': False,
            'model_count': 0,
        },
    )


def test_cli_stdout_serialization_excludes_sensitive_fixture_markers(monkeypatch, capsys):
    connection = _connection()
    _install_runtime_config(monkeypatch, connection)
    _install_healthy_probe_dependencies(monkeypatch, _credentials())

    exit_code = verify_chatgpt_subscription.main()
    stdout = capsys.readouterr().out

    assert exit_code == 0
    assert json.loads(stdout) == {
        'connection_present': True,
        'credential_decryptable': True,
        'credential_state': 'connected',
        'model_catalog_available': True,
        'model_count': 2,
    }
    for marker in SENSITIVE_MARKERS:
        assert marker not in stdout


def test_cli_uses_reconnect_warning_exit_code_for_revoked_refresh(monkeypatch, capsys):
    connection = _connection()
    _install_runtime_config(monkeypatch, connection)
    monkeypatch.setattr(openai, 'decrypt_credentials', lambda _blob: _credentials())

    async def get_valid_credentials(_connection):
        raise HTTPException(status_code=401, detail=RAW_EXCEPTION)

    monkeypatch.setattr(openai, 'get_valid_chatgpt_credentials', get_valid_credentials)

    assert verify_chatgpt_subscription.main() == 20
    assert RAW_EXCEPTION not in capsys.readouterr().out


def test_cli_uses_missing_connection_exit_code(monkeypatch, capsys):
    _install_runtime_config(monkeypatch, {})

    assert verify_chatgpt_subscription.main() == 21
    assert all(marker not in capsys.readouterr().out for marker in SENSITIVE_MARKERS)


def test_cli_uses_operational_failure_exit_code_without_sensitive_values(monkeypatch, capsys):
    async def get_runtime_config():
        raise RuntimeError(RAW_EXCEPTION)

    monkeypatch.setattr(openai, 'get_openai_runtime_config', get_runtime_config)

    assert verify_chatgpt_subscription.main() == 22
    assert all(marker not in capsys.readouterr().out for marker in SENSITIVE_MARKERS)
