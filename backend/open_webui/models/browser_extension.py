from __future__ import annotations

import time
from typing import Any
from uuid import uuid4

from open_webui.internal.db import Base, get_async_db_context
from open_webui.utils.browser_extension_crypto import redact_sensitive_data
from pydantic import BaseModel, ConfigDict
from sqlalchemy import (
    BigInteger,
    Boolean,
    Column,
    Index,
    Integer,
    Text,
    UniqueConstraint,
    delete,
    select,
    update,
)
from sqlalchemy.ext.asyncio import AsyncSession


def _now_ns(value: int | None) -> int:
    return value if value is not None else time.time_ns()


class BrowserPairingGrant(Base):
    __tablename__ = 'browser_pairing_grant'

    id = Column(Text, primary_key=True)
    user_id = Column(Text, nullable=True)
    device_code_hash = Column(Text, nullable=False, unique=True)
    verifier_hash = Column(Text, nullable=False, unique=True)
    requested_origin = Column(Text, nullable=False)
    device_label = Column(Text, nullable=False)
    extension_version = Column(Text, nullable=False)
    status = Column(Text, nullable=False)
    expires_at = Column(BigInteger, nullable=False)
    consumed_at = Column(BigInteger, nullable=True)
    created_at = Column(BigInteger, nullable=False)

    __table_args__ = (
        Index('ix_browser_pairing_grant_user_id', 'user_id'),
        Index('ix_browser_pairing_grant_status_expires', 'status', 'expires_at'),
    )


class BrowserPairedDevice(Base):
    __tablename__ = 'browser_paired_device'

    id = Column(Text, primary_key=True)
    user_id = Column(Text, nullable=False)
    label = Column(Text, nullable=False)
    refresh_token_hash = Column(Text, nullable=False, unique=True)
    # The credential this row last rotated away from, kept only long enough to
    # tell a lost-response retry apart from a genuine replay. See
    # BrowserPairedDeviceTable.restore_rotated_refresh_token.
    previous_refresh_token_hash = Column(Text, nullable=True)
    rotated_at = Column(BigInteger, nullable=True)
    token_family_id = Column(Text, nullable=False)
    allowed_origin = Column(Text, nullable=False)
    extension_version = Column(Text, nullable=False)
    last_seen_at = Column(BigInteger, nullable=True)
    revoked_at = Column(BigInteger, nullable=True)
    created_at = Column(BigInteger, nullable=False)
    updated_at = Column(BigInteger, nullable=False)

    __table_args__ = (
        UniqueConstraint('user_id', 'label', name='uq_browser_paired_device_user_label'),
        Index('ix_browser_paired_device_user_id', 'user_id'),
        Index('ix_browser_paired_device_token_family', 'token_family_id'),
    )


class BrowserWorkflow(Base):
    __tablename__ = 'browser_workflow'

    id = Column(Text, primary_key=True)
    user_id = Column(Text, nullable=False)
    name = Column(Text, nullable=False)
    encrypted_definition = Column(Text, nullable=False)
    definition_nonce = Column(Text, nullable=False)
    version = Column(Integer, nullable=False)
    created_at = Column(BigInteger, nullable=False)
    updated_at = Column(BigInteger, nullable=False)

    __table_args__ = (
        Index('ix_browser_workflow_user_id', 'user_id'),
        Index('ix_browser_workflow_user_updated', 'user_id', 'updated_at'),
    )


