from __future__ import annotations

import asyncio
from types import SimpleNamespace

import fakeredis.aioredis
import pytest
from open_webui.socket.companion_presence import (
    MemoryPresenceStore,
    PresenceUpdate,
    RedisPresenceStore,
    create_presence_store,
    start_presence_expiry_task,
    stop_presence_expiry_task,
    validate_presence_update,
)


def update(
    client_id: str = 'client-a',
    chat_id: str = 'chat-a',
    *,
    focused: bool = True,
    focused_at: float = 10,
) -> PresenceUpdate:
    return PresenceUpdate(
        clientId=client_id,
        chatId=chat_id,
        chatTitle='A canonical title',
        deviceLabel='Mac',
        isFocused=focused,
        focusedAt=focused_at,
    )


@pytest.mark.parametrize(
    ('change', 'error'),
    [
        ({'unknown': 'value'}, 'unknown field'),
        ({'clientId': 7}, 'clientId'),
        ({'chatId': ''}, 'chatId'),
        ({'chatTitle': 'x' * 513}, 'chatTitle'),
        ({'deviceLabel': 'x' * 129}, 'deviceLabel'),
        ({'isFocused': 1}, 'isFocused'),
        ({'focusedAt': -1}, 'focusedAt'),
    ],
)
def test_validation_rejects_malformed_or_oversized_updates(change, error):
    payload = update().as_dict()
    payload.update(change)

    with pytest.raises(ValueError, match=error):
        validate_presence_update(payload)


@pytest.mark.asyncio
async def test_memory_store_arbitrates_newest_focus_and_promotes_on_disconnect():
    store = MemoryPresenceStore(ttl_seconds=30)
    await store.update('user-a', 'sid-a', update('client-a', focused_at=10), now=10)
    second = await store.update('user-a', 'sid-b', update('client-b', focused_at=20), now=20)

    assert second.active.clientId == 'client-b'
    promoted = await store.disconnect('user-a', 'sid-b', now=21)
    assert promoted.active.clientId == 'client-a'
    assert promoted.revision == 3


@pytest.mark.asyncio
async def test_memory_store_expires_stale_clients_without_crossing_users():
    store = MemoryPresenceStore(ttl_seconds=30)
    await store.update('user-a', 'sid-a', update('client-a'), now=0)
    await store.update('user-b', 'sid-b', update('client-b', chat_id='chat-b'), now=20)

    expired = await store.expire(now=31)

    assert [(item.user_id, item.state.active) for item in expired] == [('user-a', None)]
    assert (await store.state('user-b', now=31)).active.chatId == 'chat-b'


@pytest.mark.asyncio
async def test_one_worker_memory_topology_is_allowed():
    store = create_presence_store(
        worker_count=1,
        websocket_manager='memory',
        redis=None,
        redis_key_prefix='test:',
    )
    assert isinstance(store, MemoryPresenceStore)


@pytest.mark.asyncio
async def test_multiworker_without_redis_fails_before_presence_service_starts():
    with pytest.raises(RuntimeError, match='requires Redis'):
        create_presence_store(
            worker_count=2,
            websocket_manager='memory',
            redis=None,
            redis_key_prefix='test:',
        )


@pytest.mark.asyncio
async def test_redis_update_is_atomic_per_user_and_increments_shared_revision():
    redis = fakeredis.aioredis.FakeRedis(decode_responses=True)
    store_a = RedisPresenceStore(redis=redis, key_prefix='test:', ttl_seconds=30)
    store_b = RedisPresenceStore(redis=redis, key_prefix='test:', ttl_seconds=30)

    first, second = await asyncio.gather(
        store_a.update('user-a', 'sid-a', update('client-a'), now=10),
        store_b.update('user-a', 'sid-b', update('client-b', focused_at=20), now=20),
    )

    assert sorted([first.revision, second.revision]) == [1, 2]
    assert (await store_a.state('user-a', now=20)).revision == 2
    await redis.aclose()


@pytest.mark.asyncio
async def test_redis_expiry_is_claimed_once_across_workers():
    redis = fakeredis.aioredis.FakeRedis(decode_responses=True)
    store_a = RedisPresenceStore(redis=redis, key_prefix='test:', ttl_seconds=30)
    store_b = RedisPresenceStore(redis=redis, key_prefix='test:', ttl_seconds=30)
    await store_a.update('user-a', 'sid-a', update(), now=0)

    first, second = await asyncio.gather(store_a.expire(now=31), store_b.expire(now=31))

    assert sorted([len(first), len(second)]) == [0, 1]
    await redis.aclose()


@pytest.mark.asyncio
async def test_lifespan_cancels_and_awaits_the_expiry_task_on_shutdown():
    started = asyncio.Event()

    class Service:
        async def expiry_loop(self):
            started.set()
            await asyncio.Future()

    app = SimpleNamespace(state=SimpleNamespace())
    start_presence_expiry_task(app, Service())
    await started.wait()
    task = app.state.companion_presence_expiry_task

    await stop_presence_expiry_task(app)

    assert task.cancelled()
    assert task.done()
