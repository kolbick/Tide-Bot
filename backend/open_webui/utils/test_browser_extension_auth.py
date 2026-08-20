import re
import time

import pytest

from open_webui.utils.browser_extension_auth import (
    ACCESS_TOKEN_AUDIENCE,
    ACCESS_TOKEN_SCOPE,
    ACCESS_TOKEN_TTL_SECONDS,
    BrowserAccessTokenError,
    RefreshCredentialError,
    create_browser_access_token,
    create_pairing_secrets,
    create_refresh_credential,
    decode_browser_access_token,
    decode_refresh_credential,
    is_browser_extension_http_request_allowed,
    validate_server_origin,
)


def test_pairing_secrets_include_human_code_and_high_entropy_verifier():
    secrets = create_pairing_secrets()

    assert re.fullmatch(r'[A-Z2-9]{4}-[A-Z2-9]{4}', secrets.device_code)
    assert len(secrets.verifier) >= 43
    assert secrets.device_code not in secrets.verifier


@pytest.mark.parametrize(
    ('origin', 'custom_unlocked', 'environment', 'expected'),
    [
        ('https://tide-bot.com', False, 'prod', 'https://tide-bot.com'),
        ('HTTPS://TIDE-BOT.COM:443/', False, 'prod', 'https://tide-bot.com'),
        ('https://self-hosted.example:8443', True, 'prod', 'https://self-hosted.example:8443'),
        ('http://localhost:8080', False, 'dev', 'http://localhost:8080'),
        ('http://127.0.0.1:3000', False, 'development', 'http://127.0.0.1:3000'),
        ('http://[::1]:5173', False, 'test', 'http://[::1]:5173'),
    ],
)
def test_server_origin_policy_accepts_only_approved_origins(origin, custom_unlocked, environment, expected):
    assert (
        validate_server_origin(
            origin,
            default_origin='https://tide-bot.com',
            custom_origins_unlocked=custom_unlocked,
            environment=environment,
        )
        == expected
    )


@pytest.mark.parametrize(
    ('origin', 'custom_unlocked', 'environment'),
    [
        ('http://tide-bot.com', True, 'prod'),
        ('https://custom.example', False, 'prod'),
        ('http://custom.example', True, 'dev'),
        ('https://user:pass@custom.example', True, 'prod'),
        ('https://custom.example/path', True, 'prod'),
        ('https://custom.example?token=secret', True, 'prod'),
        ('chrome-extension://abcdefghijklmnop', True, 'prod'),
    ],
)
def test_server_origin_policy_rejects_insecure_locked_or_non_origin_values(
    origin,
    custom_unlocked,
    environment,
):
    with pytest.raises(ValueError, match='origin'):
        validate_server_origin(
            origin,
            default_origin='https://tide-bot.com',
            custom_origins_unlocked=custom_unlocked,
            environment=environment,
        )


def test_access_token_has_strict_device_claims_and_ten_minute_lifetime():
    issued_at = int(time.time())
    token = create_browser_access_token(
        user_id='user-a',
        device_id='device-a',
        token_family_id='family-a',
        origin='https://tide-bot.com',
        secret_key='test-secret',
        now=issued_at,
    )

    claims = decode_browser_access_token(
        token,
        secret_key='test-secret',
        expected_origin='https://tide-bot.com',
    )

    assert claims['id'] == 'user-a'
    assert claims['device_id'] == 'device-a'
    assert claims['token_family_id'] == 'family-a'
    assert claims['scope'] == ACCESS_TOKEN_SCOPE
    assert claims['aud'] == ACCESS_TOKEN_AUDIENCE
    assert claims['exp'] - claims['iat'] == ACCESS_TOKEN_TTL_SECONDS == 600

    with pytest.raises(BrowserAccessTokenError):
        decode_browser_access_token(
            token,
            secret_key='test-secret',
            expected_origin='https://other.example',
        )


def test_refresh_credential_is_authenticated_and_identifies_its_family():
    credential = create_refresh_credential(
        device_id='device-a',
        token_family_id='family-a',
        secret_key='test-secret',
    )

    identity = decode_refresh_credential(credential, secret_key='test-secret')

    assert identity.device_id == 'device-a'
    assert identity.token_family_id == 'family-a'

    tampered = f'{credential[:-1]}{"A" if credential[-1] != "A" else "B"}'
    with pytest.raises(RefreshCredentialError):
        decode_refresh_credential(tampered, secret_key='test-secret')


def test_refresh_credentials_rotate_to_distinct_values():
    first = create_refresh_credential(
        device_id='device-a',
        token_family_id='family-a',
        secret_key='test-secret',
    )
    second = create_refresh_credential(
        device_id='device-a',
        token_family_id='family-a',
        secret_key='test-secret',
    )

    assert first != second


@pytest.mark.parametrize(
    ('method', 'path'),
    [
        ('GET', '/api/models'),
        ('GET', '/api/v1/chats/'),
        ('POST', '/api/v1/chats/new'),
        ('GET', '/api/v1/chats/123e4567-e89b-12d3-a456-426614174000'),
        ('POST', '/api/v1/chats/123e4567-e89b-12d3-a456-426614174000'),
        ('POST', '/api/chat/completions'),
        ('POST', '/api/v1/audio/transcriptions'),
        ('POST', '/api/v1/audio/speech'),
        ('GET', '/api/v1/browser-extension/workflows'),
        ('POST', '/api/v1/browser-extension/workflows'),
        ('GET', '/api/v1/browser-extension/workflows/123e4567-e89b-12d3-a456-426614174000'),
        ('PUT', '/api/v1/browser-extension/workflows/123e4567-e89b-12d3-a456-426614174000'),
        ('GET', '/api/v1/browser-extension/schedules'),
        ('POST', '/api/v1/browser-extension/schedules/123e4567-e89b-12d3-a456-426614174000/runs'),
    ],
)
def test_browser_device_tokens_are_scoped_to_required_chat_and_audio_routes(method, path):
    assert is_browser_extension_http_request_allowed(method, path) is True


@pytest.mark.parametrize(
    ('method', 'path'),
    [
        ('GET', '/api/v1/users'),
        ('GET', '/api/v1/browser-extension/devices'),
        ('DELETE', '/api/v1/chats/123e4567-e89b-12d3-a456-426614174000'),
        ('POST', '/api/models/unload'),
        ('GET', '/api/v1/chats/all'),
        ('GET', '/api/models/../users'),
    ],
)
def test_browser_device_tokens_cannot_reach_unrelated_or_destructive_routes(method, path):
    assert is_browser_extension_http_request_allowed(method, path) is False