class BrowserSchedule(Base):
    __tablename__ = 'browser_schedule'

    id = Column(Text, primary_key=True)
    user_id = Column(Text, nullable=False)
    workflow_id = Column(Text, nullable=False)
    device_id = Column(Text, nullable=False)
    name = Column(Text, nullable=False)
    rrule = Column(Text, nullable=False)
    timezone = Column(Text, nullable=False)
    is_active = Column(Boolean, nullable=False, default=True)
    last_run_at = Column(BigInteger, nullable=True)
    next_run_at = Column(BigInteger, nullable=True)
    catch_up_pending = Column(Boolean, nullable=False, default=False)
    created_at = Column(BigInteger, nullable=False)
    updated_at = Column(BigInteger, nullable=False)

    __table_args__ = (
        Index('ix_browser_schedule_user_id', 'user_id'),
        Index('ix_browser_schedule_device_id', 'device_id'),
        Index('ix_browser_schedule_workflow_id', 'workflow_id'),
        Index('ix_browser_schedule_due', 'is_active', 'next_run_at'),
    )


class BrowserActionAudit(Base):
    __tablename__ = 'browser_action_audit'

    id = Column(Text, primary_key=True)
    user_id = Column(Text, nullable=False)
    device_id = Column(Text, nullable=False)
    session_id = Column(Text, nullable=False)
    chat_id = Column(Text, nullable=True)
    command_id = Column(Text, nullable=False)
    action = Column(Text, nullable=False)
    origin = Column(Text, nullable=False)
    outcome = Column(Text, nullable=False)
    risk = Column(Text, nullable=False)
    summary = Column(Text, nullable=False)
    created_at = Column(BigInteger, nullable=False)

    __table_args__ = (
        Index('ix_browser_action_audit_user_created', 'user_id', 'created_at'),
        Index('ix_browser_action_audit_device_created', 'device_id', 'created_at'),
        Index('ix_browser_action_audit_session_id', 'session_id'),
    )


BROWSER_EXTENSION_TABLES = [
    BrowserPairingGrant.__table__,
    BrowserPairedDevice.__table__,
    BrowserWorkflow.__table__,
    BrowserSchedule.__table__,
    BrowserActionAudit.__table__,
]


class _StoredModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class BrowserPairingGrantModel(_StoredModel):
    id: str
    user_id: str | None = None
    device_code_hash: str
    verifier_hash: str
    requested_origin: str
    device_label: str
    extension_version: str
    status: str
    expires_at: int
    consumed_at: int | None = None
    created_at: int


class BrowserPairedDeviceModel(_StoredModel):
    id: str
    user_id: str
    label: str
    refresh_token_hash: str
    previous_refresh_token_hash: str | None = None
    rotated_at: int | None = None
    token_family_id: str
    allowed_origin: str
    extension_version: str
    last_seen_at: int | None = None
    revoked_at: int | None = None
    created_at: int
    updated_at: int


class BrowserWorkflowModel(_StoredModel):
    id: str
    user_id: str
    name: str
    encrypted_definition: str
    definition_nonce: str
    version: int
    created_at: int
    updated_at: int


class BrowserScheduleModel(_StoredModel):
    id: str
    user_id: str
    workflow_id: str
    device_id: str
    name: str
    rrule: str
    timezone: str
    is_active: bool
    last_run_at: int | None = None
    next_run_at: int | None = None
    catch_up_pending: bool
    created_at: int
    updated_at: int


class BrowserActionAuditModel(_StoredModel):
    id: str
    user_id: str
    device_id: str
    session_id: str
    chat_id: str | None = None
    command_id: str
    action: str
    origin: str
    outcome: str
    risk: str
    summary: str
    created_at: int


