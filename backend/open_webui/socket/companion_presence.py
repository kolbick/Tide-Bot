from __future__ import annotations

import asyncio
import json
import math
import time
from collections import defaultdict, deque
from collections.abc import AsyncIterator, Awaitable, Callable, Mapping
from contextlib import asynccontextmanager
from dataclasses import asdict, dataclass, replace
from typing import Any, Protocol
from uuid import uuid4

PRESENCE_TTL_SECONDS = 30
PRESENCE_RATE_LIMIT = 30
PRESENCE_RATE_WINDOW_SECONDS = 60
PRESENCE_EXPIRY_INTERVAL_SECONDS = 1

_FIELD_LIMITS = {
    'clientId': 128,
    'chatId': 128,
    'chatTitle': 512,
    'deviceLabel': 128,
}
_PRESENCE_FIELDS = frozenset((*_FIELD_LIMITS, 'isFocused', 'focusedAt'))


@dataclass(frozen=True)
class PresenceUpdate:
    clientId: str
    chatId: str | None
    chatTitle: str | None
    deviceLabel: str
    isFocused: bool
    focusedAt: float

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class PresenceState:
    active: PresenceUpdate | None
    revision: int

    def as_dict(self) -> dict[str, Any]:
        return {
            'active': self.active.as_dict() if self.active else None,
            'revision': self.revision,
        }


@dataclass(frozen=True)
class PresenceExpiry:
    user_id: str
    state: PresenceState


def validate_presence_update(data: Any) -> PresenceUpdate:
    if not isinstance(data, Mapping):
        raise ValueError('payload must be an object')

    keys = frozenset(data)
    unknown = keys - _PRESENCE_FIELDS
    missing = _PRESENCE_FIELDS - keys
    if unknown:
        raise ValueError('unknown field')
    if missing:
        raise ValueError(f'missing field: {sorted(missing)[0]}')

    clears_presence = data['chatId'] is None and data['chatTitle'] is None
    if (data['chatId'] is None) != (data['chatTitle'] is None):
        raise ValueError('chatId and chatTitle must both be null or strings')

    values: dict[str, Any] = {}
    for field, limit in _FIELD_LIMITS.items():
        value = data[field]
        if clears_presence and field in ('chatId', 'chatTitle'):
            values[field] = None
            continue
        if not isinstance(value, str) or (field in ('clientId', 'chatId') and not value):
            raise ValueError(f'{field} must be a valid string')
        if len(value) > limit:
            raise ValueError(f'{field} is too long')
        values[field] = value

    is_focused = data['isFocused']
    if not isinstance(is_focused, bool):
        raise ValueError('isFocused must be a boolean')

    focused_at = data['focusedAt']
    if isinstance(focused_at, bool) or not isinstance(focused_at, (int, float)):
        raise ValueError('focusedAt must be a number')
    if not math.isfinite(focused_at) or focused_at < 0:
        raise ValueError('focusedAt must be zero or greater')

    return PresenceUpdate(
        **values,
        isFocused=is_focused,
        focusedAt=focused_at,
    )


class PresenceStore(Protocol):
    async def update(self, user_id: str, sid: str, presence: PresenceUpdate, *, now: float) -> PresenceState: ...

    async def state(self, user_id: str, *, now: float) -> PresenceState: ...

    async def disconnect(self, user_id: str, sid: str, *, now: float) -> PresenceState | None: ...

    async def expire(self, *, now: float) -> list[PresenceExpiry]: ...

    def emission_lock(self, user_id: str): ...


@dataclass
class _MemoryEntry:
    presence: PresenceUpdate
    updated_at: float
    expires_at: float


