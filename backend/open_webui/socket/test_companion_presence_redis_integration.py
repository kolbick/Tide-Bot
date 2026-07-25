from __future__ import annotations

import asyncio
import os
import secrets
import string
import sys
from typing import Any

import aiohttp
import redis.asyncio as redis_async
import socketio


def _random_text(prefix: str, length: int = 12) -> str:
    alphabet = string.ascii_lowercase + string.digits
    return f'{prefix}-{"".join(secrets.choice(alphabet) for _ in range(length))}'


async def _request(
    session: aiohttp.ClientSession,
    method: str,
    url: str,
    *,
    token: str | None = None,
    json: dict[str, Any] | None = None,
) -> dict[str, Any]:
    headers = {'Authorization': f'Bearer {token}'} if token else {}
    async with session.request(method, url, headers=headers, json=json) as response:
        if response.status >= 400:
            raise AssertionError(f'{method} request failed with HTTP {response.status}')
        return await response.json()


async def _create_users_and_chats(worker_a: str, worker_b: str):
    suffix = _random_text('run')
    admin_email = f'admin-{suffix}@example.test'
    user_email = f'user-{suffix}@example.test'
    admin_password = secrets.token_urlsafe(24)
    user_password = secrets.token_urlsafe(24)

    async with aiohttp.ClientSession() as session:
        signup = await _request(
            session,
            'POST',
            f'{worker_a}/api/v1/auths/signup',
            json={'name': 'Integration Admin', 'email': admin_email, 'password': admin_password},
        )
        await _request(
            session,
            'POST',
            f'{worker_a}/api/v1/auths/add',
            token=signup['token'],
            json={
                'name': 'Integration User',
                'email': user_email,
                'password': user_password,
                'role': 'user',
            },
        )
        admin = await _request(
            session,
            'POST',
            f'{worker_a}/api/v1/auths/signin',
            json={'email': admin_email, 'password': admin_password},
        )
        user = await _request(
            session,
            'POST',
            f'{worker_b}/api/v1/auths/signin',
            json={'email': user_email, 'password': user_password},
        )
        chat_body = {
            'chat': {
                'title': 'Authorized integration chat',
                'models': [],
                'history': {'messages': {}, 'currentId': None},
                'messages': [],
            }
        }
        admin_chat = await _request(
            session,
            'POST',
            f'{worker_a}/api/v1/chats/new',
            token=admin['token'],
            json=chat_body,
        )
        user_chat = await _request(
            session,
            'POST',
            f'{worker_b}/api/v1/chats/new',
            token=user['token'],
            json={
                'chat': {
                    **chat_body['chat'],
                    'title': 'Unrelated integration chat',
                }
            },
        )

    return admin['token'], user['token'], admin_chat['id'], user_chat['id']


class PresenceClient:
    def __init__(self, endpoint: str):
        self.endpoint = endpoint
        self.client = socketio.AsyncClient(reconnection=False, logger=False, engineio_logger=False)
        self.states: list[dict[str, Any]] = []
        self.client.on('companion:presence:state', self._on_state)

    async def _on_state(self, data):
        self.states.append(data)

    async def connect(self, token: str):
        await self.client.connect(
            self.endpoint,
            socketio_path='ws/socket.io',
            transports=['websocket'],
            wait_timeout=20,
        )
        joined = await self.client.call('user-join', {'auth': {'token': token}}, timeout=20)
        if not joined or not joined.get('id'):
            raise AssertionError('authenticated Socket.IO user-join failed')
        subscribed = await self.client.call('companion:presence:subscribe', timeout=20)
        if not subscribed or not subscribed.get('ok'):
            raise AssertionError('companion presence subscribe failed')

    async def update(self, payload: dict[str, Any]):
        return await self.client.call('companion:presence:update', payload, timeout=20)

    async def disconnect(self):
        if self.client.connected:
            await self.client.disconnect()


def _payload(client_id: str, chat_id: str, focused_at: float) -> dict[str, Any]:
    return {
        'clientId': client_id,
        'chatId': chat_id,
        'chatTitle': 'Untrusted integration title',
        'deviceLabel': 'Integration worker',
        'isFocused': True,
        'focusedAt': focused_at,
    }


async def _wait_for(predicate, *, timeout: float = 10):
    deadline = asyncio.get_running_loop().time() + timeout
    while not predicate():
        if asyncio.get_running_loop().time() >= deadline:
            raise AssertionError('timed out waiting for presence state')
        await asyncio.sleep(0.05)


def _assert_shared_presence_sequences(worker_a_states, worker_b_states):
    assert len(worker_a_states) == 2
    assert worker_a_states == worker_b_states
    revisions = [state['revision'] for state in worker_a_states]
    assert revisions in ([1, 2], [2, 2])
    if revisions == [2, 2]:
        assert worker_a_states[0] == worker_a_states[1]