class BrowserPairingGrantTable:
    async def insert(
        self,
        *,
        device_code_hash: str,
        verifier_hash: str,
        requested_origin: str,
        expires_at: int,
        device_label: str = 'Tide-Bot Chrome',
        extension_version: str = 'unknown',
        user_id: str | None = None,
        now_ns: int | None = None,
        db: AsyncSession | None = None,
    ) -> BrowserPairingGrantModel:
        async with get_async_db_context(db) as session:
            row = BrowserPairingGrant(
                id=str(uuid4()),
                user_id=user_id,
                device_code_hash=device_code_hash,
                verifier_hash=verifier_hash,
                requested_origin=requested_origin,
                device_label=device_label,
                extension_version=extension_version,
                status='pending',
                expires_at=expires_at,
                created_at=_now_ns(now_ns),
            )
            session.add(row)
            await session.commit()
            await session.refresh(row)
            return BrowserPairingGrantModel.model_validate(row)

    async def get_by_id(
        self,
        grant_id: str,
        db: AsyncSession | None = None,
    ) -> BrowserPairingGrantModel | None:
        async with get_async_db_context(db) as session:
            row = await session.get(BrowserPairingGrant, grant_id)
            return BrowserPairingGrantModel.model_validate(row) if row else None

    async def get_by_device_code_hash(
        self,
        device_code_hash: str,
        db: AsyncSession | None = None,
    ) -> BrowserPairingGrantModel | None:
        async with get_async_db_context(db) as session:
            result = await session.execute(
                select(BrowserPairingGrant).where(BrowserPairingGrant.device_code_hash == device_code_hash)
            )
            row = result.scalar_one_or_none()
            return BrowserPairingGrantModel.model_validate(row) if row else None

    async def approve(
        self,
        grant_id: str,
        user_id: str,
        *,
        now_ns: int | None = None,
        db: AsyncSession | None = None,
    ) -> BrowserPairingGrantModel | None:
        now = _now_ns(now_ns)
        async with get_async_db_context(db) as session:
            result = await session.execute(
                update(BrowserPairingGrant)
                .where(
                    BrowserPairingGrant.id == grant_id,
                    BrowserPairingGrant.status == 'pending',
                    BrowserPairingGrant.user_id.is_(None),
                    BrowserPairingGrant.expires_at > now,
                )
                .values(user_id=user_id, status='approved')
                .returning(BrowserPairingGrant)
            )
            row = result.scalar_one_or_none()
            await session.commit()
            return BrowserPairingGrantModel.model_validate(row) if row else None

    async def deny(
        self,
        grant_id: str,
        *,
        now_ns: int | None = None,
        db: AsyncSession | None = None,
    ) -> BrowserPairingGrantModel | None:
        now = _now_ns(now_ns)
        async with get_async_db_context(db) as session:
            result = await session.execute(
                update(BrowserPairingGrant)
                .where(
                    BrowserPairingGrant.id == grant_id,
                    BrowserPairingGrant.status == 'pending',
                    BrowserPairingGrant.expires_at > now,
                )
                .values(status='denied')
                .returning(BrowserPairingGrant)
            )
            row = result.scalar_one_or_none()
            await session.commit()
            return BrowserPairingGrantModel.model_validate(row) if row else None

    async def consume(
        self,
        grant_id: str,
        *,
        verifier_hash: str,
        now_ns: int | None = None,
        db: AsyncSession | None = None,
    ) -> BrowserPairingGrantModel | None:
        now = _now_ns(now_ns)
        async with get_async_db_context(db) as session:
            result = await session.execute(
                update(BrowserPairingGrant)
                .where(
                    BrowserPairingGrant.id == grant_id,
                    BrowserPairingGrant.verifier_hash == verifier_hash,
                    BrowserPairingGrant.status == 'approved',
                    BrowserPairingGrant.consumed_at.is_(None),
                    BrowserPairingGrant.expires_at > now,
                )
                .values(status='consumed', consumed_at=now)
                .returning(BrowserPairingGrant)
            )
            row = result.scalar_one_or_none()
            await session.commit()
            return BrowserPairingGrantModel.model_validate(row) if row else None