class MemoryPresenceStore:
    def __init__(self, *, ttl_seconds: int = PRESENCE_TTL_SECONDS):
        self.ttl_seconds = ttl_seconds
        self._entries: dict[str, dict[str, _MemoryEntry]] = defaultdict(dict)
        self._revisions: dict[str, int] = defaultdict(int)
        self._lock = asyncio.Lock()
        self._emission_locks: dict[str, asyncio.Lock] = defaultdict(asyncio.Lock)

    @staticmethod
    def _active(entries: Mapping[str, _MemoryEntry]) -> PresenceUpdate | None:
        if not entries:
            return None
        focused = [entry for entry in entries.values() if entry.presence.isFocused]
        candidates = focused or list(entries.values())
        winner = max(
            candidates,
            key=lambda entry: (
                entry.presence.focusedAt if focused else entry.updated_at,
                entry.updated_at,
                entry.presence.clientId,
            ),
        )
        return winner.presence

    def _state(self, user_id: str) -> PresenceState:
        return PresenceState(
            active=self._active(self._entries.get(user_id, {})),
            revision=self._revisions.get(user_id, 0),
        )

    async def update(self, user_id: str, sid: str, presence: PresenceUpdate, *, now: float) -> PresenceState:
        async with self._lock:
            entries = self._entries[user_id]
            for stale_sid in [key for key, entry in entries.items() if entry.expires_at <= now]:
                del entries[stale_sid]
            entries[sid] = _MemoryEntry(
                presence=presence,
                updated_at=now,
                expires_at=now + self.ttl_seconds,
            )
            self._revisions[user_id] += 1
            return self._state(user_id)

    async def state(self, user_id: str, *, now: float) -> PresenceState:
        async with self._lock:
            entries = {sid: entry for sid, entry in self._entries.get(user_id, {}).items() if entry.expires_at > now}
            return PresenceState(
                active=self._active(entries),
                revision=self._revisions.get(user_id, 0),
            )

    async def disconnect(self, user_id: str, sid: str, *, now: float) -> PresenceState | None:
        async with self._lock:
            entries = self._entries.get(user_id)
            if not entries or sid not in entries:
                return None
            del entries[sid]
            self._revisions[user_id] += 1
            return self._state(user_id)

    async def expire(self, *, now: float) -> list[PresenceExpiry]:
        changes: list[PresenceExpiry] = []
        async with self._lock:
            for user_id, entries in list(self._entries.items()):
                stale = [sid for sid, entry in entries.items() if entry.expires_at <= now]
                if not stale:
                    continue
                for sid in stale:
                    del entries[sid]
                self._revisions[user_id] += 1
                changes.append(PresenceExpiry(user_id=user_id, state=self._state(user_id)))
        return changes

    @asynccontextmanager
    async def emission_lock(self, user_id: str) -> AsyncIterator[None]:
        async with self._emission_locks[user_id]:
            yield


_REDIS_SELECT_ACTIVE = """
local focused = {}
local unfocused = {}
for sid, entry in pairs(state.entries) do
  if entry.expiresAt > now then
    if entry.record.isFocused then
      table.insert(focused, entry)
    else
      table.insert(unfocused, entry)
    end
  end
end
local candidates = focused
if #candidates == 0 then candidates = unfocused end
local active = cjson.null
local bestPrimary = -1
local bestUpdated = -1
local bestClient = ''
for _, entry in ipairs(candidates) do
  local primary = entry.updatedAt
  if #focused > 0 then primary = entry.record.focusedAt end
  local client = entry.record.clientId
  if primary > bestPrimary or
     (primary == bestPrimary and entry.updatedAt > bestUpdated) or
     (primary == bestPrimary and entry.updatedAt == bestUpdated and client > bestClient) then
    active = entry.record
    bestPrimary = primary
    bestUpdated = entry.updatedAt
    bestClient = client
  end
end
"""

_REDIS_UPDATE_LUA = (
    """
local raw = redis.call('GET', KEYS[1])
local state = {revision = 0, entries = {}}
if raw then state = cjson.decode(raw) end
local now = tonumber(ARGV[1])
local ttl = tonumber(ARGV[2])
for sid, entry in pairs(state.entries) do
  if entry.expiresAt <= now then state.entries[sid] = nil end
end
state.entries[ARGV[3]] = {
  record = cjson.decode(ARGV[4]),
  updatedAt = now,
  expiresAt = now + ttl
}
state.revision = state.revision + 1
"""
    + _REDIS_SELECT_ACTIVE
    + """
if next(state.entries) == nil then
  redis.call('DEL', KEYS[1])
else
  redis.call('SET', KEYS[1], cjson.encode(state))
end
return cjson.encode({active = active, revision = state.revision})
"""
)

_REDIS_STATE_LUA = (
    """
local raw = redis.call('GET', KEYS[1])
if not raw then return cjson.encode({active = cjson.null, revision = 0}) end
local state = cjson.decode(raw)
local now = tonumber(ARGV[1])
"""
    + _REDIS_SELECT_ACTIVE
    + """
return cjson.encode({active = active, revision = state.revision})
"""
)

