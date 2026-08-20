import pytest

from open_webui.utils.browser_extension_permissions import has_browser_extension_permission


@pytest.mark.asyncio
async def test_explicit_group_deny_overrides_enabled_default():
    async def group_permissions(_user_id, db=None):
        return [{'features': {'browser_extension': False}}]

    allowed = await has_browser_extension_permission(
        'user-a',
        {'features': {'browser_extension': True}},
        group_permissions_provider=group_permissions,
    )

    assert allowed is False


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ('group_values', 'default_value', 'expected'),
    [
        ([], True, True),
        ([], False, False),
        ([True], False, True),
        ([True, False], True, False),
    ],
)
async def test_permission_resolution(group_values, default_value, expected):
    async def group_permissions(_user_id, db=None):
        return [
            {'features': {'browser_extension': group_value}}
            for group_value in group_values
        ]

    allowed = await has_browser_extension_permission(
        'user-a',
        {'features': {'browser_extension': default_value}},
        group_permissions_provider=group_permissions,
    )

    assert allowed is expected


@pytest.mark.asyncio
async def test_missing_or_malformed_group_values_do_not_grant_access():
    async def group_permissions(_user_id, db=None):
        return [
            {},
            {'features': None},
            {'features': {'browser_extension': 'true'}},
        ]

    allowed = await has_browser_extension_permission(
        'user-a',
        {'features': {'browser_extension': False}},
        group_permissions_provider=group_permissions,
    )

    assert allowed is False


@pytest.mark.asyncio
async def test_admin_role_is_always_allowed():
    async def group_permissions(_user_id, db=None):
        return [{'features': {'browser_extension': False}}]

    allowed = await has_browser_extension_permission(
        'admin-a',
        {'features': {'browser_extension': False}},
        user_role='admin',
        group_permissions_provider=group_permissions,
    )

    assert allowed is True
