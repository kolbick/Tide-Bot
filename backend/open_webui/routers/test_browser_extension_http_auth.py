from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
import redis  # Load the external package before open_webui.utils can shadow its name.
from fastapi import BackgroundTasks, HTTPException, Response
from fastapi.security import HTTPAuthorizationCredentials

from open_webui.utils.auth import get_current_user


def request(path='/api/models', method='GET', origin='https://tide-bot.com'):
    return SimpleNamespace(
        method=method,
        scope={'path': path},
        headers={'x-tide-bot-origin': origin},
        cookies={},
        state=SimpleNamespace(token=None),
        app=SimpleNamespace(state=SimpleNamespace(redis=None)),
    )


@pytest.mark.asyncio
async def test_browser_device_token_authenticates_only_an_active_matching_device(monkeypatch):
    import open_webui.models.browser_extension as browser_models
    import open_webui.utils.auth as auth_module
    import open_webui.utils.browser_extension_auth as browser_auth
    import open_webui.utils.browser_extension_permissions as browser_permissions

    monkeypatch.setattr(auth_module, 'decode_token', lambda _token: None)
    monkeypatch.setattr(
        browser_auth,
        'decode_browser_access_token',
        lambda *_args, **_kwargs: {
            'id': 'user-a',
            'device_id': 'device-a',
            'token_family_id': 'family-a',
            'origin': 'https://tide-bot.com',
        },
    )
    monkeypatch.setattr(
        browser_models.BrowserPairedDevices,
        'get_active_by_id',
        AsyncMock(
            return_value=SimpleNamespace(
                id='device-a',
                user_id='user-a',
                token_family_id='family-a',
                allowed_origin='https://tide-bot.com',
                revoked_at=None,
            )
        ),
    )
    monkeypatch.setattr(
        browser_permissions,
        'has_browser_extension_permission',
        AsyncMock(return_value=True),
    )
    user = SimpleNamespace(id='user-a', email='user@example.com', role='user')
    monkeypatch.setattr(auth_module.Users, 'get_user_by_id', AsyncMock(return_value=user))
    monkeypatch.setattr(auth_module.Users, 'update_last_active_by_id', AsyncMock())
    monkeypatch.setattr(
        auth_module.Config,
        'get',
        AsyncMock(return_value={'features': {'browser_extension': True}}),
    )

    result = await get_current_user(
        request(),
        Response(),
        BackgroundTasks(),
        HTTPAuthorizationCredentials(scheme='Bearer', credentials='browser-token'),
    )

    assert result is user


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ('path', 'method', 'origin'),
    [
        ('/api/v1/users', 'GET', 'https://tide-bot.com'),
        ('/api/models', 'POST', 'https://tide-bot.com'),
        ('/api/models', 'GET', 'https://other.example'),
    ],
)
async def test_browser_device_token_is_rejected_outside_scope_or_origin(
    monkeypatch,
    path,
    method,
    origin,
):
    import open_webui.utils.auth as auth_module
    import open_webui.utils.browser_extension_auth as browser_auth

    monkeypatch.setattr(auth_module, 'decode_token', lambda _token: None)
    monkeypatch.setattr(
        browser_auth,
        'decode_browser_access_token',
        lambda *_args, **_kwargs: {
            'id': 'user-a',
            'device_id': 'device-a',
            'token_family_id': 'family-a',
            'origin': 'https://tide-bot.com',
        },
    )

    with pytest.raises(HTTPException) as error:
        await get_current_user(
            request(path=path, method=method, origin=origin),
            Response(),
            BackgroundTasks(),
            HTTPAuthorizationCredentials(scheme='Bearer', credentials='browser-token'),
        )

    assert error.value.status_code in {401, 403}
