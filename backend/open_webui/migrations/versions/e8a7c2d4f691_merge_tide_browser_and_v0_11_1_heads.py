"""merge Tide browser and Open WebUI v0.11.1 migration heads

Revision ID: e8a7c2d4f691
Revises: c9f5e7a2b310, d4c1a8e37b62
Create Date: 2026-08-25 00:00:00.000000
"""

from collections.abc import Sequence

revision: str = 'e8a7c2d4f691'
down_revision: tuple[str, str] = ('c9f5e7a2b310', 'd4c1a8e37b62')
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Join the already-applied Tide-Bot and upstream schema branches."""


def downgrade() -> None:
    """Split the version marker back to both parent revisions."""