def test_shared_stream_contract_accepts_only_documented_coalescing():
    revision_one = {'active': {'clientId': 'worker-a'}, 'revision': 1}
    revision_two = {'active': {'clientId': 'worker-b'}, 'revision': 2}

    _assert_shared_presence_sequences(
        [revision_one, revision_two],
        [revision_one, revision_two],
    )
    _assert_shared_presence_sequences(
        [revision_two, revision_two],
        [revision_two, revision_two],
    )


def test_shared_stream_contract_rejects_missing_or_different_events():
    revision_one = {'active': {'clientId': 'worker-a'}, 'revision': 1}
    revision_two = {'active': {'clientId': 'worker-b'}, 'revision': 2}
    invalid_sequences = [
        ([revision_two], [revision_two]),
        ([revision_one, revision_two], [revision_two, revision_two]),
        ([revision_two, revision_one], [revision_two, revision_one]),
    ]

    for worker_a, worker_b in invalid_sequences:
        try:
            _assert_shared_presence_sequences(worker_a, worker_b)
        except AssertionError:
            continue
        raise AssertionError('invalid shared presence streams were accepted')


async def run_integration() -> None:
    worker_a = os.environ['PRESENCE_WORKER_A_URL']
    worker_b = os.environ['PRESENCE_WORKER_B_URL']
    redis_url = os.environ['WEBSOCKET_REDIS_URL']
    key_prefix = os.environ['REDIS_KEY_PREFIX']
    admin_token, user_token, admin_chat_id, user_chat_id = await _create_users_and_chats(worker_a, worker_b)

    admin_a = PresenceClient(worker_a)
    admin_b = PresenceClient(worker_b)
    other_user = PresenceClient(worker_b)
    clients = [admin_a, admin_b, other_user]
    redis = redis_async.from_url(redis_url, decode_responses=True)
    try:
        await asyncio.gather(
            admin_a.connect(admin_token),
            admin_b.connect(admin_token),
            other_user.connect(user_token),
        )
        await asyncio.sleep(0.25)
        for client in clients:
            client.states.clear()

        first, second = await asyncio.gather(
            admin_a.update(_payload('admin-worker-a', admin_chat_id, 10)),
            admin_b.update(_payload('admin-worker-b', admin_chat_id, 20)),
        )
        revisions = sorted([first.get('revision'), second.get('revision')])
        assert first.get('ok') and second.get('ok')
        assert revisions == [1, 2]
        await _wait_for(lambda: len(admin_a.states) >= 2 and len(admin_b.states) >= 2)
        await asyncio.sleep(0.25)
        _assert_shared_presence_sequences(admin_a.states, admin_b.states)
        final_state = admin_a.states[-1]
        assert final_state['revision'] == 2
        assert final_state['active'] == {
            'clientId': 'admin-worker-b',
            'chatId': admin_chat_id,
            'chatTitle': 'Authorized integration chat',
            'deviceLabel': 'Integration worker',
            'isFocused': True,
            'focusedAt': 20,
        }
        assert other_user.states == []
        print('ASSERT shared-cross-worker-revision-stream PASS', flush=True)
        print('ASSERT user-room-isolation PASS', flush=True)

        admin_a.states.clear()
        await admin_b.disconnect()
        await _wait_for(
            lambda: (
                bool(admin_a.states)
                and admin_a.states[-1]['revision'] == 3
                and admin_a.states[-1]['active']['clientId'] == 'admin-worker-a'
            )
        )
        print('ASSERT disconnect-promotion PASS', flush=True)

        admin_a.states.clear()
        other_user.states.clear()
        denied = await other_user.update(_payload('other-user', admin_chat_id, 30))
        assert denied == {'ok': False, 'error': 'chat_access_denied'}
        assert admin_a.states == []
        allowed = await other_user.update(_payload('other-user', user_chat_id, 40))
        assert allowed.get('ok') is True
        await _wait_for(lambda: bool(other_user.states))
        assert admin_a.states == []
        print('ASSERT real-handler-chat-authorization PASS', flush=True)
    finally:
        await asyncio.gather(*(client.disconnect() for client in clients), return_exceptions=True)
        await asyncio.sleep(0.5)
        remaining = [
            key
            async for key in redis.scan_iter(
                match=f'{key_prefix}companion_presence:*',
                count=100,
            )
        ]
        assert remaining == []
        print('ASSERT namespace-empty PASS', flush=True)
        await redis.aclose()


if __name__ == '__main__':
    try:
        asyncio.run(run_integration())
    except Exception as exc:
        print(f'ASSERT integration FAIL ({type(exc).__name__})', file=sys.stderr, flush=True)
        raise
