"""users, watches and alerts

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-24 14:18:47.045328
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("banned_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "identities",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("provider", sa.String(length=16), nullable=False),
        sa.Column("subject", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("delivery_failed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_identities_user", "identities", ["user_id"], unique=False)
    op.create_index("uq_identities_subject", "identities", ["provider", "subject"], unique=True)
    op.create_table(
        "watches",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("term", sa.String(length=5), nullable=False),
        sa.Column("index", sa.String(length=5), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("snoozed_until", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["term"],
            ["terms.code"],
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_watches_section", "watches", ["term", "index"], unique=False)
    op.create_index("uq_watches_user_section", "watches", ["user_id", "term", "index"], unique=True)
    op.create_table(
        "alerts",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("watch_id", sa.BigInteger(), nullable=False),
        sa.Column("opening_id", sa.BigInteger(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("status", sa.String(length=8), server_default="pending", nullable=False),
        sa.Column("attempts", sa.Integer(), server_default="0", nullable=False),
        sa.Column(
            "next_attempt_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["opening_id"], ["openings.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["watch_id"], ["watches.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_alerts_pending",
        "alerts",
        ["next_attempt_at"],
        unique=False,
        postgresql_where=sa.text("status = 'pending'"),
    )
    op.create_index("ix_alerts_sent", "alerts", ["sent_at"], unique=False)
    op.create_index("uq_alerts_watch_opening", "alerts", ["watch_id", "opening_id"], unique=True)


def downgrade() -> None:
    op.drop_index("uq_alerts_watch_opening", table_name="alerts")
    op.drop_index("ix_alerts_sent", table_name="alerts")
    op.drop_index(
        "ix_alerts_pending", table_name="alerts", postgresql_where=sa.text("status = 'pending'")
    )
    op.drop_table("alerts")
    op.drop_index("uq_watches_user_section", table_name="watches")
    op.drop_index("ix_watches_section", table_name="watches")
    op.drop_table("watches")
    op.drop_index("uq_identities_subject", table_name="identities")
    op.drop_index("ix_identities_user", table_name="identities")
    op.drop_table("identities")
    op.drop_table("users")