class BrowserPairedDeviceTable:
    async def insert(
        self,
        *,
        user_id: str,
        label: str,
        refresh_token_hash: str,
        token_family_id: str,
        allowed_origin: str,
        extension_version: str,
        device_id: str | None = None,
        now_ns: int | None = None,
        db: AsyncSession | None = None,
    ) -> BrowserPairedDeviceModel:
        async with get_async_db_context(db) as session:
            now = _now_ns(now_ns)
            row = BrowserPairedDevice(
                id=device_id or str(uuid4()),
                user_id=user_id,
                label=label,
                refresh_token_hash=refresh_token_hash,
                token_family_id=token_family_id,
                allowed_origin=allowed_origin,
                extension_version=extension_version,
                last_seen_at=now,
                created_at=now,
                updated_at=now,
            )
            session.add(row)
            await session.commit()
            await session.refresh(row)
            return BrowserPairedDeviceModel.model_validate(row)

    async def get_by_id_and_user_id(
        self,
        device_id: str,
        user_id: str,
        db: AsyncSession | None = None,
    ) -> BrowserPairedDeviceModel | None:
        async with get_async_db_context(db) as session:
            result = await session.execute(
                select(BrowserPairedDevice).where(
                    BrowserPairedDevice.id == device_id,
                    BrowserPairedDevice.user_id == user_id,
                )
            )
            row = result.scalar_one_or_none()
            return BrowserPairedDeviceModel.model_validate(row) if row else None

    async def get_active_by_id(
        self,
        device_id: str,
        db: AsyncSession | None = None,
    ) -> BrowserPairedDeviceModel | None:
        async with get_async_db_context(db) as session:
            result = await session.execute(
                select(BrowserPairedDevice).where(
                    BrowserPairedDevice.id == device_id,
                    BrowserPairedDevice.revoked_at.is_(None),
                )
            )
            row = result.scalar_one_or_none()
            return BrowserPairedDeviceModel.model_validate(row) if row else None

    async def get_by_refresh_token_hash(
        self,
        refresh_token_hash: str,
        db: AsyncSession | None = None,
    ) -> BrowserPairedDeviceModel | None:
        async with get_async_db_context(db) as session:
            result = await session.execute(
                select(BrowserPairedDevice).where(
                    BrowserPairedDevice.refresh_token_hash == refresh_token_hash,
                    BrowserPairedDevice.revoked_at.is_(None),
                )
            )
            row = result.scalar_one_or_none()
            return BrowserPairedDeviceModel.model_validate(row) if row else None

    async def list_by_user_id(
        self,
        user_id: str,
        db: AsyncSession | None = None,
    ) -> list[BrowserPairedDeviceModel]:
        async with get_async_db_context(db) as session:
            result = await session.execute(
                select(BrowserPairedDevice)
                .where(BrowserPairedDevice.user_id == user_id)
                .order_by(BrowserPairedDevice.created_at.desc())
            )
            return [BrowserPairedDeviceModel.model_validate(row) for row in result.scalars().all()]

    async def rotate_refresh_token(
        self,
        device_id: str,
        token_family_id: str,
        current_hash: str,
        new_hash: str,
        *,
        extension_version: str | None = None,
        now_ns: int | None = None,
        db: AsyncSession | None = None,
    ) -> BrowserPairedDeviceModel | None:
        now = _now_ns(now_ns)
        values: dict[str, Any] = {
            'refresh_token_hash': new_hash,
            'previous_refresh_token_hash': current_hash,
            'rotated_at': now,
            'last_seen_at': now,
            'updated_at': now,
        }
        if extension_version is not None:
            values['extension_version'] = extension_version
        async with get_async_db_context(db) as session:
            result = await session.execute(
                update(BrowserPairedDevice)
                .where(
                    BrowserPairedDevice.id == device_id,
                    BrowserPairedDevice.token_family_id == token_family_id,
                    BrowserPairedDevice.refresh_token_hash == current_hash,
                    BrowserPairedDevice.revoked_at.is_(None),
                )
                .values(**values)
                .returning(BrowserPairedDevice)
            )
            row = result.scalar_one_or_none()
            await session.commit()
            return BrowserPairedDeviceModel.model_validate(row) if row else None

    async def revoke(
        self,
        device_id: str,
        user_id: str,
        *,
        now_ns: int | None = None,
        db: AsyncSession | None = None,
    ) -> BrowserPairedDeviceModel | None:
        now = _now_ns(now_ns)
        async with get_async_db_context(db) as session:
            result = await session.execute(
                update(BrowserPairedDevice)
                .where(
                    BrowserPairedDevice.id == device_id,
                    BrowserPairedDevice.user_id == user_id,
                    BrowserPairedDevice.revoked_at.is_(None),
                )
                .values(revoked_at=now, updated_at=now)
                .returning(BrowserPairedDevice)
            )
            row = result.scalar_one_or_none()
            await session.commit()
            return BrowserPairedDeviceModel.model_validate(row) if row else None

    async def rename(
        self,
        device_id: str,
        user_id: str,
        label: str,
        *,
        now_ns: int | None = None,
        db: AsyncSession | None = None,
    ) -> BrowserPairedDeviceModel | None:
        async with get_async_db_context(db) as session:
            result = await session.execute(
                update(BrowserPairedDevice)
                .where(
                    BrowserPairedDevice.id == device_id,
                    BrowserPairedDevice.user_id == user_id,
                    BrowserPairedDevice.revoked_at.is_(None),
                )
                .values(label=label, updated_at=_now_ns(now_ns))
                .returning(BrowserPairedDevice)
            )
            row = result.scalar_one_or_none()
            await session.commit()
            return BrowserPairedDeviceModel.model_validate(row) if row else None

    async def restore_rotated_refresh_token(
        self,
        device_id: str,
        token_family_id: str,
        previous_hash: str,
        *,
        not_rotated_before: int,
        now_ns: int | None = None,
        db: AsyncSession | None = None,
    ) -> BrowserPairedDeviceModel | None:
        """Re-accept the credential this row just rotated away from.

        A Manifest V3 service worker can be killed after the server commits a
        rotation but before the extension stores the new credential, leaving the
        client holding only the old one. Rolling forward is impossible — the
        server keeps hashes, not the token — so roll back to the credential the
        caller proved it holds and let it rotate normally next time. Bounded by
        not_rotated_before so anything older still trips replay detection.
        """
        now = _now_ns(now_ns)
        async with get_async_db_context(db) as session:
            result = await session.execute(
                update(BrowserPairedDevice)
                .where(
                    BrowserPairedDevice.id == device_id,
                    BrowserPairedDevice.token_family_id == token_family_id,
                    BrowserPairedDevice.previous_refresh_token_hash == previous_hash,
                    BrowserPairedDevice.rotated_at.is_not(None),
                    BrowserPairedDevice.rotated_at >= not_rotated_before,
                    BrowserPairedDevice.revoked_at.is_(None),
                )
                .values(
                    refresh_token_hash=previous_hash,
                    previous_refresh_token_hash=None,
                    rotated_at=None,
                    last_seen_at=now,
                    updated_at=now,
                )
                .returning(BrowserPairedDevice)
            )
            row = result.scalar_one_or_none()
            await session.commit()
            return BrowserPairedDeviceModel.model_validate(row) if row else None

    async def revoke_token_family(
        self,
        token_family_id: str,
        *,
        now_ns: int | None = None,
        db: AsyncSession | None = None,
    ) -> int:
        now = _now_ns(now_ns)
        async with get_async_db_context(db) as session:
            result = await session.execute(
                update(BrowserPairedDevice)
                .where(
                    BrowserPairedDevice.token_family_id == token_family_id,
                    BrowserPairedDevice.revoked_at.is_(None),
                )
                .values(revoked_at=now, updated_at=now)
            )
            await session.commit()
            return result.rowcount or 0


