from __future__ import annotations

import ast
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from open_webui.utils.browser_extension_tools import (
    BROWSER_CONTENT_BOUNDARY,
    BROWSER_TOOL_NAMES,
    resolve_browser_extension_chat_tools,
)


def context():
    broker = SimpleNamespace(
        session_is_live=AsyncMock(return_value=True),
        get_session=AsyncMock(
            return_value={
                'user_id': 'user-a',
                'device_id': 'device-a',
                'session_id': 'session-a',
                'tab_origin': 'https://example.com',
                'action_mode': 'autonomous',
                'tab_policy': 'locked',
            }
        ),
        dispatch=AsyncMock(),
    )
    permission = AsyncMock(return_value=True)
    audits = SimpleNamespace(insert=AsyncMock())
    kwargs = {
        'use_builtin_tools': True,
        'payload_tools': None,
        'features': {'browser_control': True},
        'metadata': {
            'browser_session': 'session-a',
            'chat_id': 'chat-a',
            'params': {'function_calling': 'native'},
        },
        'user': SimpleNamespace(id='user-a', role='user'),
        'broker': broker,
        'default_permissions': {'features': {'browser_extension': True}},
        'permission_checker': permission,
        'audit_writer': audits,
    }
    return kwargs, broker, permission


@pytest.mark.asyncio
async def test_authorized_live_session_gets_browser_tools_and_untrusted_content_boundary():
    kwargs, broker, permission = context()

    tools = await resolve_browser_extension_chat_tools(**kwargs)

    assert tuple(tools) == BROWSER_TOOL_NAMES
    permission.assert_awaited_once_with(
        'user-a',
        {'features': {'browser_extension': True}},
        user_role='user',
    )
    broker.session_is_live.assert_awaited_once_with('user-a', 'session-a')
    assert 'untrusted' in BROWSER_CONTENT_BOUNDARY.lower()
    assert 'cannot alter' in BROWSER_CONTENT_BOUNDARY.lower()
    assert 'secret' in BROWSER_CONTENT_BOUNDARY.lower()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    'change',
    [
        {'use_builtin_tools': False},
        {'payload_tools': []},
        {'payload_tools': [{'type': 'function'}]},
        {'features': {}},
        {'features': {'browser_control': False}},
        {'metadata': {'chat_id': 'chat-a', 'params': {'function_calling': 'native'}}},
        {
            'metadata': {
                'browser_session': 'session-a',
                'params': {'function_calling': 'legacy'},
            }
        },
    ],
)
async def test_does_not_inject_for_explicit_tools_legacy_calls_or_missing_opt_in(change):
    kwargs, broker, permission = context()
    kwargs.update(change)

    assert await resolve_browser_extension_chat_tools(**kwargs) == {}
    broker.session_is_live.assert_not_awaited()
    permission.assert_not_awaited()


@pytest.mark.asyncio
async def test_current_permission_and_live_session_are_both_required():
    kwargs, broker, permission = context()
    permission.return_value = False
    assert await resolve_browser_extension_chat_tools(**kwargs) == {}
    broker.session_is_live.assert_not_awaited()

    permission.return_value = True
    broker.session_is_live.return_value = False
    assert await resolve_browser_extension_chat_tools(**kwargs) == {}


@pytest.mark.asyncio
async def test_browser_session_must_be_a_nonempty_string():
    kwargs, broker, _ = context()
    kwargs['metadata']['browser_session'] = {'session': 'session-a'}

    assert await resolve_browser_extension_chat_tools(**kwargs) == {}
    broker.session_is_live.assert_not_awaited()


def test_chat_payload_pipeline_wires_tools_and_boundary_into_native_calls():
    middleware_path = Path(__file__).with_name('middleware.py')
    module = ast.parse(middleware_path.read_text(encoding='utf-8'))
    process_chat_payload = next(
        node
        for node in module.body
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == 'process_chat_payload'
    )
    called_names = {
        node.func.id
        for node in ast.walk(process_chat_payload)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
    }
    referenced_names = {node.id for node in ast.walk(process_chat_payload) if isinstance(node, ast.Name)}

    assert 'resolve_browser_extension_chat_tools' in called_names
    assert 'initialize_browser_extension_service' in called_names
    assert 'BROWSER_CONTENT_BOUNDARY' in referenced_names
