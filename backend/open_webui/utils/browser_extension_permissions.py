from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any


GroupPermissionsProvider = Callable[[str, Any], Awaitable[list[dict[str, Any]]]]


async def _stored_group_permissions(user_id: str, db=None) -> list[dict[str, Any]]:
    from open_webui.models.groups import Groups

    groups = await Groups.get_groups_by_member_id(user_id, db=db)
    return [group.permissions for group in groups if isinstance(group.permissions, dict)]


async def has_browser_extension_permission(
    user_id: str,
    default_permissions: dict[str, Any] | None,
    db=None,
    *,
    user_role: str | None = None,
    group_permissions_provider: GroupPermissionsProvider | None = None,
) -> bool:
    """Resolve browser control access with explicit, deny-wins group overrides.

    Existing Tide-Bot feature permissions remain additive. Browser control is
    intentionally stricter because it can act on the user's behalf.
    """

    if user_role == 'admin':
        return True

    provider = group_permissions_provider or _stored_group_permissions
    group_permissions = await provider(user_id, db)
    explicit: list[bool] = []
    for permissions in group_permissions:
        features = permissions.get('features') if isinstance(permissions, dict) else None
        if isinstance(features, dict) and isinstance(features.get('browser_extension'), bool):
            explicit.append(features['browser_extension'])

    if False in explicit:
        return False
    if True in explicit:
        return True

    features = (default_permissions or {}).get('features') or {}
    return bool(features.get('browser_extension', True))