class BrowserWorkflowTable:
    async def insert(
        self,
        *,
        user_id: str,
        name: str,
        encrypted_definition: str,
        definition_nonce: str,
        version: int = 1,
        workflow_id: str | None = None,
        now_ns: int | None = None,
        db: AsyncSession | None = None,
    ) -> BrowserWorkflowModel:
        async with get_async_db_context(db) as session:
            now = _now_ns(now_ns)
            row = BrowserWorkflow(
                id=workflow_id or str(uuid4()),
                user_id=user_id,
                name=name,
                encrypted_definition=encrypted_definition,
                definition_nonce=definition_nonce,
                version=version,
                created_at=now,
                updated_at=now,
            )
            session.add(row)
            await session.commit()
            await session.refresh(row)
            return BrowserWorkflowModel.model_validate(row)

    async def get_by_id_and_user_id(
        self,
        workflow_id: str,
        user_id: str,
        db: AsyncSession | None = None,
    ) -> BrowserWorkflowModel | None:
        async with get_async_db_context(db) as session:
            result = await session.execute(
                select(BrowserWorkflow).where(
                    BrowserWorkflow.id == workflow_id,
                    BrowserWorkflow.user_id == user_id,
                )
            )
            row = result.scalar_one_or_none()
            return BrowserWorkflowModel.model_validate(row) if row else None

    async def list_by_user_id(
        self,
        user_id: str,
        db: AsyncSession | None = None,
    ) -> list[BrowserWorkflowModel]:
        async with get_async_db_context(db) as session:
            result = await session.execute(
                select(BrowserWorkflow)
                .where(BrowserWorkflow.user_id == user_id)
                .order_by(BrowserWorkflow.updated_at.desc())
            )
            return [BrowserWorkflowModel.model_validate(row) for row in result.scalars().all()]

    async def update(
        self,
        workflow_id: str,
        user_id: str,
        *,
        expected_version: int,
        name: str,
        encrypted_definition: str,
        definition_nonce: str,
        now_ns: int | None = None,
        db: AsyncSession | None = None,
    ) -> BrowserWorkflowModel | None:
        now = _now_ns(now_ns)
        async with get_async_db_context(db) as session:
            result = await session.execute(
                update(BrowserWorkflow)
                .where(
                    BrowserWorkflow.id == workflow_id,
                    BrowserWorkflow.user_id == user_id,
                    BrowserWorkflow.version == expected_version,
                )
                .values(
                    name=name,
                    encrypted_definition=encrypted_definition,
                    definition_nonce=definition_nonce,
                    version=expected_version + 1,
                    updated_at=now,
                )
                .returning(BrowserWorkflow)
            )
            row = result.scalar_one_or_none()
            await session.commit()
            return BrowserWorkflowModel.model_validate(row) if row else None

    async def delete(
        self,
        workflow_id: str,
        user_id: str,
        db: AsyncSession | None = None,
    ) -> bool:
        async with get_async_db_context(db) as session:
            await session.execute(
                delete(BrowserSchedule).where(
                    BrowserSchedule.workflow_id == workflow_id,
                    BrowserSchedule.user_id == user_id,
                )
            )
            result = await session.execute(
                delete(BrowserWorkflow).where(
                    BrowserWorkflow.id == workflow_id,
                    BrowserWorkflow.user_id == user_id,
                )
            )
            await session.commit()
            return bool(result.rowcount)


