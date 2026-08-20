import os
from contextlib import asynccontextmanager

os.environ.setdefault('WEBUI_SECRET_KEY', 'browser-extension-model-test-secret')
os.environ.setdefault('ENABLE_DB_MIGRATIONS', 'false')

import pytest
import pytest_asyncio
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

import open_webui.models.browser_extension as browser_extension
from open_webui.internal.db import Base
from open_webui.models.browser_extension import (
    BROWSER_EXTENSION_TABLES,
    BrowserActionAudits,
    BrowserPairedDevices,
    BrowserPairingGrants,
    BrowserSchedules,
    BrowserWorkflows,
)


@pytest_asyncio.fixture
async def db(monkeypatch):
    engine = create_async_engine('sqlite+aiosqlite:///:memory:')
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all, tables=BROWSER_EXTENSION_TABLES)

    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as session:

        @asynccontextmanager
        async def test_db_context(existing=None):
            yield existing or session

        monkeypatch.setattr(browser_extension, 'get_async_db_context', test_db_context)
        yield session

    await engine.dispose()


async def create_device(db, *, user_id='user-a', label='My Chrome', now_ns=10):
    return await BrowserPairedDevices.insert(
        user_id=user_id,
        label=label,
        refresh_token_hash=f'hash-{user_id}-{label}',
        token_family_id=f'family-{user_id}-{label}',
        allowed_origin='https://tide-bot.com',
        extension_version='1.0.0',
        now_ns=now_ns,
        db=db,
    )


@pytest.mark.asyncio
async def test_device_retrieval_is_owner_scoped_and_revocation_is_durable(db):
    device = await create_device(db)

    assert await BrowserPairedDevices.get_by_id_and_user_id(device.id, 'user-b', db=db) is None
    assert (await BrowserPairedDevices.get_by_id_and_user_id(device.id, 'user-a', db=db)).id == device.id

    revoked = await BrowserPairedDevices.revoke(device.id, 'user-a', now_ns=50, db=db)

    assert revoked.revoked_at == 50
    assert await BrowserPairedDevices.get_active_by_id(device.id, db=db) is None


@pytest.mark.asyncio
async def test_device_labels_are_unique_per_user(db):
    await create_device(db)

    with pytest.raises(IntegrityError):
        await create_device(db, now_ns=20)
    await db.rollback()

    other = await create_device(db, user_id='user-b', now_ns=30)
    assert other.label == 'My Chrome'


@pytest.mark.asyncio
async def test_pairing_grant_can_only_be_consumed_once(db):
    grant = await BrowserPairingGrants.insert(
        device_code_hash='device-code-hash',
        verifier_hash='verifier-hash',
        requested_origin='https://tide-bot.com',
        expires_at=1_000,
        now_ns=10,
        db=db,
    )
    approved = await BrowserPairingGrants.approve(grant.id, 'user-a', now_ns=20, db=db)

    first = await BrowserPairingGrants.consume(
        grant.id,
        verifier_hash='verifier-hash',
        now_ns=30,
        db=db,
    )
    second = await BrowserPairingGrants.consume(
        grant.id,
        verifier_hash='verifier-hash',
        now_ns=40,
        db=db,
    )

    assert approved.status == 'approved'
    assert first.status == 'consumed'
    assert first.consumed_at == 30
    assert second is None


@pytest.mark.asyncio
async def test_schedule_requires_workflow_and_device_owned_by_same_user(db):
    device = await create_device(db)
    other_device = await create_device(db, user_id='user-b', label='Other Chrome')
    workflow = await BrowserWorkflows.insert(
        user_id='user-a',
        name='Reserve a tide slot',
        encrypted_definition='ciphertext',
        definition_nonce='nonce',
        now_ns=20,
        db=db,
    )

    schedule = await BrowserSchedules.insert(
        user_id='user-a',
        workflow_id=workflow.id,
        device_id=device.id,
        name='Morning reservation',
        rrule='FREQ=DAILY;BYHOUR=8',
        timezone='America/New_York',
        next_run_at=100,
        now_ns=30,
        db=db,
    )

    assert schedule.device_id == device.id
    assert (await BrowserSchedules.get_by_id_and_user_id(schedule.id, 'user-a', db=db)).id == schedule.id
    assert await BrowserSchedules.get_by_id_and_user_id(schedule.id, 'user-b', db=db) is None

    with pytest.raises(ValueError, match='owned by the user'):
        await BrowserSchedules.insert(
            user_id='user-a',
            workflow_id=workflow.id,
            device_id=other_device.id,
            name='Invalid assignment',
            rrule='FREQ=DAILY',
            timezone='UTC',
            next_run_at=100,
            now_ns=40,
            db=db,
        )


@pytest.mark.asyncio
async def test_action_audit_retention_keeps_only_newest_owner_rows_and_redacts(db):
    device = await create_device(db)
    for index in range(4):
        await BrowserActionAudits.insert(
            user_id='user-a',
            device_id=device.id,
            session_id='session-a',
            chat_id='chat-a',
            command_id=f'command-{index}',
            action='type',
            origin='https://example.com?token=query-secret',
            outcome='success',
            risk='consequential',
            summary=f'password=secret-{index}',
            retention_limit=3,
            now_ns=100 + index,
            db=db,
        )

    rows = await BrowserActionAudits.list_by_user_id('user-a', db=db)

    assert [row.command_id for row in rows] == ['command-3', 'command-2', 'command-1']
    assert all('secret' not in row.summary for row in rows)
    assert all('query-secret' not in row.origin for row in rows)
