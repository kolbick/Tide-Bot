"""add browser extension tables

Revision ID: b8e4d6f7a901
Revises: 9a1b2c3d4e5f
Create Date: 2026-08-20 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'b8e4d6f7a901'
down_revision: Union[str, None] = '9a1b2c3d4e5f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _ensure_index(table_name: str, index_name: str, columns: list[str]) -> None:
    inspector = sa.inspect(op.get_bind())
    if table_name not in inspector.get_table_names():
        return
    if not any(index['name'] == index_name for index in inspector.get_indexes(table_name)):
        op.create_index(index_name, table_name, columns)


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    tables = set(inspector.get_table_names())

    if 'browser_pairing_grant' not in tables:
        op.create_table(
            'browser_pairing_grant',
            sa.Column('id', sa.Text(), nullable=False, primary_key=True),
            sa.Column('user_id', sa.Text(), nullable=True),
            sa.Column('device_code_hash', sa.Text(), nullable=False),
            sa.Column('verifier_hash', sa.Text(), nullable=False),
            sa.Column('requested_origin', sa.Text(), nullable=False),
            sa.Column('device_label', sa.Text(), nullable=False),
            sa.Column('extension_version', sa.Text(), nullable=False),
            sa.Column('status', sa.Text(), nullable=False),
            sa.Column('expires_at', sa.BigInteger(), nullable=False),
            sa.Column('consumed_at', sa.BigInteger(), nullable=True),
            sa.Column('created_at', sa.BigInteger(), nullable=False),
            sa.UniqueConstraint('device_code_hash', name='uq_browser_pairing_grant_device_code_hash'),
            sa.UniqueConstraint('verifier_hash', name='uq_browser_pairing_grant_verifier_hash'),
        )

    if 'browser_paired_device' not in tables:
        op.create_table(
            'browser_paired_device',
            sa.Column('id', sa.Text(), nullable=False, primary_key=True),
            sa.Column('user_id', sa.Text(), nullable=False),
            sa.Column('label', sa.Text(), nullable=False),
            sa.Column('refresh_token_hash', sa.Text(), nullable=False),
            sa.Column('token_family_id', sa.Text(), nullable=False),
            sa.Column('allowed_origin', sa.Text(), nullable=False),
            sa.Column('extension_version', sa.Text(), nullable=False),
            sa.Column('last_seen_at', sa.BigInteger(), nullable=True),
            sa.Column('revoked_at', sa.BigInteger(), nullable=True),
            sa.Column('created_at', sa.BigInteger(), nullable=False),
            sa.Column('updated_at', sa.BigInteger(), nullable=False),
            sa.UniqueConstraint('refresh_token_hash', name='uq_browser_paired_device_refresh_hash'),
            sa.UniqueConstraint('user_id', 'label', name='uq_browser_paired_device_user_label'),
        )

    if 'browser_workflow' not in tables:
        op.create_table(
            'browser_workflow',
            sa.Column('id', sa.Text(), nullable=False, primary_key=True),
            sa.Column('user_id', sa.Text(), nullable=False),
            sa.Column('name', sa.Text(), nullable=False),
            sa.Column('encrypted_definition', sa.Text(), nullable=False),
            sa.Column('definition_nonce', sa.Text(), nullable=False),
            sa.Column('version', sa.Integer(), nullable=False, server_default='1'),
            sa.Column('created_at', sa.BigInteger(), nullable=False),
            sa.Column('updated_at', sa.BigInteger(), nullable=False),
        )

    if 'browser_schedule' not in tables:
        op.create_table(
            'browser_schedule',
            sa.Column('id', sa.Text(), nullable=False, primary_key=True),
            sa.Column('user_id', sa.Text(), nullable=False),
            sa.Column('workflow_id', sa.Text(), nullable=False),
            sa.Column('device_id', sa.Text(), nullable=False),
            sa.Column('name', sa.Text(), nullable=False),
            sa.Column('rrule', sa.Text(), nullable=False),
            sa.Column('timezone', sa.Text(), nullable=False),
            sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column('last_run_at', sa.BigInteger(), nullable=True),
            sa.Column('next_run_at', sa.BigInteger(), nullable=True),
            sa.Column('catch_up_pending', sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column('created_at', sa.BigInteger(), nullable=False),
            sa.Column('updated_at', sa.BigInteger(), nullable=False),
        )

    if 'browser_action_audit' not in tables:
        op.create_table(
            'browser_action_audit',
            sa.Column('id', sa.Text(), nullable=False, primary_key=True),
            sa.Column('user_id', sa.Text(), nullable=False),
            sa.Column('device_id', sa.Text(), nullable=False),
            sa.Column('session_id', sa.Text(), nullable=False),
            sa.Column('chat_id', sa.Text(), nullable=True),
            sa.Column('command_id', sa.Text(), nullable=False),
            sa.Column('action', sa.Text(), nullable=False),
            sa.Column('origin', sa.Text(), nullable=False),
            sa.Column('outcome', sa.Text(), nullable=False),
            sa.Column('risk', sa.Text(), nullable=False),
            sa.Column('summary', sa.Text(), nullable=False),
            sa.Column('created_at', sa.BigInteger(), nullable=False),
        )

    indexes = {
        'browser_pairing_grant': [
            ('ix_browser_pairing_grant_user_id', ['user_id']),
            ('ix_browser_pairing_grant_status_expires', ['status', 'expires_at']),
        ],
        'browser_paired_device': [
            ('ix_browser_paired_device_user_id', ['user_id']),
            ('ix_browser_paired_device_token_family', ['token_family_id']),
        ],
        'browser_workflow': [
            ('ix_browser_workflow_user_id', ['user_id']),
            ('ix_browser_workflow_user_updated', ['user_id', 'updated_at']),
        ],
        'browser_schedule': [
            ('ix_browser_schedule_user_id', ['user_id']),
            ('ix_browser_schedule_device_id', ['device_id']),
            ('ix_browser_schedule_workflow_id', ['workflow_id']),
            ('ix_browser_schedule_due', ['is_active', 'next_run_at']),
        ],
        'browser_action_audit': [
            ('ix_browser_action_audit_user_created', ['user_id', 'created_at']),
            ('ix_browser_action_audit_device_created', ['device_id', 'created_at']),
            ('ix_browser_action_audit_session_id', ['session_id']),
        ],
    }
    for table_name, table_indexes in indexes.items():
        for index_name, columns in table_indexes:
            _ensure_index(table_name, index_name, columns)


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    tables = set(inspector.get_table_names())
    for table_name in (
        'browser_action_audit',
        'browser_schedule',
        'browser_workflow',
        'browser_paired_device',
        'browser_pairing_grant',
    ):
        if table_name in tables:
            op.drop_table(table_name)
