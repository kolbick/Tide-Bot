from __future__ import annotations

import asyncio

import pytest

from open_webui.utils.browser_extension_broker import (
    BrowserCommandBroker,
    BrowserCommandError,
)


def result_for(request, *, value=None, user_id=None, device_id=None, extra_payload=None):
    payload = {
        'ok': True,
        'value': value,
        'nonce': request['nonce'],
        'sequence': request['sequence'],
    }
    if extra_payload:
        payload.update(extra_payload)
    return {
        'version': 1,
        'id': request['id'],
        'type': 'command.result',
        'deviceId': device_id or request['deviceId'],
        'userId': user_id or request['userId'],
        'sessionId': request['sessionId'],
        'timestamp': request['timestamp'] + 1,
        'payload': payload,
    }


def make_broker(send_command=None, *, timeout=0.2, max_result_bytes=1_048_576):
    async def default_transport(device_id, request, command_timeout):
        return result_for(request, value={'device': device_id})

    broker = BrowserCommandBroker(
        send_command=send_command or default_transport,
        devices={},
        sessions={},
        default_timeout_seconds=timeout,
        max_result_bytes=max_result_bytes,
    )
    broker.register_device(
        user_id='user-a',
        device_id='device-a',
        sid='sid-a',
        token_family_id='family-a',
        origin='https://tide-bot.com',
    )
    broker.open_session(
        sid='sid-a',
        session_id='session-a',
        tab_id=7,
        tab_origin='https://example.com',
        action_mode='autonomous',
        tab_policy='locked',
    )
    return broker


@pytest.mark.asyncio
async def test_registers_a_device_and_enforces_single_tab_sessions():
    broker = make_broker()

    assert broker.get_device('device-a')['user_id'] == 'user-a'
    assert broker.get_session('session-a')['tab_id'] == 7

    with pytest.raises(BrowserCommandError, match='single_tab_only'):
        broker.open_session(
            sid='sid-a',
            session_id='session-b',
            tab_id=8,
            tab_origin='https://other.example',
            action_mode='autonomous',
            tab_policy='locked',
        )


@pytest.mark.asyncio
async def test_routes_only_to_the_authenticated_user_device_and_session():
    broker = make_broker()

    value = await broker.dispatch(
        user_id='user-a',
        session_id='session-a',
        name='browser_observe',
        args={'includeScreenshot': False},
        mutating=False,
    )

    assert value == {'device': 'device-a'}
    with pytest.raises(BrowserCommandError, match='session_access_denied'):
        await broker.dispatch(
            user_id='user-b',
            session_id='session-a',
            name='browser_observe',
            args={},
            mutating=False,
        )


@pytest.mark.asyncio
async def test_times_out_and_rejects_a_late_result():
    sent = asyncio.Event()
    release = asyncio.Event()
    request = None

    async def transport(device_id, envelope, timeout):
        nonlocal request
        request = envelope
        sent.set()
        await release.wait()

    broker = make_broker(transport, timeout=0.01)

    with pytest.raises(BrowserCommandError, match='command_timeout'):
        await broker.dispatch(
            user_id='user-a',
            session_id='session-a',
            name='browser_wait',
            args={'milliseconds': 50},
            mutating=False,
        )
    await sent.wait()

    with pytest.raises(BrowserCommandError, match='late_result'):
        broker.accept_result(result_for(request, value='too late'))
    release.set()


@pytest.mark.asyncio
async def test_explicit_cancellation_notifies_the_device_and_clears_pending_state():
    sent = asyncio.Event()
    release = asyncio.Event()
    request = None
    cancellations = []

    async def transport(device_id, envelope, timeout):
        nonlocal request
        request = envelope
        sent.set()
        await release.wait()

    async def send_cancel(device_id, envelope):
        cancellations.append((device_id, envelope))

    broker = make_broker(transport)
    broker.send_cancel = send_cancel
    task = asyncio.create_task(
        broker.dispatch(
            user_id='user-a',
            session_id='session-a',
            name='browser_navigate',
            args={'url': 'https://example.com'},
            mutating=True,
        )
    )
    await sent.wait()

    await broker.cancel(user_id='user-a', command_id=request['id'])

    with pytest.raises(BrowserCommandError, match='command_cancelled'):
        await task
    assert broker.pending_count == 0
    assert cancellations[0][0] == 'device-a'
    assert cancellations[0][1]['type'] == 'command.cancel'
    release.set()


