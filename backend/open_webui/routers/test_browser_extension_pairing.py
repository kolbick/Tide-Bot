import os
import hashlib
from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock

os.environ.setdefault('WEBUI_SECRET_KEY', 'browser-extension-router-test-secret')
os.environ.setdefault('ENABLE_DB_MIGRATIONS', 'false')
os.environ.setdefault('DATA_DIR', '/tmp/tide-bot-browser-extension-router-tests')
os.environ.setdefault('STATIC_DIR', '/tmp/tide-bot-browser-extension-router-tests/static')
os.environ.setdefault('FRONTEND_BUILD_DIR', '/tmp/tide-bot-browser-extension-router-tests/frontend')

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI, HTTPException
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

import open_webui.models.browser_extension as browser_models
import open_webui.routers.browser_extension as browser_router
from open_webui.env import WEBUI_SECRET_KEY
from open_webui.internal.db import Base, get_async_session
from open_webui.models.browser_extension import BROWSER_EXTENSION_TABLES, BrowserPairedDevices, BrowserPairingGrants
from open_webui.utils.auth import get_verified_user
from open_webui.utils.browser_extension_auth import decode_browser_access_token
from open_webui.utils.rate_limit import RateLimiter


@pytest_asyncio.fixture
async def api(monkeypatch):
    engine = create_async_engine('sqlite+aiosqlite:///:memory:')
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all, tables=BROWSER_EXTENSION_TABLES)

    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as session:

        @asynccontextmanager
        async def test_db_context(existing=None):
            yield existing or session

        monkeypatch.setattr(browser_models, 'get_async_db_context', test_db_context)

        state = SimpleNamespace(
            user=SimpleNamespace(id='user-a', role='user', name='Kolby'),
            group_permissions=[],
            settings=browser_router.BrowserExtensionRuntimeSettings(
                default_permissions={'features': {'browser_extension': True}},
                custom_origins_unlocked=False,
                environment='prod',
                default_origin='https://tide-bot.com',
            ),
        )

        async def current_user():
            if state.user is None:
                raise HTTPException(status_code=401, detail='Not authenticated')
            return state.user

        async def db_dependency():
            yield session

        async def runtime_settings():
            return state.settings

        resolve_permission = browser_router.has_browser_extension_permission

        async def permission_check(user_id, default_permissions, db=None, *, user_role=None):
            async def group_permissions(_user_id, db=None):
                return state.group_permissions

            return await resolve_permission(
                user_id,
                default_permissions,
                db=db,
                user_role=user_role,
                group_permissions_provider=group_permissions,
            )

        async def user_by_id(user_id, db=None):
            if user_id == 'user-a':
                return SimpleNamespace(id='user-a', role='user', name='Kolby')
            return None

        monkeypatch.setattr(browser_router, 'has_browser_extension_permission', permission_check)
        monkeypatch.setattr(browser_router.Users, 'get_user_by_id', user_by_id)
        RateLimiter._memory_store.clear()

        app = FastAPI()
        app.include_router(browser_router.router, prefix='/api/v1/browser-extension')
        app.dependency_overrides[get_verified_user] = current_user
        app.dependency_overrides[get_async_session] = db_dependency
        app.dependency_overrides[browser_router.get_browser_extension_runtime_settings] = runtime_settings

        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url='https://tide-bot.com',
        ) as client:
            yield SimpleNamespace(client=client, state=state, db=session)

    await engine.dispose()


async def start_pairing(api, **overrides):
    payload = {
        'device_label': 'Kolby Chrome',
        'origin': 'https://tide-bot.com',
        'extension_version': '1.0.0',
        **overrides,
    }
    return await api.client.post('/api/v1/browser-extension/pairing/start', json=payload)


async def approve_pairing(api, start_data, *, approved=True):
    return await api.client.post(
        f'/api/v1/browser-extension/pairing/{start_data["grant_id"]}/approve',
        json={'device_code': start_data['device_code'], 'approved': approved},
    )


async def exchange_pairing(api, start_data):
    return await api.client.post(
        '/api/v1/browser-extension/pairing/token',
        json={
            'grant_id': start_data['grant_id'],
            'device_code': start_data['device_code'],
            'verifier': start_data['verifier'],
        },
    )


@pytest.mark.asyncio
async def test_pairing_requires_approval_and_consumes_verifier_once(api):
    started = await start_pairing(api)
    assert started.status_code == 200
    start_data = started.json()

    stored = await BrowserPairingGrants.get_by_id(start_data['grant_id'], db=api.db)
    assert stored.device_code_hash != start_data['device_code']
    assert stored.verifier_hash != start_data['verifier']
    assert stored.device_label == 'Kolby Chrome'

    pending = await exchange_pairing(api, start_data)
    assert pending.status_code == 428
    assert pending.json()['detail'] == 'authorization_pending'

    approved = await approve_pairing(api, start_data)
    assert approved.status_code == 200
    assert approved.json()['status'] == 'approved'

    exchanged = await exchange_pairing(api, start_data)
    assert exchanged.status_code == 200
    tokens = exchanged.json()
    assert tokens['refresh_token']
    assert tokens['expires_in'] == 600

    claims = decode_browser_access_token(
        tokens['access_token'],
        secret_key=WEBUI_SECRET_KEY,
        expected_origin='https://tide-bot.com',
    )
    assert claims['id'] == 'user-a'
    assert claims['device_id'] == tokens['device']['id']

    reused = await exchange_pairing(api, start_data)
    assert reused.status_code == 401
    assert start_data['verifier'] not in reused.text