_REDIS_DISCONNECT_LUA = (
    """
local raw = redis.call('GET', KEYS[1])
if not raw then return '' end
local state = cjson.decode(raw)
if not state.entries[ARGV[2]] then return '' end
local now = tonumber(ARGV[1])
state.entries[ARGV[2]] = nil
state.revision = state.revision + 1
"""
    + _REDIS_SELECT_ACTIVE
    + """
if next(state.entries) == nil then
  redis.call('DEL', KEYS[1])
else
  redis.call('SET', KEYS[1], cjson.encode(state))
end
return cjson.encode({active = active, revision = state.revision})
"""
)

_REDIS_EXPIRE_LUA = (
    """
local raw = redis.call('GET', KEYS[1])
if not raw then return '' end
local state = cjson.decode(raw)
local now = tonumber(ARGV[1])
local changed = false
for sid, entry in pairs(state.entries) do
  if entry.expiresAt <= now then
    state.entries[sid] = nil
    changed = true
  end
end
if not changed then return '' end
state.revision = state.revision + 1
"""
    + _REDIS_SELECT_ACTIVE
    + """
if next(state.entries) == nil then
  redis.call('DEL', KEYS[1])
else
  redis.call('SET', KEYS[1], cjson.encode(state))
end
return cjson.encode({active = active, revision = state.revision})
"""
)

_REDIS_RELEASE_LOCK_LUA = """
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
"""


class RedisPresenceStore:
    def __init__(self, *, redis, key_prefix: str, ttl_seconds: int = PRESENCE_TTL_SECONDS):
        if redis is None:
            raise RuntimeError('Redis-backed companion presence requires Redis')
        self.redis = redis
        self.ttl_seconds = ttl_seconds
        separator = '' if key_prefix.endswith(':') else ':'
        self.namespace = f'{key_prefix}{separator}companion_presence:'
        self.key_prefix = f'{self.namespace}user:'

    def _key(self, user_id: str) -> str:
        return f'{self.key_prefix}{user_id}'

    @staticmethod
    def _decode_state(raw: str | bytes) -> PresenceState:
        data = json.loads(raw)
        active = PresenceUpdate(**data['active']) if data.get('active') else None
        return PresenceState(active=active, revision=int(data['revision']))

    async def update(self, user_id: str, sid: str, presence: PresenceUpdate, *, now: float) -> PresenceState:
        raw = await self.redis.eval(
            _REDIS_UPDATE_LUA,
            1,
            self._key(user_id),
            now,
            self.ttl_seconds,
            sid,
            json.dumps(presence.as_dict(), separators=(',', ':')),
        )
        return self._decode_state(raw)

    async def state(self, user_id: str, *, now: float) -> PresenceState:
        raw = await self.redis.eval(_REDIS_STATE_LUA, 1, self._key(user_id), now)
        return self._decode_state(raw)

    async def disconnect(self, user_id: str, sid: str, *, now: float) -> PresenceState | None:
        raw = await self.redis.eval(_REDIS_DISCONNECT_LUA, 1, self._key(user_id), now, sid)
        return self._decode_state(raw) if raw else None

    async def expire(self, *, now: float) -> list[PresenceExpiry]:
        changes: list[PresenceExpiry] = []
        async for key in self.redis.scan_iter(match=f'{self.key_prefix}*', count=100):
            raw = await self.redis.eval(_REDIS_EXPIRE_LUA, 1, key, now)
            if not raw:
                continue
            key_text = key.decode() if isinstance(key, bytes) else key
            changes.append(
                PresenceExpiry(
                    user_id=key_text.removeprefix(self.key_prefix),
                    state=self._decode_state(raw),
                )
            )
        return changes

    @asynccontextmanager
    async def emission_lock(self, user_id: str) -> AsyncIterator[None]:
        key = f'{self.namespace}emit_lock:{user_id}'
        token = uuid4().hex
        deadline = asyncio.get_running_loop().time() + 5
        while not await self.redis.set(key, token, nx=True, px=30_000):
            if asyncio.get_running_loop().time() >= deadline:
                raise RuntimeError('Timed out ordering companion presence state emission')
            await asyncio.sleep(0.01)
        try:
            yield
        finally:
            await self.redis.eval(_REDIS_RELEASE_LOCK_LUA, 1, key, token)


def create_presence_store(
    *,
    worker_count: int,
    websocket_manager: str,
    redis,
    redis_key_prefix: str,
) -> PresenceStore:
    if websocket_manager == 'redis':
        return RedisPresenceStore(redis=redis, key_prefix=redis_key_prefix)
    if worker_count != 1:
        raise RuntimeError('Ted-Bot companion presence with multiple workers requires Redis')
    return MemoryPresenceStore()


