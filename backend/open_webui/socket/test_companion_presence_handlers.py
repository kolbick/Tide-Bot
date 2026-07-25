from __future__ import annotations

import asyncio
import json
from unittest.mock import AsyncMock

import fakeredis.aioredis
import pytest
from open_webui.socket.companion_presence import (
    CompanionPresenceSocketService,
    MemoryPresenceStore,
    RedisPresenceStore,
    reap_presence_session,
)
from open_webui.utils import chat_access


def payload(**changes):
    data = {
        'clientId': 'client-a',
        'chatId': 'chat-a',
        'chatTitle': 'Forged browser title',
        'deviceLabel': 'Mac',
        'isFocused': True,
        'focusedAt': 10,
    }
    data.update(changes)
    return data


def make_service(*, readable_chat=..., store=None):
    sio = AsyncMock()
    session_pool = {
        'sid-a': {'id': 'user-a', 'role': 'user'},
        'sid-b': {'id': 'user-b', 'role': 'user'},
    }
    chat = SimpleChat(id='chat-a', title='Canonical database title')
    get_readable_chat = AsyncMock(return_value=chat if readable_chat is ... else readable_chat)
    service = CompanionPresenceSocketService(
        sio=sio,
        session_pool=session_pool,
        store=store or MemoryPresenceStore(ttl_seconds=30),
        get_readable_chat=get_readable_chat,
        db_factory=AsyncContextManager(None),
        clock=lambda: 10,
    )
    return service, sio, session_pool, get_readable_chat


class SimpleChat:
    def __init__(self, id, title):
        self.id = id
        self.title = title


class AsyncContextManager:
    def __init__(self, value):
        self.value = value

    async def __aenter__(self):
        return self.value

    async def __aexit__(self, exc_type, exc, tb):
        return False

    def __call__(self):
        return self


@pytest.mark.asyncio
async def test_shared_chat_authorization_reuses_owner_admin_grant_and_folder_branches(monkeypatch):
    owner = SimpleChat(id='owned', title='Owned')
    admin_chat = SimpleChat(id='admin', title='Admin')
    grant_chat = SimpleChat(id='grant', title='Grant')
    folder_chat = SimpleChat(id='folder', title='Folder')
    folder_chat.folder_id = 'folder-a'

    chats = AsyncMock()
    chats.get_chat_by_id_and_user_id.side_effect = lambda chat_id, user_id, db: owner if chat_id == 'owned' else None
    candidates = {
        'admin': admin_chat,
        'grant': grant_chat,
        'folder': folder_chat,
    }
    chats.get_chat_by_id.side_effect = lambda chat_id, db: candidates.get(chat_id)
    grants = AsyncMock()
    grants.has_access.side_effect = lambda **kwargs: kwargs['resource_id'] == 'grant'
    folders = AsyncMock()
    folders.get_folder_by_id.return_value = object()

    monkeypatch.setattr(chat_access, 'Chats', chats)
    monkeypatch.setattr(chat_access, 'AccessGrants', grants)
    monkeypatch.setattr(chat_access, 'Folders', folders)
    monkeypatch.setattr(chat_access, 'ENABLE_ADMIN_CHAT_ACCESS', True)
    monkeypatch.setattr(chat_access, 'has_folder_access', AsyncMock(return_value=True))

    assert await chat_access.get_readable_chat('user-a', 'user', 'owned', None) is owner
    assert await chat_access.get_readable_chat('admin-a', 'admin', 'admin', None) is admin_chat
    assert await chat_access.get_readable_chat('user-a', 'user', 'grant', None) is grant_chat
    assert await chat_access.get_readable_chat('user-a', 'user', 'folder', None) is folder_chat
    assert await chat_access.get_readable_chat('user-a', 'user', 'denied', None) is None


@pytest.mark.asyncio
async def test_update_rejects_another_users_chat_before_registry_mutation():
    service, _, _, get_readable_chat = make_service(readable_chat=None)

    result = await service.update('sid-a', payload(chatId='other-user-chat'))

    assert result == {'ok': False, 'error': 'chat_access_denied'}
    get_readable_chat.assert_awaited_once()
    assert (await service.store.state('user-a', now=10)).active is None


@pytest.mark.asyncio
async def test_update_uses_canonical_title_and_emits_only_to_authenticated_user_room():
    service, sio, _, _ = make_service()

    result = await service.update('sid-a', payload())

    assert result == {'ok': True, 'revision': 1}
    sio.emit.assert_awaited_once_with(
        'companion:presence:state',
        {
            'active': payload(chatTitle='Canonical database title'),
            'revision': 1,
        },
        room='user:user-a',
    )


