"""Database schema.

An opening is one row in ``openings``: the first poll that saw a section open
and the first poll that saw it closed again. Rows with ``closed_at IS NULL``
are the current open set, so there is no separate state table to drift.

Timing is only as precise as polling. ``open_detected_after`` is the previous
successful poll, so the section opened somewhere in
``(open_detected_after, opened_at]``. It is NULL for sections that were already
open when tracking began, whose opening time is unknown.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    String,
    Text,
    func,
    text,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class TermRow(Base):
    __tablename__ = "terms"

    code: Mapped[str] = mapped_column(String(5), primary_key=True)
    name: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Catalog(Base):
    """The normalized catalog for one term and campus, stored gzipped for serving."""

    __tablename__ = "catalogs"

    term: Mapped[str] = mapped_column(ForeignKey("terms.code"), primary_key=True)
    campus: Mapped[str] = mapped_column(String(2), primary_key=True)
    generated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    etag: Mapped[str] = mapped_column(Text)
    course_count: Mapped[int] = mapped_column(Integer)
    section_count: Mapped[int] = mapped_column(Integer)
    payload_gzip: Mapped[bytes] = mapped_column(LargeBinary)


class Section(Base):
    """Index lookup for joins: what an index is, independent of the catalog blob."""

    __tablename__ = "sections"

    term: Mapped[str] = mapped_column(ForeignKey("terms.code"), primary_key=True)
    index: Mapped[str] = mapped_column(String(5), primary_key=True)
    campus: Mapped[str] = mapped_column(String(2))
    course_code: Mapped[str] = mapped_column(Text)
    course_title: Mapped[str] = mapped_column(Text)
    section_number: Mapped[str] = mapped_column(Text)
    instructors: Mapped[str] = mapped_column(Text)
    spn: Mapped[bool] = mapped_column(Boolean)


class Opening(Base):
    __tablename__ = "openings"
    __table_args__ = (
        # At most one open row per section: the current open set.
        Index(
            "uq_openings_current",
            "term",
            "index",
            unique=True,
            postgresql_where=text("closed_at IS NULL"),
        ),
        Index("ix_openings_section", "term", "index", "opened_at"),
        Index("ix_openings_opened", "term", "opened_at"),
        Index("ix_openings_closed", "term", "closed_at"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    term: Mapped[str] = mapped_column(ForeignKey("terms.code"))
    index: Mapped[str] = mapped_column(String(5))
    opened_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    open_detected_after: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    close_detected_after: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Poll(Base):
    """One poll attempt. Feeds uptime metrics and the previous-poll timestamps."""

    __tablename__ = "polls"
    __table_args__ = (Index("ix_polls_term_finished", "term", "finished_at"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    term: Mapped[str] = mapped_column(ForeignKey("terms.code"))
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    # ok: applied · held: mass change waiting for confirmation · error: request failed
    status: Mapped[str] = mapped_column(String(8))
    open_count: Mapped[int | None] = mapped_column(Integer)
    opened: Mapped[int] = mapped_column(Integer, default=0)
    closed: Mapped[int] = mapped_column(Integer, default=0)
    error: Mapped[str | None] = mapped_column(Text)