@pytest.mark.asyncio
async def test_serializes_mutations_but_allows_parallel_observations():
    started = 0
    both_started = asyncio.Event()
    release = asyncio.Event()

    async def transport(device_id, request, timeout):
        nonlocal started
        started += 1
        if started == 2:
            both_started.set()
        await release.wait()
        return result_for(request, value=request['payload']['name'])

    broker = make_broker(transport)
    first_mutation = asyncio.create_task(
        broker.dispatch('user-a', 'session-a', 'browser_click', {'target': 'Save'}, True)
    )
    while broker.pending_count == 0:
        await asyncio.sleep(0)

    with pytest.raises(BrowserCommandError, match='device_busy'):
        await broker.dispatch('user-a', 'session-a', 'browser_type', {'text': 'hello'}, True)
    first_mutation.cancel()
    with pytest.raises(asyncio.CancelledError):
        await first_mutation

    first_read = asyncio.create_task(broker.dispatch('user-a', 'session-a', 'browser_observe', {}, False))
    second_read = asyncio.create_task(broker.dispatch('user-a', 'session-a', 'browser_observe', {}, False))
    await asyncio.wait_for(both_started.wait(), timeout=0.2)
    release.set()
    assert await asyncio.gather(first_read, second_read) == [
        'browser_observe',
        'browser_observe',
    ]


@pytest.mark.asyncio
async def test_read_only_observations_do_not_race_with_mutations():
    started = asyncio.Event()
    release = asyncio.Event()

    async def transport(device_id, request, timeout):
        started.set()
        await release.wait()
        return result_for(request)

    broker = make_broker(transport)
    mutation = asyncio.create_task(broker.dispatch('user-a', 'session-a', 'browser_click', {'target': 'Save'}, True))
    await started.wait()
    with pytest.raises(BrowserCommandError, match='device_busy'):
        await broker.dispatch('user-a', 'session-a', 'browser_observe', {}, False)
    mutation.cancel()
    with pytest.raises(asyncio.CancelledError):
        await mutation

    started.clear()
    observation = asyncio.create_task(broker.dispatch('user-a', 'session-a', 'browser_observe', {}, False))
    await started.wait()
    with pytest.raises(BrowserCommandError, match='device_busy'):
        await broker.dispatch('user-a', 'session-a', 'browser_click', {'target': 'Save'}, True)
    release.set()
    await observation


@pytest.mark.asyncio
async def test_disconnect_closes_sessions_and_fails_in_flight_commands():
    sent = asyncio.Event()
    release = asyncio.Event()

    async def transport(device_id, request, timeout):
        sent.set()
        await release.wait()

    broker = make_broker(transport)
    task = asyncio.create_task(broker.dispatch('user-a', 'session-a', 'browser_wait', {}, False))
    await sent.wait()

    await broker.disconnect('sid-a')

    with pytest.raises(BrowserCommandError, match='device_disconnected'):
        await task
    assert broker.get_device('device-a') is None
    assert broker.get_session('session-a') is None
    assert broker.pending_count == 0
    release.set()


@pytest.mark.asyncio
async def test_rejects_oversized_and_cross_user_results():
    sent = asyncio.Event()
    release = asyncio.Event()
    requests = []

    async def transport(device_id, request, timeout):
        requests.append(request)
        sent.set()
        await release.wait()

    broker = make_broker(transport, max_result_bytes=300)
    task = asyncio.create_task(broker.dispatch('user-a', 'session-a', 'browser_observe', {}, False))
    await sent.wait()

    with pytest.raises(BrowserCommandError, match='result_too_large'):
        broker.accept_result(result_for(requests[0], value='x' * 1_000))
    with pytest.raises(BrowserCommandError, match='result_identity_mismatch'):
        broker.accept_result(result_for(requests[0], user_id='user-b'))

    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    release.set()