@pytest.mark.asyncio
async def test_update_rejects_unauthenticated_and_malformed_payloads():
    service, sio, _, get_readable_chat = make_service()

    assert await service.update('missing-sid', payload()) == {'ok': False, 'error': 'authentication_required'}
    assert await service.update('sid-a', payload(secret='token')) == {'ok': False, 'error': 'invalid_payload'}
    assert await service.update('sid-a', payload(chatId=None)) == {'ok': False, 'error': 'invalid_payload'}
    assert await service.update('sid-a', payload(chatTitle=None)) == {'ok': False, 'error': 'invalid_payload'}
    get_readable_chat.assert_not_awaited()
    sio.emit.assert_not_awaited()


@pytest.mark.asyncio
async def test_clear_removes_only_the_authenticated_socket_without_chat_authorization():
    service, sio, session_pool, get_readable_chat = make_service()
    session_pool['sid-c'] = {'id': 'user-a', 'role': 'user'}
    await service.update('sid-a', payload(clientId='client-a', focusedAt=10))
    await service.update('sid-c', payload(clientId='client-c', focusedAt=20))
    sio.reset_mock()
    get_readable_chat.reset_mock()

    result = await service.update(
        'sid-c',
        payload(
            clientId='client-a',
            chatId=None,
            chatTitle=None,
        ),
    )

    assert result == {'ok': True, 'revision': 3}
    get_readable_chat.assert_not_awaited()
    sio.emit.assert_awaited_once_with(
        'companion:presence:state',
        {
            'active': payload(
                clientId='client-a',
                chatTitle='Canonical database title',
                focusedAt=10,
            ),
            'revision': 3,
        },
        room='user:user-a',
    )


@pytest.mark.asyncio
async def test_clear_emits_active_null_when_the_authenticated_socket_is_the_only_presence():
    service, sio, _, get_readable_chat = make_service()
    await service.update('sid-a', payload())
    sio.reset_mock()
    get_readable_chat.reset_mock()

    result = await service.update('sid-a', payload(chatId=None, chatTitle=None))

    assert result == {'ok': True, 'revision': 2}
    get_readable_chat.assert_not_awaited()
    sio.emit.assert_awaited_once_with(
        'companion:presence:state',
        {'active': None, 'revision': 2},
        room='user:user-a',
    )


@pytest.mark.asyncio
async def test_redis_clear_keeps_emitted_revisions_monotonic_for_a_connected_subscriber():
    redis = fakeredis.aioredis.FakeRedis(decode_responses=True)
    store = RedisPresenceStore(redis=redis, key_prefix='test:', ttl_seconds=30)
    service, sio, session_pool, _ = make_service(store=store)
    session_pool['sid-companion'] = {'id': 'user-a', 'role': 'user'}
    await service.subscribe('sid-companion')
    sio.reset_mock()

    first = await service.update('sid-a', payload(chatId='chat-a'))
    cleared = await service.update('sid-a', payload(chatId=None, chatTitle=None))
    empty_state = await store.state('user-a', now=10)
    empty_raw_state = await redis.get(store._key('user-a'))
    third = await service.update('sid-a', payload(chatId='chat-b'))

    assert [first['revision'], cleared['revision'], third['revision']] == [1, 2, 3]
    assert empty_state.active is None
    assert empty_state.revision == 2
    assert empty_raw_state is not None
    empty_raw_data = json.loads(empty_raw_state)
    assert empty_raw_data['revision'] == 2
    assert not empty_raw_data['entries']
    assert 'chat-a' not in empty_raw_state
    assert 'client-a' not in empty_raw_state
    assert [call.args[1]['revision'] for call in sio.emit.await_args_list] == [1, 2, 3]
    await service.disconnect('sid-a')
    await service.disconnect('sid-companion')
    await redis.aclose()


@pytest.mark.asyncio
async def test_redis_revision_metadata_is_removed_after_the_final_subscriber_disconnects():
    redis = fakeredis.aioredis.FakeRedis(decode_responses=True)
    store = RedisPresenceStore(redis=redis, key_prefix='test:', ttl_seconds=30)
    service, sio, session_pool, _ = make_service(store=store)
    session_pool['sid-companion'] = {'id': 'user-a', 'role': 'user'}

    await service.subscribe('sid-companion')
    sio.reset_mock()
    first = await service.update('sid-a', payload(chatId='chat-a'))
    cleared = await service.update('sid-a', payload(chatId=None, chatTitle=None))
    await service.disconnect('sid-a')

    session_pool['sid-c'] = {'id': 'user-a', 'role': 'user'}
    resumed = await service.update('sid-c', payload(clientId='client-c', chatId='chat-b'))
    cleared_again = await service.update(
        'sid-c',
        payload(clientId='client-c', chatId=None, chatTitle=None),
    )

    assert [
        first['revision'],
        cleared['revision'],
        resumed['revision'],
        cleared_again['revision'],
    ] == [1, 2, 3, 4]
    assert [call.args[1]['revision'] for call in sio.emit.await_args_list] == [1, 2, 3, 4]
    empty_raw_state = await redis.get(store._key('user-a'))
    assert empty_raw_state is not None
    assert 'chat-a' not in empty_raw_state
    assert 'chat-b' not in empty_raw_state
    assert 'client-a' not in empty_raw_state
    assert 'client-c' not in empty_raw_state

    await service.disconnect('sid-c')
    assert await redis.get(store._key('user-a')) is not None
    await service.disconnect('sid-companion')

    remaining = [
        key
        async for key in redis.scan_iter(
            match='test:companion_presence:*',
            count=100,
        )
    ]
    assert remaining == []
    await redis.aclose()


@pytest.mark.asyncio
async def test_orphan_reaper_removes_presence_before_session_identity():
    redis = fakeredis.aioredis.FakeRedis(decode_responses=True)
    store = RedisPresenceStore(redis=redis, key_prefix='test:', ttl_seconds=30)
    service, _, session_pool, _ = make_service(store=store)
    session_pool['orphaned-sid'] = {'id': 'user-a', 'role': 'user'}
    await service.subscribe('orphaned-sid')
    original_disconnect = service.disconnect
    identity_was_available = False

    async def observed_disconnect(sid):
        nonlocal identity_was_available
        identity_was_available = sid in session_pool
        return await original_disconnect(sid)

    service.disconnect = observed_disconnect
    await reap_presence_session(service, session_pool, 'orphaned-sid')

    assert identity_was_available is True
    assert 'orphaned-sid' not in session_pool
    assert await redis.get(store._key('user-a')) is None
    await redis.aclose()


@pytest.mark.asyncio
async def test_update_rate_limits_each_socket_to_thirty_per_minute():
    service, sio, _, _ = make_service()

    for expected_revision in range(1, 31):
        assert await service.update('sid-a', payload()) == {'ok': True, 'revision': expected_revision}

    assert await service.update('sid-a', payload()) == {'ok': False, 'error': 'rate_limited'}
    assert sio.emit.await_count == 30


@pytest.mark.asyncio
async def test_subscribe_sends_state_only_to_authenticated_user_room():
    service, sio, _, _ = make_service()
    await service.update('sid-a', payload())
    sio.reset_mock()

    assert await service.subscribe('sid-a') == {'ok': True, 'revision': 1}

    sio.enter_room.assert_awaited_once_with('sid-a', 'user:user-a')
    sio.emit.assert_awaited_once_with(
        'companion:presence:state',
        {'active': payload(chatTitle='Canonical database title'), 'revision': 1},
        room='user:user-a',
    )


@pytest.mark.asyncio
async def test_disconnect_promotes_remaining_focused_client_before_session_cleanup():
    service, sio, session_pool, _ = make_service()
    session_pool['sid-b'] = {'id': 'user-a', 'role': 'user'}
    await service.update('sid-a', payload(clientId='client-a', focusedAt=10))
    await service.update('sid-b', payload(clientId='client-b', focusedAt=20))
    sio.reset_mock()

    result = await service.disconnect('sid-b')
    session_was_available = 'sid-b' in session_pool
    del session_pool['sid-b']

    assert session_was_available is True
    assert result.revision == 3
    assert result.active.clientId == 'client-a'
    sio.emit.assert_awaited_once_with(
        'companion:presence:state',
        {
            'active': payload(
                clientId='client-a',
                chatTitle='Canonical database title',
                focusedAt=10,
            ),
            'revision': 3,
        },
        room='user:user-a',
    )


@pytest.mark.asyncio
async def test_expiry_emits_promotion_only_to_owning_user():
    now = 0
    service, sio, _, _ = make_service()
    service.clock = lambda: now
    await service.update('sid-a', payload())
    sio.reset_mock()
    now = 31

    await service.expire()

    sio.emit.assert_awaited_once_with(
        'companion:presence:state',
        {'active': None, 'revision': 2},
        room='user:user-a',
    )


@pytest.mark.asyncio
async def test_concurrent_emits_never_publish_an_older_revision_after_a_newer_one():
    service, sio, session_pool, _ = make_service()
    session_pool['sid-b'] = {'id': 'user-a', 'role': 'user'}
    original_emit = service._emit

    async def delayed_emit(user_id, state):
        if state.revision == 1:
            await asyncio.sleep(0.02)
        await original_emit(user_id, state)

    service._emit = delayed_emit
    await asyncio.gather(
        service.update('sid-a', payload(clientId='client-a', focusedAt=10)),
        service.update('sid-b', payload(clientId='client-b', focusedAt=20)),
    )

    revisions = [call.args[1]['revision'] for call in sio.emit.await_args_list]
    assert revisions == sorted(revisions)