@pytest.mark.asyncio
async def test_approval_requires_sign_in_and_current_permission(api):
    start_data = (await start_pairing(api)).json()

    api.state.user = None
    unsigned = await approve_pairing(api, start_data)
    assert unsigned.status_code == 401

    api.state.user = SimpleNamespace(id='user-a', role='user', name='Kolby')
    api.state.settings.default_permissions = {'features': {'browser_extension': False}}
    denied = await approve_pairing(api, start_data)
    assert denied.status_code == 403


@pytest.mark.asyncio
async def test_explicit_group_deny_blocks_pairing_even_when_default_is_enabled(api):
    start_data = (await start_pairing(api)).json()
    api.state.group_permissions = [{'features': {'browser_extension': False}}]

    denied = await approve_pairing(api, start_data)

    assert denied.status_code == 403


@pytest.mark.asyncio
async def test_denied_pairing_cannot_be_exchanged(api):
    start_data = (await start_pairing(api)).json()

    denied = await approve_pairing(api, start_data, approved=False)
    exchanged = await exchange_pairing(api, start_data)

    assert denied.json()['status'] == 'denied'
    assert exchanged.status_code == 403
    assert exchanged.json()['detail'] == 'access_denied'


@pytest.mark.asyncio
async def test_refresh_rotates_and_replay_revokes_the_token_family(api):
    start_data = (await start_pairing(api)).json()
    await approve_pairing(api, start_data)
    tokens = (await exchange_pairing(api, start_data)).json()

    refreshed = await api.client.post(
        '/api/v1/browser-extension/token/refresh',
        json={
            'refresh_token': tokens['refresh_token'],
            'origin': 'https://tide-bot.com',
            'extension_version': '1.0.1',
        },
    )
    assert refreshed.status_code == 200
    rotated = refreshed.json()
    assert rotated['refresh_token'] != tokens['refresh_token']

    replay = await api.client.post(
        '/api/v1/browser-extension/token/refresh',
        json={
            'refresh_token': tokens['refresh_token'],
            'origin': 'https://tide-bot.com',
            'extension_version': '1.0.1',
        },
    )
    assert replay.status_code == 401
    assert tokens['refresh_token'] not in replay.text

    device_id = tokens['device']['id']
    assert await BrowserPairedDevices.get_active_by_id(device_id, db=api.db) is None

    revoked_family = await api.client.post(
        '/api/v1/browser-extension/token/refresh',
        json={
            'refresh_token': rotated['refresh_token'],
            'origin': 'https://tide-bot.com',
            'extension_version': '1.0.1',
        },
    )
    assert revoked_family.status_code == 401


@pytest.mark.asyncio
async def test_refresh_rechecks_permission_and_origin(api):
    start_data = (await start_pairing(api)).json()
    await approve_pairing(api, start_data)
    tokens = (await exchange_pairing(api, start_data)).json()

    wrong_origin = await api.client.post(
        '/api/v1/browser-extension/token/refresh',
        json={
            'refresh_token': tokens['refresh_token'],
            'origin': 'https://other.example',
            'extension_version': '1.0.0',
        },
    )
    assert wrong_origin.status_code == 403

    api.state.group_permissions = [{'features': {'browser_extension': False}}]
    permission_removed = await api.client.post(
        '/api/v1/browser-extension/token/refresh',
        json={
            'refresh_token': tokens['refresh_token'],
            'origin': 'https://tide-bot.com',
            'extension_version': '1.0.0',
        },
    )
    assert permission_removed.status_code == 403


@pytest.mark.asyncio
async def test_custom_remote_origin_requires_admin_unlock_but_dev_loopback_is_allowed(api):
    locked = await start_pairing(api, origin='https://self-hosted.example')
    assert locked.status_code == 403

    api.state.settings.custom_origins_unlocked = True
    unlocked = await start_pairing(api, origin='https://self-hosted.example')
    assert unlocked.status_code == 200

    api.state.settings.custom_origins_unlocked = False
    api.state.settings.environment = 'dev'
    loopback = await start_pairing(api, origin='http://localhost:5173')
    assert loopback.status_code == 200


@pytest.mark.asyncio
async def test_pairing_rejects_a_blank_device_label(api):
    response = await start_pairing(api, device_label='   ')

    assert response.status_code == 422


