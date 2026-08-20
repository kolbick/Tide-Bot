from types import SimpleNamespace

import pytest

from open_webui.models.browser_extension import BrowserSchedules, BrowserWorkflows
from open_webui.routers.test_browser_extension_pairing import (
    api,
    approve_pairing,
    exchange_pairing,
    start_pairing,
)


async def paired_device(api):
    started = (await start_pairing(api)).json()
    await approve_pairing(api, started)
    return (await exchange_pairing(api, started)).json()['device']


def workflow_definition(url='https://example.com/report'):
    return {
        'schemaVersion': 1,
        'origin': 'https://example.com',
        'steps': [
            {'action': 'navigate', 'url': url},
            {
                'action': 'click',
                'target': {'role': 'button', 'name': 'Open report', 'tag': 'button'},
            },
        ],
    }


@pytest.mark.asyncio
async def test_workflow_round_trip_is_owner_scoped_encrypted_and_versioned(api):
    created = await api.client.post(
        '/api/v1/browser-extension/workflows',
        json={'name': 'Morning report', 'definition': workflow_definition()},
    )
    assert created.status_code == 200
    value = created.json()
    assert value['version'] == 1
    assert value['definition'] == workflow_definition()

    stored = await BrowserWorkflows.get_by_id_and_user_id(value['id'], 'user-a', db=api.db)
    assert 'example.com' not in stored.encrypted_definition
    assert 'Open report' not in stored.encrypted_definition

    conflict = await api.client.put(
        f'/api/v1/browser-extension/workflows/{value["id"]}',
        json={
            'name': 'Updated report',
            'version': 7,
            'definition': workflow_definition('https://example.com/new'),
        },
    )
    assert conflict.status_code == 409
    assert conflict.json()['detail'] == 'workflow_version_conflict'

    updated = await api.client.put(
        f'/api/v1/browser-extension/workflows/{value["id"]}',
        json={
            'name': 'Updated report',
            'version': 1,
            'definition': workflow_definition('https://example.com/new'),
        },
    )
    assert updated.status_code == 200
    assert updated.json()['version'] == 2
    assert updated.json()['definition']['steps'][0]['url'].endswith('/new')

    api.state.user = SimpleNamespace(id='user-b', role='user', name='Other')
    assert (await api.client.get('/api/v1/browser-extension/workflows')).json() == []
    assert (await api.client.get(f'/api/v1/browser-extension/workflows/{value["id"]}')).status_code == 404


@pytest.mark.asyncio
async def test_schedule_crud_validates_rrule_timezone_and_owned_device(api):
    device = await paired_device(api)
    workflow = (
        await api.client.post(
            '/api/v1/browser-extension/workflows',
            json={'name': 'Morning report', 'definition': workflow_definition()},
        )
    ).json()

    invalid = await api.client.post(
        '/api/v1/browser-extension/schedules',
        json={
            'workflow_id': workflow['id'],
            'device_id': device['id'],
            'name': 'Unsafe schedule',
            'rrule': 'FREQ=SECONDLY;INTERVAL=1',
            'timezone': 'Mars/Olympus',
            'next_run_at': 2_000_000_000,
        },
    )
    assert invalid.status_code == 422

    created = await api.client.post(
        '/api/v1/browser-extension/schedules',
        json={
            'workflow_id': workflow['id'],
            'device_id': device['id'],
            'name': 'Daily report',
            'rrule': 'FREQ=DAILY;INTERVAL=1',
            'timezone': 'America/New_York',
            'next_run_at': 2_000_000_000,
        },
    )
    assert created.status_code == 200
    schedule = created.json()
    assert schedule['device_id'] == device['id']
    assert [item['id'] for item in (await api.client.get('/api/v1/browser-extension/schedules')).json()] == [
        schedule['id']
    ]

    completed = await api.client.post(
        f'/api/v1/browser-extension/schedules/{schedule["id"]}/runs',
        json={
            'outcome': 'complete',
            'last_run_at': 2_000_000_000,
            'next_run_at': 86_402_000_000_000,
        },
    )
    assert completed.status_code == 200
    stored = await BrowserSchedules.get_by_id_and_user_id(schedule['id'], 'user-a', db=api.db)
    assert stored.last_run_at == 2_000_000_000
    assert stored.next_run_at == 86_402_000_000_000
    assert stored.catch_up_pending is False

    deleted = await api.client.delete(f'/api/v1/browser-extension/schedules/{schedule["id"]}')
    assert deleted.status_code == 200
    assert await BrowserSchedules.get_by_id_and_user_id(schedule['id'], 'user-a', db=api.db) is None


@pytest.mark.asyncio
async def test_workflow_payload_rejects_secret_values_and_raw_selectors(api):
    for definition in [
        {
            'schemaVersion': 1,
            'origin': 'https://example.com',
            'steps': [
                {
                    'action': 'type-intent',
                    'target': {'role': 'textbox', 'name': 'Password', 'tag': 'input'},
                    'sensitive': True,
                    'text': 'hunter2',
                }
            ],
        },
        {
            'schemaVersion': 1,
            'origin': 'https://example.com',
            'steps': [{'action': 'click', 'target': {'selector': '#purchase'}}],
        },
    ]:
        response = await api.client.post(
            '/api/v1/browser-extension/workflows',
            json={'name': 'Rejected', 'definition': definition},
        )
        assert response.status_code == 422
        assert 'hunter2' not in response.text
