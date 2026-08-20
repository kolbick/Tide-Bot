from __future__ import annotations

import inspect
from collections.abc import Awaitable, Callable, Mapping
from typing import Any

from open_webui.env import WEBUI_SECRET_KEY
from open_webui.models.browser_extension import BrowserPairedDevices
from open_webui.models.config import Config
from open_webui.models.users import Users
from open_webui.utils.browser_extension_auth import decode_browser_access_token
from open_webui.utils.browser_extension_broker import (
    BrowserCommandBroker,
    BrowserCommandError,
)
from open_webui.utils.browser_extension_permissions import has_browser_extension_permission

AccessTokenDecoder = Callable[[str, str], Any]
DeviceGetter = Callable[[str], Awaitable[Any]]
UserGetter = Callable[[str], Awaitable[Any]]
PermissionChecker = Callable[[Any], Awaitable[bool]]


def _value(record: Any, field: str) -> Any:
    if isinstance(record, Mapping):
        return record.get(field)
    return getattr(record, field, None)


async def _await_if_needed(value: Any) -> Any:
    if inspect.isawaitable(value):
        return await value
    return value


def _decode_access_token(token: str, origin: str) -> dict[str, Any]:
    return decode_browser_access_token(
        token,
        secret_key=WEBUI_SECRET_KEY,
        expected_origin=origin,
    )


async def _get_device(device_id: str) -> Any:
    return await BrowserPairedDevices.get_active_by_id(device_id)


async def _get_user(user_id: str) -> Any:
    return await Users.get_user_by_id(user_id)


async def _has_permission(user: Any) -> bool:
    permissions = await Config.get(
        'user.permissions',
        {'features': {'browser_extension': True}},
    )
    return await has_browser_extension_permission(
        _value(user, 'id'),
        permissions,
        user_role=_value(user, 'role'),
    )


class BrowserExtensionSocketService:
    """Authenticate extension sockets before exposing browser-only rooms."""

    def __init__(
        self,
        *,
        sio: Any,
        broker: BrowserCommandBroker,
        decode_access_token: AccessTokenDecoder = _decode_access_token,
        get_device: DeviceGetter = _get_device,
        get_user: UserGetter = _get_user,
        has_permission: PermissionChecker = _has_permission,
    ):
        self.sio = sio
        self.broker = broker
        self.decode_access_token = decode_access_token
        self.get_device = get_device
        self.get_user = get_user
        self.has_permission = has_permission

    async def join(self, sid: str, data: Any) -> dict[str, Any]:
        if not isinstance(data, Mapping) or set(data) != {'accessToken', 'origin'}:
            return self._error('invalid_payload')
        token = data.get('accessToken')
        origin = data.get('origin')
        if not isinstance(token, str) or not token or not isinstance(origin, str) or not origin:
            return self._error('invalid_payload')

        try:
            claims = await _await_if_needed(self.decode_access_token(token, origin))
        except Exception:
            return self._error('invalid_access_token')
        if not isinstance(claims, Mapping):
            return self._error('invalid_access_token')

        user_id = claims.get('id')
        device_id = claims.get('device_id')
        family_id = claims.get('token_family_id')
        claim_origin = claims.get('origin')
        if not all(isinstance(value, str) and value for value in (user_id, device_id, family_id, claim_origin)):
            return self._error('invalid_access_token')

        device = await self.get_device(device_id)
        if device is None:
            return self._error('device_revoked')
        if _value(device, 'revoked_at') is not None:
            return self._error('device_revoked')
        if not (
            _value(device, 'id') == device_id
            and _value(device, 'user_id') == user_id
            and _value(device, 'token_family_id') == family_id
            and _value(device, 'allowed_origin') == claim_origin == origin
        ):
            return self._error('device_identity_mismatch')

        user = await self.get_user(user_id)
        if user is None or _value(user, 'role') not in {'user', 'admin'}:
            return self._error('browser_extension_not_allowed')
        if not await self.has_permission(user):
            return self._error('browser_extension_not_allowed')

        try:
            existing = self.broker.get_device(device_id)
            if existing and existing.get('sid') != sid:
                await self.broker.disconnect(str(existing['sid']))
            self.broker.register_device(
                user_id=user_id,
                device_id=device_id,
                sid=sid,
                token_family_id=family_id,
                origin=origin,
            )
        except BrowserCommandError as exc:
            return self._error(exc.code)

        await self.sio.enter_room(sid, f'browser:user:{user_id}')
        await self.sio.enter_room(sid, f'browser:device:{device_id}')
        return {'ok': True, 'userId': user_id, 'deviceId': device_id}

    async def heartbeat(self, sid: str, data: Any = None) -> dict[str, Any]:
        if data not in (None, {}) or (isinstance(data, Mapping) and set(data)):
            return self._error('invalid_payload')
        try:
            self.broker.heartbeat(sid)
        except BrowserCommandError as exc:
            return self._error(exc.code)
        return {'ok': True}

    async def open_session(self, sid: str, data: Any) -> dict[str, Any]:
        expected = {'sessionId', 'tabId', 'tabOrigin', 'actionMode', 'tabPolicy'}
        if not isinstance(data, Mapping) or set(data) != expected:
            return self._error('invalid_payload')
        try:
            session = self.broker.open_session(
                sid=sid,
                session_id=data['sessionId'],
                tab_id=data['tabId'],
                tab_origin=data['tabOrigin'],
                action_mode=data['actionMode'],
                tab_policy=data['tabPolicy'],
            )
        except BrowserCommandError as exc:
            return self._error(exc.code)
        return {'ok': True, 'sessionId': session['session_id']}

    async def close_session(self, sid: str, data: Any) -> dict[str, Any]:
        if not isinstance(data, Mapping) or set(data) != {'sessionId'}:
            return self._error('invalid_payload')
        session_id = data.get('sessionId')
        if not isinstance(session_id, str) or not session_id:
            return self._error('invalid_payload')
        try:
            await self.broker.close_session(sid, session_id)
        except BrowserCommandError as exc:
            return self._error(exc.code)
        return {'ok': True}

    async def command_result(self, sid: str, data: Any) -> dict[str, Any]:
        try:
            device = self.broker.get_device_for_sid(sid)
            self.broker.accept_result(
                data,
                expected_device_id=device['device_id'],
            )
        except BrowserCommandError as exc:
            return self._error(exc.code)
        return {'ok': True}

    async def approval_result(self, sid: str, data: Any) -> dict[str, Any]:
        try:
            device = self.broker.get_device_for_sid(sid)
            self.broker.accept_approval_result(
                data,
                expected_device_id=device['device_id'],
            )
        except BrowserCommandError as exc:
            return self._error(exc.code)
        return {'ok': True}

    async def disconnect(self, sid: str) -> None:
        await self.broker.disconnect(sid)

    @staticmethod
    def _error(code: str) -> dict[str, Any]:
        return {'ok': False, 'error': code}
