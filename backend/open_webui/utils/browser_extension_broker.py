from __future__ import annotations

import asyncio
import json
import time
from collections.abc import Awaitable, Callable, Mapping, MutableMapping
from dataclasses import dataclass
from typing import Any
from uuid import uuid4

PROTOCOL_VERSION = 1
DEFAULT_COMMAND_TIMEOUT_SECONDS = 30.0
MAX_RESULT_BYTES = 1_048_576
MAX_PENDING_COMMANDS = 256
MAX_REGISTERED_DEVICES = 10_000
MAX_REGISTERED_SESSIONS = 10_000

CommandTransport = Callable[[str, dict[str, Any], float], Awaitable[Any]]
CancelTransport = Callable[[str, dict[str, Any]], Awaitable[None]]


class BrowserCommandError(RuntimeError):
    def __init__(self, code: str, message: str | None = None):
        self.code = code
        self.message = message or code
        super().__init__(f'{code}: {self.message}' if self.message != code else code)


@dataclass
class _PendingCommand:
    command_id: str
    user_id: str
    device_id: str
    session_id: str
    sid: str
    nonce: str
    sequence: int
    mutating: bool
    future: asyncio.Future[Any]
    transport_task: asyncio.Task[None] | None = None


class BrowserCommandBroker:
    """Route bounded commands to one authenticated browser device and tab."""

    def __init__(
        self,
        *,
        send_command: CommandTransport,
        devices: MutableMapping[str, dict[str, Any]] | None = None,
        sessions: MutableMapping[str, dict[str, Any]] | None = None,
        send_cancel: CancelTransport | None = None,
        default_timeout_seconds: float = DEFAULT_COMMAND_TIMEOUT_SECONDS,
        max_result_bytes: int = MAX_RESULT_BYTES,
        max_pending_commands: int = MAX_PENDING_COMMANDS,
        clock: Callable[[], float] = time.time,
    ):
        self.send_command = send_command
        self.send_cancel = send_cancel
        self.devices = devices if devices is not None else {}
        self.sessions = sessions if sessions is not None else {}
        self.default_timeout_seconds = default_timeout_seconds
        self.max_result_bytes = max_result_bytes
        self.max_pending_commands = max_pending_commands
        self.clock = clock
        self._pending: dict[str, _PendingCommand] = {}
        self._mutating_devices: set[str] = set()
        self._reading_devices: dict[str, int] = {}
        self._sequences: dict[str, int] = {}

    @property
    def pending_count(self) -> int:
        return len(self._pending)

    def get_device(self, device_id: str) -> dict[str, Any] | None:
        return self.devices.get(device_id)

    def get_session(self, session_id: str) -> dict[str, Any] | None:
        return self.sessions.get(session_id)

    def get_device_for_sid(self, sid: str) -> dict[str, Any]:
        return self._device_for_sid(sid)

    def register_device(
        self,
        *,
        user_id: str,
        device_id: str,
        sid: str,
        token_family_id: str,
        origin: str,
    ) -> dict[str, Any]:
        if not all(isinstance(value, str) and value for value in (user_id, device_id, sid, token_family_id, origin)):
            raise BrowserCommandError('invalid_device_registration')
        if device_id not in self.devices and len(self.devices) >= MAX_REGISTERED_DEVICES:
            raise BrowserCommandError('device_registry_full')

        record = {
            'user_id': user_id,
            'device_id': device_id,
            'sid': sid,
            'token_family_id': token_family_id,
            'origin': origin,
            'last_seen_at': self.clock(),
        }
        self.devices[device_id] = record
        return record

    def heartbeat(self, sid: str) -> dict[str, Any]:
        device = self._device_for_sid(sid)
        device = {**device, 'last_seen_at': self.clock()}
        self.devices[device['device_id']] = device
        return device

    def open_session(
        self,
        *,
        sid: str,
        session_id: str,
        tab_id: int,
        tab_origin: str,
        action_mode: str,
        tab_policy: str,
    ) -> dict[str, Any]:
        device = self._device_for_sid(sid)
        if not isinstance(session_id, str) or not session_id:
            raise BrowserCommandError('invalid_session')
        if isinstance(tab_id, bool) or not isinstance(tab_id, int) or tab_id < 0:
            raise BrowserCommandError('invalid_tab')
        if not isinstance(tab_origin, str) or not tab_origin:
            raise BrowserCommandError('invalid_tab_origin')
        if action_mode not in {'autonomous', 'consequential-approval', 'manual-approval'}:
            raise BrowserCommandError('invalid_action_mode')
        if tab_policy not in {'locked', 'follow-active'}:
            raise BrowserCommandError('invalid_tab_policy')

        for existing_id in list(self.sessions.keys()):
            existing = self.sessions.get(existing_id)
            if not existing or existing.get('device_id') != device['device_id']:
                continue
            if existing_id != session_id or existing.get('tab_id') != tab_id:
                raise BrowserCommandError('single_tab_only')

        if session_id not in self.sessions and len(self.sessions) >= MAX_REGISTERED_SESSIONS:
            raise BrowserCommandError('session_registry_full')

        record = {
            'user_id': device['user_id'],
            'device_id': device['device_id'],
            'sid': sid,
            'session_id': session_id,
            'tab_id': tab_id,
            'tab_origin': tab_origin,
            'action_mode': action_mode,
            'tab_policy': tab_policy,
            'opened_at': self.clock(),
        }
        self.sessions[session_id] = record
        return record

    async def close_session(self, sid: str, session_id: str) -> None:
        session = self.sessions.get(session_id)
        if session is None:
            return
        if session.get('sid') != sid:
            raise BrowserCommandError('session_access_denied')
        del self.sessions[session_id]
        await self._fail_matching(
            lambda pending: pending.session_id == session_id,
            BrowserCommandError('session_closed'),
        )

    def session_is_live(self, user_id: str, session_id: str) -> bool:
        session = self.sessions.get(session_id)
        if not session or session.get('user_id') != user_id:
            return False
        device = self.devices.get(str(session.get('device_id')))
        return bool(device and device.get('user_id') == user_id and device.get('sid') == session.get('sid'))

    async def dispatch(
        self,
        user_id: str,
        session_id: str,
        name: str,
        args: Mapping[str, Any],
        mutating: bool,
        *,
        timeout: float | None = None,
    ) -> Any:
        session = self.sessions.get(session_id)
        if not session or session.get('user_id') != user_id:
            raise BrowserCommandError('session_access_denied')
        device_id = str(session.get('device_id', ''))
        device = self.devices.get(device_id)
        if not device or device.get('user_id') != user_id or device.get('sid') != session.get('sid'):
            raise BrowserCommandError('device_unavailable')
        if not isinstance(name, str) or not name or not isinstance(args, Mapping) or not isinstance(mutating, bool):
            raise BrowserCommandError('invalid_command')
        if len(self._pending) >= self.max_pending_commands:
            raise BrowserCommandError('command_registry_full')
        if device_id in self._mutating_devices or (mutating and self._reading_devices.get(device_id, 0) > 0):
            raise BrowserCommandError('device_busy')

        command_timeout = self.default_timeout_seconds if timeout is None else float(timeout)
        if command_timeout <= 0 or command_timeout > self.default_timeout_seconds:
            raise BrowserCommandError('invalid_timeout')

        sequence = self._sequences.get(device_id, 0) + 1
        self._sequences[device_id] = sequence
        command_id = str(uuid4())
        nonce = uuid4().hex
        now = self.clock()
        request = {
            'version': PROTOCOL_VERSION,
            'id': command_id,
            'type': 'command.request',
            'deviceId': device_id,
            'userId': user_id,
            'sessionId': session_id,
            'timestamp': int(now * 1_000),
            'deadlineAt': int((now + command_timeout) * 1_000),
            'nonce': nonce,
            'sequence': sequence,
            'payload': {
                'name': name,
                'args': dict(args),
                'mutating': mutating,
            },
        }
        loop = asyncio.get_running_loop()
        pending = _PendingCommand(
            command_id=command_id,
            user_id=user_id,
            device_id=device_id,
            session_id=session_id,
            sid=str(device['sid']),
            nonce=nonce,
            sequence=sequence,
            mutating=mutating,
            future=loop.create_future(),
        )
        self._pending[command_id] = pending
        if mutating:
            self._mutating_devices.add(device_id)
        else:
            self._reading_devices[device_id] = self._reading_devices.get(device_id, 0) + 1
        pending.transport_task = asyncio.create_task(
            self._run_transport(pending, request, command_timeout),
            name=f'browser-command-{command_id}',
        )

        try:
            return await asyncio.wait_for(asyncio.shield(pending.future), command_timeout)
        except TimeoutError:
            if command_id in self._pending:
                self._remove_pending(command_id)
                pending.future.cancel()
                self._schedule_cancel(pending)
            raise BrowserCommandError('command_timeout') from None
        except asyncio.CancelledError:
            if command_id in self._pending:
                self._remove_pending(command_id)
                pending.future.cancel()
                self._schedule_cancel(pending)
            raise

    async def _run_transport(
        self,
        pending: _PendingCommand,
        request: dict[str, Any],
        timeout: float,
    ) -> None:
        try:
            result = await self.send_command(pending.device_id, request, timeout)
            if result is not None and pending.command_id in self._pending:
                self.accept_result(result, expected_device_id=pending.device_id)
        except asyncio.CancelledError:
            return
        except BrowserCommandError as exc:
            self._fail_pending(pending.command_id, exc)
        except TimeoutError:
            self._fail_pending(pending.command_id, BrowserCommandError('command_timeout'))
        except Exception:
            self._fail_pending(pending.command_id, BrowserCommandError('transport_error'))

    def accept_result(
        self,
        envelope: Any,
        *,
        expected_device_id: str | None = None,
    ) -> Any:
        try:
            encoded = json.dumps(envelope, separators=(',', ':'), ensure_ascii=False).encode('utf-8')
        except (TypeError, ValueError, OverflowError):
            raise BrowserCommandError('invalid_result') from None
        if len(encoded) > self.max_result_bytes:
            raise BrowserCommandError('result_too_large')
        if not isinstance(envelope, Mapping):
            raise BrowserCommandError('invalid_result')

        command_id = envelope.get('id')
        if not isinstance(command_id, str) or not command_id:
            raise BrowserCommandError('invalid_result')
        pending = self._pending.get(command_id)
        if pending is None:
            raise BrowserCommandError('late_result')

        payload = envelope.get('payload')
        identity = (
            envelope.get('version') == PROTOCOL_VERSION
            and envelope.get('type') == 'command.result'
            and envelope.get('deviceId') == pending.device_id
            and envelope.get('userId') == pending.user_id
            and envelope.get('sessionId') == pending.session_id
            and (expected_device_id is None or envelope.get('deviceId') == expected_device_id)
            and isinstance(payload, Mapping)
            and payload.get('nonce') == pending.nonce
            and payload.get('sequence') == pending.sequence
        )
        if not identity:
            raise BrowserCommandError('result_identity_mismatch')
        if not isinstance(payload.get('ok'), bool):
            raise BrowserCommandError('invalid_result')

        self._remove_pending(command_id)
        if payload['ok']:
            value = payload.get('value')
            if not pending.future.done():
                pending.future.set_result(value)
            return value

        error = payload.get('error')
        code = error.get('code') if isinstance(error, Mapping) else None
        message = error.get('message') if isinstance(error, Mapping) else None
        exc = BrowserCommandError(
            code if isinstance(code, str) and code else 'command_failed',
            message if isinstance(message, str) and message else None,
        )
        if not pending.future.done():
            pending.future.set_exception(exc)
        return None

    def accept_approval_result(
        self,
        envelope: Any,
        *,
        expected_device_id: str,
    ) -> dict[str, Any]:
        try:
            encoded = json.dumps(envelope, separators=(',', ':'), ensure_ascii=False).encode('utf-8')
        except (TypeError, ValueError, OverflowError):
            raise BrowserCommandError('invalid_result') from None
        if len(encoded) > self.max_result_bytes:
            raise BrowserCommandError('result_too_large')
        if not isinstance(envelope, Mapping):
            raise BrowserCommandError('invalid_result')

        command_id = envelope.get('id')
        pending = self._pending.get(command_id) if isinstance(command_id, str) else None
        if pending is None:
            raise BrowserCommandError('late_result')
        payload = envelope.get('payload')
        if not (
            envelope.get('version') == PROTOCOL_VERSION
            and envelope.get('type') == 'approval.result'
            and envelope.get('deviceId') == pending.device_id == expected_device_id
            and envelope.get('userId') == pending.user_id
            and envelope.get('sessionId') == pending.session_id
            and isinstance(payload, Mapping)
            and payload.get('nonce') == pending.nonce
            and payload.get('sequence') == pending.sequence
            and isinstance(payload.get('approved'), bool)
        ):
            raise BrowserCommandError('result_identity_mismatch')
        return dict(payload)

    async def cancel(self, *, user_id: str, command_id: str) -> None:
        pending = self._pending.get(command_id)
        if pending is None:
            raise BrowserCommandError('command_not_found')
        if pending.user_id != user_id:
            raise BrowserCommandError('command_access_denied')
        self._remove_pending(command_id)
        if not pending.future.done():
            pending.future.set_exception(BrowserCommandError('command_cancelled'))
        await self._notify_cancel(pending)

    async def disconnect(self, sid: str) -> None:
        disconnected_devices = {
            device_id
            for device_id in list(self.devices.keys())
            if (self.devices.get(device_id) or {}).get('sid') == sid
        }
        for device_id in disconnected_devices:
            del self.devices[device_id]
        for session_id in list(self.sessions.keys()):
            if (self.sessions.get(session_id) or {}).get('sid') == sid:
                del self.sessions[session_id]
        await self._fail_matching(
            lambda pending: pending.device_id in disconnected_devices,
            BrowserCommandError('device_disconnected'),
        )

    def _device_for_sid(self, sid: str) -> dict[str, Any]:
        matches = [
            self.devices.get(device_id)
            for device_id in list(self.devices.keys())
            if (self.devices.get(device_id) or {}).get('sid') == sid
        ]
        if len(matches) != 1 or matches[0] is None:
            raise BrowserCommandError('device_authentication_required')
        return matches[0]

    def _remove_pending(self, command_id: str) -> _PendingCommand | None:
        pending = self._pending.pop(command_id, None)
        if pending is None:
            return None
        if pending.mutating:
            self._mutating_devices.discard(pending.device_id)
        else:
            remaining_reads = self._reading_devices.get(pending.device_id, 1) - 1
            if remaining_reads > 0:
                self._reading_devices[pending.device_id] = remaining_reads
            else:
                self._reading_devices.pop(pending.device_id, None)
        task = pending.transport_task
        if task and task is not asyncio.current_task() and not task.done():
            task.cancel()
        return pending

    def _fail_pending(self, command_id: str, exc: BrowserCommandError) -> None:
        pending = self._remove_pending(command_id)
        if pending and not pending.future.done():
            pending.future.set_exception(exc)

    async def _fail_matching(
        self,
        predicate: Callable[[_PendingCommand], bool],
        exc: BrowserCommandError,
    ) -> None:
        for command_id, pending in list(self._pending.items()):
            if predicate(pending):
                self._remove_pending(command_id)
                if not pending.future.done():
                    pending.future.set_exception(BrowserCommandError(exc.code, exc.message))

    def _schedule_cancel(self, pending: _PendingCommand) -> None:
        if self.send_cancel is not None:
            asyncio.create_task(self._notify_cancel(pending))

    async def _notify_cancel(self, pending: _PendingCommand) -> None:
        if self.send_cancel is None:
            return
        envelope = {
            'version': PROTOCOL_VERSION,
            'id': pending.command_id,
            'type': 'command.cancel',
            'deviceId': pending.device_id,
            'userId': pending.user_id,
            'sessionId': pending.session_id,
            'timestamp': int(self.clock() * 1_000),
            'nonce': pending.nonce,
            'sequence': pending.sequence,
            'payload': {},
        }
        try:
            await self.send_cancel(pending.device_id, envelope)
        except Exception:
            return
