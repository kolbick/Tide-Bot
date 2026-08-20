"""add browser device rotation grace columns

Revision ID: c9f5e7a2b310
Revises: b8e4d6f7a901
Create Date: 2026-08-20 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'c9f5e7a2b310'
down_revision: Union[str, None] = 'b8e4d6f7a901'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLE = 'browser_paired_device'
_COLUMNS = {
    'previous_refresh_token_hash': sa.Column('previous_refresh_token_hash', sa.Text(), nullable=True),
    'rotated_at': sa.Column('rotated_at', sa.BigInteger(), nullable=True),
}


def _existing_columns() -> set[str]:
    inspector = sa.inspect(op.get_bind())
    if _TABLE not in inspector.get_table_names():
        return set()
    return {column['name'] for column in inspector.get_columns(_TABLE)}


def upgrade() -> None:
    present = _existing_columns()
    if not present:
        return
    for name, column in _COLUMNS.items():
        if name not in present:
            op.add_column(_TABLE, column)


def downgrade() -> None:
    present = _existing_columns()
    for name in _COLUMNS:
        if name in present:
            op.drop_column(_TABLE, name)
