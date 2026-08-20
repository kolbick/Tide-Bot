from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from pydantic import ValidationError

from open_webui.utils.browser_extension_tools import (
    BROWSER_TOOL_NAMES,
    build_browser_extension_tools,
)


def make_tools(*, result=None):
    broker = SimpleNamespace(
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
        dispatch=AsyncMock(return_value={'ok': True} if result is None else result),
    )
    audits = SimpleNamespace(insert=AsyncMock())
    tools = build_browser_extension_tools(
        broker=broker,
        audit_writer=audits,
        user_id='user-a',
        session_id='session-a',
        chat_id='chat-a',
    )
    return tools, broker, audits


def test_exposes_only_the_approved_fixed_tool_schemas():
    tools, _, _ = make_tools()

    assert (
        tuple(tools)
        == BROWSER_TOOL_NAMES
        == (
            'browser_observe',
            'browser_click',
            'browser_type',
            'browser_select',
            'browser_scroll',
            'browser_navigate',
            'browser_go_back',
            'browser_go_forward',
            'browser_reload',
            'browser_wait',
            'browser_screenshot',
            'browser_download',
            'browser_console',
            'browser_network',
            'browser_dom',
            'browser_recording',
        )
    )
    for name, tool in tools.items():
        assert tool['tool_id'] == f'browser-extension:{name}'
        assert tool['type'] == 'browser_extension'
        assert tool['spec']['name'] == name
        assert tool['spec']['parameters']['type'] == 'object'
        assert tool['spec']['parameters']['additionalProperties'] is False
        serialized = str(tool['spec']).lower()
        assert 'javascript' not in serialized
        assert 'runtime.evaluate' not in serialized
        assert 'cdp' not in serialized


@pytest.mark.asyncio
async def test_click_propagates_session_policy_and_uses_mutation_lane():
    tools, broker, audits = make_tools(result={'clicked': True})

    result = await tools['browser_click']['callable'](
        target={'role': 'button', 'name': 'Save'},
        action='click',
        button='left',
    )

    assert result == {'clicked': True}
    broker.dispatch.assert_awaited_once()
    call = broker.dispatch.await_args
    assert call.args[:3] == ('user-a', 'session-a', 'browser_click')
    assert call.args[4] is True
    assert call.args[3]['_policy'] == {
        'actionMode': 'autonomous',
        'tabPolicy': 'locked',
        'risk': 'ordinary',
    }
    audits.insert.assert_awaited_once()
    audit = audits.insert.await_args.kwargs
    assert audit['user_id'] == 'user-a'
    assert audit['device_id'] == 'device-a'
    assert audit['session_id'] == 'session-a'
    assert audit['outcome'] == 'success'


@pytest.mark.asyncio
async def test_password_typing_is_consequential_and_never_echoes_the_value():
    tools, broker, audits = make_tools(
        result={
            'changed': True,
            'typedValue': 'correct horse battery staple',
            'target': {'text': 'correct horse battery staple'},
        }
    )

    result = await tools['browser_type']['callable'](
        target={'label': 'Password'},
        text='correct horse battery staple',
        operation='replace',
        fieldKind='password',
    )

    command = broker.dispatch.await_args.args[3]
    assert command['text'] == 'correct horse battery staple'
    assert command['_policy']['risk'] == 'consequential'
    assert 'correct horse battery staple' not in str(result)
    assert '[REDACTED]' in str(result)
    audit = audits.insert.await_args.kwargs
    assert audit['risk'] == 'consequential'
    assert 'correct horse battery staple' not in audit['summary']


@pytest.mark.asyncio
async def test_network_results_are_allowlisted_and_urls_are_redacted():
    tools, _, _ = make_tools(
        result={
            'entries': [
                {
                    'method': 'GET',
                    'url': 'https://example.com/account?token=top-secret#private',
                    'resourceType': 'fetch',
                    'status': 200,
                    'timing': {'duration': 12.5, 'secret': 'drop-me'},
                    'requestHeaders': {'Authorization': 'Bearer secret'},
                    'body': 'private response',
                },
                {
                    'method': 'TRACE',
                    'url': 'file:///etc/passwd',
                    'resourceType': 'credential',
                    'status': 'secret',
                    'timing': {'duration': 'forever'},
                },
            ],
            'cookies': ['session=secret'],
        }
    )

    result = await tools['browser_network']['callable'](maxEntries=10)

    assert result == {
        'entries': [
            {
                'method': 'GET',
                'url': 'https://example.com/account',
                'resourceType': 'fetch',
                'status': 200,
                'timing': {'duration': 12.5},
            }
        ]
    }
    assert 'top-secret' not in str(result)
    assert 'Authorization' not in str(result)
    assert 'body' not in str(result)


@pytest.mark.asyncio
async def test_console_results_include_only_redacted_severity_and_summary():
    tools, _, _ = make_tools(
        result={
            'entries': [
                {
                    'severity': 'error',
                    'summary': 'Authorization: Bearer abc.def',
                    'stack': 'private stack',
                    'args': [{'password': 'secret'}],
                }
            ]
        }
    )

    result = await tools['browser_console']['callable'](levels=['error'])

    assert result == {
        'entries': [
            {
                'severity': 'error',
                'summary': 'Authorization: Bearer [REDACTED]',
            }
        ]
    }


@pytest.mark.asyncio
async def test_validation_rejects_unknown_keys_invalid_urls_and_raw_selectors():
    tools, broker, _ = make_tools()

    with pytest.raises(ValidationError):
        await tools['browser_click']['callable'](
            target={'role': 'button', 'name': 'Save', 'selector': '#danger'},
        )
    with pytest.raises(ValidationError):
        await tools['browser_navigate']['callable'](url='javascript:alert(1)')
    with pytest.raises(ValidationError):
        await tools['browser_observe']['callable'](secret='value')
    broker.dispatch.assert_not_awaited()


@pytest.mark.asyncio
async def test_observed_opaque_handles_are_valid_semantic_targets():
    tools, broker, _ = make_tools(result={'clicked': True})

    result = await tools['browser_click']['callable'](
        target={'handle': 'tbx_1_1_randomnonce'},
    )

    assert result == {'clicked': True}
    command = broker.dispatch.await_args.args[3]
    assert command['target'] == {'handle': 'tbx_1_1_randomnonce', 'index': 0}


@pytest.mark.asyncio
async def test_failed_calls_write_sanitized_audits_without_tool_arguments():
    tools, broker, audits = make_tools()
    broker.dispatch.side_effect = RuntimeError('password=hunter2')

    with pytest.raises(RuntimeError, match='hunter2'):
        await tools['browser_type']['callable'](
            target={'label': 'Email'},
            text='private@example.com',
        )

    audit = audits.insert.await_args.kwargs
    assert audit['outcome'] == 'failure'
    assert 'hunter2' not in audit['summary']
    assert 'private@example.com' not in audit['summary']