@pytest.mark.asyncio
async def test_user_can_list_and_revoke_only_their_devices(api):
    start_data = (await start_pairing(api)).json()
    await approve_pairing(api, start_data)
    tokens = (await exchange_pairing(api, start_data)).json()

    listed = await api.client.get('/api/v1/browser-extension/devices')
    assert listed.status_code == 200
    assert [device['id'] for device in listed.json()] == [tokens['device']['id']]
    assert 'refresh_token_hash' not in listed.text

    revoked = await api.client.post(f'/api/v1/browser-extension/devices/{tokens["device"]["id"]}/revoke')
    assert revoked.status_code == 200
    assert revoked.json()['status'] == 'revoked'

    missing = await api.client.post('/api/v1/browser-extension/devices/not-owned/revoke')
    assert missing.status_code == 404


@pytest.mark.asyncio
async def test_pairing_and_refresh_are_rate_limited_by_ip_grant_and_device(api, monkeypatch):
    monkeypatch.setattr(browser_router._pairing_start_ip_limiter, 'limit', 1)
    assert (await start_pairing(api)).status_code == 200
    assert (await start_pairing(api, device_label='Second Chrome')).status_code == 429

    RateLimiter._memory_store.clear()
    monkeypatch.setattr(browser_router._pairing_poll_grant_limiter, 'limit', 1)
    start_data = (await start_pairing(api, device_label='Polling Chrome')).json()
    assert (await exchange_pairing(api, start_data)).status_code == 428
    assert (await exchange_pairing(api, start_data)).status_code == 429

    RateLimiter._memory_store.clear()
    start_data = (await start_pairing(api, device_label='Refresh Chrome')).json()
    await approve_pairing(api, start_data)
    tokens = (await exchange_pairing(api, start_data)).json()
    monkeypatch.setattr(browser_router._refresh_device_limiter, 'limit', 1)
    first = await api.client.post(
        '/api/v1/browser-extension/token/refresh',
        json={
            'refresh_token': tokens['refresh_token'],
            'origin': 'https://tide-bot.com',
            'extension_version': '1.0.1',
        },
    )
    second = await api.client.post(
        '/api/v1/browser-extension/token/refresh',
        json={
            'refresh_token': first.json()['refresh_token'],
            'origin': 'https://tide-bot.com',
            'extension_version': '1.0.1',
        },
    )

    assert first.status_code == 200
    assert second.status_code == 429


@pytest.mark.asyncio
async def test_download_is_authenticated_permission_checked_and_uses_safe_headers(api, monkeypatch, tmp_path):
    archive = tmp_path / 'tide-bot-browser-extension.zip'
    archive.write_bytes(b'PK\x03\x04safe-extension')
    monkeypatch.setattr(browser_router, 'BROWSER_EXTENSION_ARCHIVE', archive)

    response = await api.client.get('/api/v1/browser-extension/download')

    assert response.status_code == 200
    assert response.headers['content-type'] == 'application/zip'
    assert response.headers['content-disposition'] == 'attachment; filename="tide-bot-browser-extension.zip"'
    assert response.headers['x-content-type-options'] == 'nosniff'
    assert response.headers['cache-control'] == 'private, no-store'
    assert response.headers['x-tide-bot-sha256'] == hashlib.sha256(archive.read_bytes()).hexdigest()

    api.state.settings.default_permissions = {'features': {'browser_extension': False}}
    assert (await api.client.get('/api/v1/browser-extension/download')).status_code == 403

    api.state.user = None
    assert (await api.client.get('/api/v1/browser-extension/download')).status_code == 401


@pytest.mark.asyncio
async def test_missing_download_returns_safe_503_without_a_filesystem_path(api, monkeypatch, tmp_path):
    monkeypatch.setattr(browser_router, 'BROWSER_EXTENSION_ARCHIVE', tmp_path / 'missing.zip')

    response = await api.client.get('/api/v1/browser-extension/download')

    assert response.status_code == 503
    assert response.json()['detail'] == 'browser_extension_build_unavailable'
    assert str(tmp_path) not in response.text


@pytest.mark.asyncio
async def test_device_can_be_renamed_and_custom_origin_controls_are_admin_only(api, monkeypatch):
    start_data = (await start_pairing(api)).json()
    await approve_pairing(api, start_data)
    tokens = (await exchange_pairing(api, start_data)).json()
    device_id = tokens['device']['id']

    renamed = await api.client.put(
        f'/api/v1/browser-extension/devices/{device_id}',
        json={'label': 'Office Chrome'},
    )
    assert renamed.status_code == 200
    assert renamed.json()['label'] == 'Office Chrome'

    denied = await api.client.put(
        '/api/v1/browser-extension/settings',
        json={'custom_origins_unlocked': True},
    )
    assert denied.status_code == 403

    api.state.user = SimpleNamespace(id='user-a', role='admin', name='Kolby')
    upsert = AsyncMock()
    monkeypatch.setattr(browser_router.Config, 'upsert', upsert)
    updated = await api.client.put(
        '/api/v1/browser-extension/settings',
        json={'custom_origins_unlocked': True},
    )
    assert updated.status_code == 200
    assert updated.json()['custom_origins_unlocked'] is True
    upsert.assert_awaited_once_with({'browser_extension.custom_origins_unlocked': True})
