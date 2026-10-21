"""initial schema

Revision ID: 0001
Revises:
Create Date: 2026-10-21 17:57:19.750279
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "terms",
        sa.Column("code", sa.String(length=5), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("code"),
    )
    op.create_table(
        "catalogs",
        sa.Column("term", sa.String(length=5), nullable=False),
        sa.Column("campus", sa.String(length=2), nullable=False),
        sa.Column("generated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("etag", sa.Text(), nullable=False),
        sa.Column("course_count", sa.Integer(), nullable=False),
        sa.Column("section_count", sa.Integer(), nullable=False),
        sa.Column("payload_gzip", sa.LargeBinary(), nullable=False),
        sa.ForeignKeyConstraint(
            ["term"],
            ["terms.code"],
        ),
        sa.PrimaryKeyConstraint("term", "campus"),
    )
    op.create_table(
        "openings",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("term", sa.String(length=5), nullable=False),
        sa.Column("index", sa.String(length=5), nullable=False),
        sa.Column("opened_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("open_detected_after", sa.DateTime(timezone=True), nullable=True),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("close_detected_after", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["term"],
            ["terms.code"],
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_openings_closed", "openings", ["term", "closed_at"], unique=False)
    op.create_index("ix_openings_opened", "openings", ["term", "opened_at"], unique=False)
    op.create_index("ix_openings_section", "openings", ["term", "index", "opened_at"], unique=False)
    op.create_index(
        "uq_openings_current",
        "openings",
        ["term", "index"],
        unique=True,
        postgresql_where=sa.text("closed_at IS NULL"),
    )
    op.create_table(
        "polls",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("term", sa.String(length=5), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("status", sa.String(length=8), nullable=False),
        sa.Column("open_count", sa.Integer(), nullable=True),
        sa.Column("opened", sa.Integer(), nullable=False),
        sa.Column("closed", sa.Integer(), nullable=False),
        sa.Column("error", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(
            ["term"],
            ["terms.code"],
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_polls_term_finished", "polls", ["term", "finished_at"], unique=False)
    op.create_table(
        "sections",
        sa.Column("term", sa.String(length=5), nullable=False),
        sa.Column("index", sa.String(length=5), nullable=False),
        sa.Column("campus", sa.String(length=2), nullable=False),
        sa.Column("course_code", sa.Text(), nullable=False),
        sa.Column("course_title", sa.Text(), nullable=False),
        sa.Column("section_number", sa.Text(), nullable=False),
        sa.Column("instructors", sa.Text(), nullable=False),
        sa.Column("spn", sa.Boolean(), nullable=False),
        sa.ForeignKeyConstraint(
            ["term"],
            ["terms.code"],
        ),
        sa.PrimaryKeyConstraint("term", "index"),
    )


def downgrade() -> None:
    op.drop_table("sections")
    op.drop_index("ix_polls_term_finished", table_name="polls")
    op.drop_table("polls")
    op.drop_index(
        "uq_openings_current", table_name="openings", postgresql_where=sa.text("closed_at IS NULL")
    )
    op.drop_index("ix_openings_section", table_name="openings")
    op.drop_index("ix_openings_opened", table_name="openings")
    op.drop_index("ix_openings_closed", table_name="openings")
    op.drop_table("openings")
    op.drop_table("catalogs")
    op.drop_table("terms")
