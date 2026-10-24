"""alert actions and discord fallback

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-24 14:33:21.336995
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("alerts", sa.Column("action", sa.String(length=8), nullable=True))
    op.add_column("alerts", sa.Column("acted_at", sa.DateTime(timezone=True), nullable=True))
    op.alter_column("alerts", "watch_id", existing_type=sa.BIGINT(), nullable=True)
    op.drop_constraint("alerts_watch_id_fkey", "alerts", type_="foreignkey")
    op.create_foreign_key(
        "alerts_watch_id_fkey", "alerts", "watches", ["watch_id"], ["id"], ondelete="SET NULL"
    )
    op.add_column("identities", sa.Column("fallback_channel_id", sa.BigInteger(), nullable=True))


def downgrade() -> None:
    op.drop_column("identities", "fallback_channel_id")
    op.drop_constraint("alerts_watch_id_fkey", "alerts", type_="foreignkey")
    op.create_foreign_key(
        "alerts_watch_id_fkey", "alerts", "watches", ["watch_id"], ["id"], ondelete="CASCADE"
    )
    op.alter_column("alerts", "watch_id", existing_type=sa.BIGINT(), nullable=False)
    op.drop_column("alerts", "acted_at")
    op.drop_column("alerts", "action")
