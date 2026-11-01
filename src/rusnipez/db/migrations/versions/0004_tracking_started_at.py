"""Preserve each term's tracking start beyond poll-log retention.

Revision ID: 0004
Revises: 0003
"""

import sqlalchemy as sa
from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("terms", sa.Column("tracking_started_at", sa.DateTime(timezone=True)))
    # Opening rows outlive polls and include the original baseline. If a term
    # began with an empty set and its first polls were pruned, only the earliest
    # surviving evidence can be recovered; never invent an earlier timestamp.
    op.execute("""
        UPDATE terms t SET tracking_started_at = (
            SELECT min(at) FROM (
                SELECT min(finished_at) AS at FROM polls WHERE term = t.code AND status = 'ok'
                UNION ALL
                SELECT min(coalesce(open_detected_after, opened_at)) FROM openings
                 WHERE term = t.code
            ) evidence
        )
    """)


def downgrade() -> None:
    op.drop_column("terms", "tracking_started_at")