class BrowserScheduleTable:
    async def insert(
        self,
        *,
        user_id: str,
        workflow_id: str,
        device_id: str,
        name: str,
        rrule: str,
        timezone: str,
        next_run_at: int | None,
        is_active: bool = True,
        catch_up_pending: bool = False,
        now_ns: int | None = None,
        db: AsyncSession | None = None,
    ) -> BrowserScheduleModel:
        async with get_async_db_context(db) as session:
            workflow = await session.scalar(
                select(BrowserWorkflow).where(
                    BrowserWorkflow.id == workflow_id,
                    BrowserWorkflow.user_id == user_id,
                )
            )
            device = await session.scalar(
                select(BrowserPairedDevice).where(
                    BrowserPairedDevice.id == device_id,
                    BrowserPairedDevice.user_id == user_id,
                    BrowserPairedDevice.revoked_at.is_(None),
                )
            )
            if workflow is None or device is None:
                raise ValueError('Workflow and active device must be owned by the user')

            now = _now_ns(now_ns)
            row = BrowserSchedule(
                id=str(uuid4()),
                user_id=user_id,
                workflow_id=workflow_id,
                device_id=device_id,
                name=name,
                rrule=rrule,
                timezone=timezone,
                is_active=is_active,
                next_run_at=next_run_at,
                catch_up_pending=catch_up_pending,
                created_at=now,
                updated_at=now,
            )
            session.add(row)
            await session.commit()
            await session.refresh(row)
            return BrowserScheduleModel.model_validate(row)

    async def get_by_id_and_user_id(
        self,
        schedule_id: str,
        user_id: str,
        db: AsyncSession | None = None,
    ) -> BrowserScheduleModel | None:
        async with get_async_db_context(db) as session:
            result = await session.execute(
                select(BrowserSchedule).where(
                    BrowserSchedule.id == schedule_id,
                    BrowserSchedule.user_id == user_id,
                )
            )
            row = result.scalar_one_or_none()
            return BrowserScheduleModel.model_validate(row) if row else None

    async def list_by_user_id(
        self,
        user_id: str,
        db: AsyncSession | None = None,
    ) -> list[BrowserScheduleModel]:
        async with get_async_db_context(db) as session:
            result = await session.execute(
                select(BrowserSchedule)
                .where(BrowserSchedule.user_id == user_id)
                .order_by(BrowserSchedule.created_at.desc())
            )
            return [BrowserScheduleModel.model_validate(row) for row in result.scalars().all()]

    async def list_due(
        self,
        now_ns: int,
        *,
        device_id: str | None = None,
        limit: int = 10,
        db: AsyncSession | None = None,
    ) -> list[BrowserScheduleModel]:
        async with get_async_db_context(db) as session:
            statement = (
                select(BrowserSchedule)
                .where(
                    BrowserSchedule.is_active.is_(True),
                    BrowserSchedule.next_run_at.is_not(None),
                    BrowserSchedule.next_run_at <= now_ns,
                )
                .order_by(BrowserSchedule.next_run_at)
                .limit(limit)
            )
            if device_id is not None:
                statement = statement.where(BrowserSchedule.device_id == device_id)
            result = await session.execute(statement)
            return [BrowserScheduleModel.model_validate(row) for row in result.scalars().all()]

    async def update(
        self,
        schedule_id: str,
        user_id: str,
        *,
        workflow_id: str,
        device_id: str,
        name: str,
        rrule: str,
        timezone: str,
        is_active: bool,
        next_run_at: int | None,
        now_ns: int | None = None,
        db: AsyncSession | None = None,
    ) -> BrowserScheduleModel | None:
        async with get_async_db_context(db) as session:
            workflow = await session.scalar(
                select(BrowserWorkflow).where(
                    BrowserWorkflow.id == workflow_id,
                    BrowserWorkflow.user_id == user_id,
                )
            )
            device = await session.scalar(
                select(BrowserPairedDevice).where(
                    BrowserPairedDevice.id == device_id,
                    BrowserPairedDevice.user_id == user_id,
                    BrowserPairedDevice.revoked_at.is_(None),
                )
            )
            if workflow is None or device is None:
                raise ValueError('Workflow and active device must be owned by the user')
            result = await session.execute(
                update(BrowserSchedule)
                .where(
                    BrowserSchedule.id == schedule_id,
                    BrowserSchedule.user_id == user_id,
                )
                .values(
                    workflow_id=workflow_id,
                    device_id=device_id,
                    name=name,
                    rrule=rrule,
                    timezone=timezone,
                    is_active=is_active,
                    next_run_at=next_run_at,
                    catch_up_pending=False,
                    updated_at=_now_ns(now_ns),
                )
                .returning(BrowserSchedule)
            )
            row = result.scalar_one_or_none()
            await session.commit()
            return BrowserScheduleModel.model_validate(row) if row else None

    async def mark_run(
        self,
        schedule_id: str,
        user_id: str,
        *,
        last_run_at: int,
        next_run_at: int,
        now_ns: int | None = None,
        db: AsyncSession | None = None,
    ) -> BrowserScheduleModel | None:
        async with get_async_db_context(db) as session:
            result = await session.execute(
                update(BrowserSchedule)
                .where(
                    BrowserSchedule.id == schedule_id,
                    BrowserSchedule.user_id == user_id,
                    BrowserSchedule.is_active.is_(True),
                    (BrowserSchedule.last_run_at.is_(None) | (BrowserSchedule.last_run_at < last_run_at)),
                )
                .values(
                    last_run_at=last_run_at,
                    next_run_at=next_run_at,
                    catch_up_pending=False,
                    updated_at=_now_ns(now_ns),
                )
                .returning(BrowserSchedule)
            )
            row = result.scalar_one_or_none()
            await session.commit()
            return BrowserScheduleModel.model_validate(row) if row else None

    async def delete(
        self,
        schedule_id: str,
        user_id: str,
        db: AsyncSession | None = None,
    ) -> bool:
        async with get_async_db_context(db) as session:
            result = await session.execute(
                delete(BrowserSchedule).where(
                    BrowserSchedule.id == schedule_id,
                    BrowserSchedule.user_id == user_id,
                )
            )
            await session.commit()
            return bool(result.rowcount)