class CompanionPresenceSocketService:
    def __init__(
        self,
        *,
        sio,
        session_pool,
        store: PresenceStore,
        get_readable_chat: Callable[..., Awaitable[Any]] | None = None,
        db_factory: Callable[[], Any] | None = None,
        clock: Callable[[], float] = time.time,
    ):
        self.sio = sio
        self.session_pool = session_pool
        self.store = store
        self.get_readable_chat = get_readable_chat
        self.db_factory = db_factory
        self.clock = clock
        self._rate_windows: dict[str, deque[float]] = defaultdict(deque)

    def _session(self, sid: str) -> Mapping[str, Any] | None:
        session = self.session_pool.get(sid)
        if not isinstance(session, Mapping) or not session.get('id') or not session.get('role'):
            return None
        return session

    def _consume_rate_limit(self, sid: str, now: float) -> bool:
        window = self._rate_windows[sid]
        cutoff = now - PRESENCE_RATE_WINDOW_SECONDS
        while window and window[0] <= cutoff:
            window.popleft()
        if len(window) >= PRESENCE_RATE_LIMIT:
            return False
        window.append(now)
        return True

    async def _emit(self, user_id: str, state: PresenceState) -> None:
        async with self.store.emission_lock(user_id):
            latest = await self.store.state(user_id, now=self.clock())
            ordered_state = latest if latest.revision > state.revision else state
            await self.sio.emit(
                'companion:presence:state',
                ordered_state.as_dict(),
                room=f'user:{user_id}',
            )

    async def update(self, sid: str, data: Any) -> dict[str, Any]:
        session = self._session(sid)
        if session is None:
            return {'ok': False, 'error': 'authentication_required'}
        try:
            presence = validate_presence_update(data)
        except ValueError:
            return {'ok': False, 'error': 'invalid_payload'}

        now = self.clock()
        if not self._consume_rate_limit(sid, now):
            return {'ok': False, 'error': 'rate_limited'}

        if presence.chatId is None:
            state = await self.store.disconnect(session['id'], sid, now=now)
            if state is None:
                state = await self.store.state(session['id'], now=now)
            await self._emit(session['id'], state)
            return {'ok': True, 'revision': state.revision}

        if self.get_readable_chat is None:
            from open_webui.utils.chat_access import get_readable_chat

            readable_chat = get_readable_chat
        else:
            readable_chat = self.get_readable_chat
        if self.db_factory is None:
            from open_webui.internal.db import get_async_db

            db_factory = get_async_db
        else:
            db_factory = self.db_factory

        async with db_factory() as db:
            chat = await readable_chat(
                user_id=session['id'],
                role=session['role'],
                chat_id=presence.chatId,
                db=db,
            )
        if chat is None:
            return {'ok': False, 'error': 'chat_access_denied'}

        canonical = replace(presence, chatTitle=chat.title)
        state = await self.store.update(session['id'], sid, canonical, now=now)
        await self._emit(session['id'], state)
        return {'ok': True, 'revision': state.revision}

    async def subscribe(self, sid: str) -> dict[str, Any]:
        session = self._session(sid)
        if session is None:
            return {'ok': False, 'error': 'authentication_required'}
        room = f'user:{session["id"]}'
        await self.sio.enter_room(sid, room)
        state = await self.store.state(session['id'], now=self.clock())
        await self._emit(session['id'], state)
        return {'ok': True, 'revision': state.revision}

    async def disconnect(self, sid: str) -> PresenceState | None:
        session = self._session(sid)
        self._rate_windows.pop(sid, None)
        if session is None:
            return None
        state = await self.store.disconnect(session['id'], sid, now=self.clock())
        if state is not None:
            await self._emit(session['id'], state)
        return state

    async def expire(self) -> list[PresenceExpiry]:
        changes = await self.store.expire(now=self.clock())
        for change in changes:
            await self._emit(change.user_id, change.state)
        return changes

    async def expiry_loop(self) -> None:
        while True:
            await asyncio.sleep(PRESENCE_EXPIRY_INTERVAL_SECONDS)
            await self.expire()


def start_presence_expiry_task(app, service: CompanionPresenceSocketService):
    task = asyncio.create_task(service.expiry_loop())
    app.state.companion_presence_expiry_task = task
    return task


async def stop_presence_expiry_task(app) -> None:
    task = getattr(app.state, 'companion_presence_expiry_task', None)
    if task is None:
        return
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass
