from __future__ import annotations

import asyncio
import os
from types import SimpleNamespace
from unittest.mock import AsyncMock

os.environ.setdefault('DATA_DIR', '/tmp/tide-bot-browser-extension-socket-tests')
os.environ.setdefault('STATIC_DIR', '/tmp/tide-bot-browser-extension-socket-tests/static')
os.environ.setdefault('WEBUI_SECRET_KEY', 'browser-extension-socket-test-secret')
os.environ.setdefault(
    'FRONTEND_BUILD_DIR',
    '/tmp/tide-bot-browser-extension-socket-tests/frontend',
)

import pytest

from open_webui.socket.browser_extension import BrowserExtensionSocketService
from open_webui.utils.browser_extension_broker import BrowserCommandBroker


def result_for(request, *, device_id=None):
    return {
        'version': 1,
        'id': request['id'],
        'type': 'command.result',
        'deviceId': device_id or request['deviceId'],
        'userId': request['userId'],
        'sessionId': request['sessionId'],
        'timestamp': request['timestamp'] + 1,
        'payload': {
            'ok': True,
            'value': {'title': 'Example'},
            'nonce': request['nonce'],
            'sequence': request['sequence'],
        },
    }


def make_service(*, permission=True, device=None, claims=None):
    sio = AsyncMock()
    devices = {}
    sessions = {}

    async def transport(device_id, request, timeout):
        return result_for(request)

    broker = BrowserCommandBroker(
        send_command=transport,
        devices=devices,
        sessions=sessions,
    )
    stored_device = device or SimpleNamespace(
        id='device-a',
        user_id='user-a',
        token_family_id='family-a',
        allowed_origin='https://tide-bot.com',
        revoked_at=None,
    )
    token_claims = claims or {
        'id': 'user-a',
        'device_id': 'device-a',
        'token_family_id': 'family-a',
        'origin': 'https://tide-bot.com',
    }
    decode_token = AsyncMock(return_value=token_claims)
    get_device = AsyncMock(return_value=stored_device)
    get_user = AsyncMock(return_value=SimpleNamespace(id='user-a', role='user'))
    has_permission = AsyncMock(return_value=permission)
    service = BrowserExtensionSocketService(
        sio=sio,
        broker=broker,
        decode_access_token=decode_token,
        get_device=get_device,
        get_user=get_user,
        has_permission=has_permission,
    )
    return service, sio, broker, decode_token, get_device, has_permission


def join_payload(**changes):
    payload = {
        'accessToken': 'signed-device-token',
        'origin': 'https://tide-bot.com',
    }
    payload.update(changes)
    return payload


def session_payload(**changes):
    payload = {
        'sessionId': 'session-a',
        'tabId': 17,
        'tabOrigin': 'https://example.com',
        'actionMode': 'autonomous',
        'tabPolicy': 'locked',
    }
    payload.update(changes)
    return payload


@pytest.mark.asyncio
async def test_join_validates_device_identity_and_enters_only_scoped_rooms():
    service, sio, broker, decoder, get_device, permission = make_service()

    result = await service.join('sid-a', join_payload())

    assert result == {'ok': True, 'userId': 'user-a', 'deviceId': 'device-a'}
    decoder.assert_awaited_once_with('signed-device-token', 'https://tide-bot.com')
    get_device.assert_awaited_once_with('device-a')
    permission.assert_awaited_once()
    assert sio.enter_room.await_args_list == [
        (("sid-a", 'browser:user:user-a'), {}),
        (("sid-a", 'browser:device:device-a'), {}),
    ]
    assert broker.get_device('device-a')['sid'] == 'sid-a'


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ('change', 'error'),
    [
        ({'allowed_origin': 'https://other.example'}, 'device_identity_mismatch'),
        ({'token_family_id': 'family-b'}, 'device_identity_mismatch'),
        ({'user_id': 'user-b'}, 'device_identity_mismatch'),
        ({'revoked_at': 1}, 'device_revoked'),
    ],
)
async def test_join_rejects_origin_family_owner_and_revocation_mismatches(change, error):
    values = {
        'id': 'device-a',
        'user_id': 'user-a',
        'token_family_id': 'family-a',
        'allowed_origin': 'https://tide-bot.com',
        'revoked_at': None,
    }
    values.update(change)
    service, sio, broker, *_ = make_service(device=SimpleNamespace(**values))

    result = await service.join('sid-a', join_payload())

    assert result == {'ok': False, 'error': error}
    sio.enter_room.assert_not_awaited()
    assert broker.get_device('device-a') is None


@pytest.mark.asyncio
async def test_join_rechecks_current_feature_permission():
    service, sio, broker, *_ = make_service(permission=False)

    assert await service.join('sid-a', join_payload()) == {
        'ok': False,
        'error': 'browser_extension_not_allowed',
    }
    sio.enter_room.assert_not_awaited()
    assert broker.get_device('device-a') is None


@pytest.mark.asyncio
async def test_session_and_heartbeat_handlers_use_authenticated_socket_identity():
    service, _, broker, *_ = make_service()
    await service.join('sid-a', join_payload())

    opened = await service.open_session('sid-a', session_payload())
    heartbeat = await service.heartbeat('sid-a', {})
    denied = await service.close_session('other-sid', {'sessionId': 'session-a'})
    closed = await service.close_session('sid-a', {'sessionId': 'session-a'})

    assert opened == {'ok': True, 'sessionId': 'session-a'}
    assert heartbeat == {'ok': True}
    assert denied == {'ok': False, 'error': 'session_access_denied'}
    assert closed == {'ok': True}
    assert broker.get_session('session-a') is None


@pytest.mark.asyncio
async def test_command_result_handler_rejects_cross_device_results_and_accepts_owner():
    captured = asyncio.Event()
    release = asyncio.Event()
    request = None

    async def transport(device_id, envelope, timeout):
        nonlocal request
        request = envelope
        captured.set()
        await release.wait()

    service, _, broker, *_ = make_service()
    broker.send_command = transport
    await service.join('sid-a', join_payload())
    await service.open_session('sid-a', session_payload())
    task = asyncio.create_task(broker.dispatch('user-a', 'session-a', 'browser_observe', {}, False))
    await captured.wait()

    broker.register_device(
        user_id='user-b',
        device_id='device-b',
        sid='sid-b',
        token_family_id='family-b',
        origin='https://tide-bot.com',
    )
    denied = await service.command_result(
        'sid-b',
        result_for(request, device_id='device-a'),
    )
    accepted = await service.command_result('sid-a', result_for(request))

    assert denied == {'ok': False, 'error': 'result_identity_mismatch'}
    assert accepted == {'ok': True}
    assert await task == {'title': 'Example'}
    release.set()


@pytest.mark.asyncio
async def test_disconnect_removes_only_the_device_bound_to_that_socket():
    service, _, broker, *_ = make_service()
    await service.join('sid-a', join_payload())
    await service.open_session('sid-a', session_payload())

    await service.disconnect('other-sid')
    assert broker.get_device('device-a') is not None

    await service.disconnect('sid-a')
    assert broker.get_device('device-a') is None
    assert broker.get_session('session-a') is None


@pytest.mark.asyncio
async def test_reconnect_replaces_stale_socket_and_its_single_tab_session():
    service, _, broker, *_ = make_service()
    await service.join('sid-old', join_payload())
    await service.open_session('sid-old', session_payload())

    joined = await service.join('sid-new', join_payload())

    assert joined == {'ok': True, 'userId': 'user-a', 'deviceId': 'device-a'}
    assert broker.get_device('device-a')['sid'] == 'sid-new'
    assert broker.get_session('session-a') is None
    assert await service.open_session('sid-new', session_payload(tabId=18)) == {
        'ok': True,
        'sessionId': 'session-a',
    }


@pytest.mark.asyncio
async def test_handlers_reject_unknown_fields_and_unauthenticated_sockets():
    service, _, _, *_ = make_service()

    assert await service.join('sid-a', join_payload(secret='leak')) == {
        'ok': False,
        'error': 'invalid_payload',
    }
    assert await service.open_session('sid-a', session_payload()) == {
        'ok': False,
        'error': 'device_authentication_required',
    }
    assert await service.approval_result('sid-a', {'type': 'approval.result'}) == {
        'ok': False,
        'error': 'device_authentication_required',
    }