class BrowserActionAuditTable:
    async def insert(
        self,
        *,
        user_id: str,
        device_id: str,
        session_id: str,
        chat_id: str | None,
        command_id: str,
        action: str,
        origin: str,
        outcome: str,
        risk: str,
        summary: str,
        retention_limit: int = 1_000,
        now_ns: int | None = None,
        db: AsyncSession | None = None,
    ) -> BrowserActionAuditModel:
        async with get_async_db_context(db) as session:
            row = BrowserActionAudit(
                id=str(uuid4()),
                user_id=user_id,
                device_id=device_id,
                session_id=session_id,
                chat_id=chat_id,
                command_id=command_id,
                action=str(redact_sensitive_data(action)),
                origin=str(redact_sensitive_data(origin)),
                outcome=outcome,
                risk=risk,
                summary=str(redact_sensitive_data(summary)),
                created_at=_now_ns(now_ns),
            )
            session.add(row)
            await session.flush()

            keep = max(1, retention_limit)
            stale_result = await session.execute(
                select(BrowserActionAudit.id)
                .where(BrowserActionAudit.user_id == user_id)
                .order_by(BrowserActionAudit.created_at.desc(), BrowserActionAudit.id.desc())
                .offset(keep)
            )
            stale_ids = list(stale_result.scalars().all())
            if stale_ids:
                await session.execute(delete(BrowserActionAudit).where(BrowserActionAudit.id.in_(stale_ids)))

            await session.commit()
            await session.refresh(row)
            return BrowserActionAuditModel.model_validate(row)

    async def list_by_user_id(
        self,
        user_id: str,
        *,
        limit: int = 100,
        db: AsyncSession | None = None,
    ) -> list[BrowserActionAuditModel]:
        async with get_async_db_context(db) as session:
            result = await session.execute(
                select(BrowserActionAudit)
                .where(BrowserActionAudit.user_id == user_id)
                .order_by(BrowserActionAudit.created_at.desc(), BrowserActionAudit.id.desc())
                .limit(limit)
            )
            return [BrowserActionAuditModel.model_validate(row) for row in result.scalars().all()]


BrowserPairingGrants = BrowserPairingGrantTable()
BrowserPairedDevices = BrowserPairedDeviceTable()
BrowserWorkflows = BrowserWorkflowTable()
BrowserSchedules = BrowserScheduleTable()
BrowserActionAudits = BrowserActionAuditTable()
