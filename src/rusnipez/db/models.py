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


class User(Base):
    """A person who watches sections. Limits and bans count per user, not per
    identity, so one person signing in two ways still gets one watch limit."""

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    banned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Identity(Base):
    """One way to reach a user: provider ``discord`` with the Discord user ID as
    subject. Alerts go to every identity the user has."""

    __tablename__ = "identities"
    __table_args__ = (
        Index("uq_identities_subject", "provider", "subject", unique=True),
        Index("ix_identities_user", "user_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    provider: Mapped[str] = mapped_column(String(16))
    subject: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    # Set when delivery is refused (closed DMs), cleared on the next success.
    delivery_failed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Discord: the private thread alerts go to while DMs are closed.
    fallback_channel_id: Mapped[int | None] = mapped_column(BigInteger)


class Watch(Base):
    __tablename__ = "watches"
    __table_args__ = (
        Index("uq_watches_user_section", "user_id", "term", "index", unique=True),
        # Finding the watchers of a section that just opened.
        Index("ix_watches_section", "term", "index"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    term: Mapped[str] = mapped_column(ForeignKey("terms.code"))
    # No foreign key to sections: Rutgers opens some sections before listing them.
    index: Mapped[str] = mapped_column(String(5))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    snoozed_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Alert(Base):
    """Outbox: one row per watcher per opening, written in the same transaction
    as the opening. The unique key makes every opening alert each watcher once,
    across restarts and retries.

    Alerts outlive their watch: removing a watch (or a user) unlinks its alerts
    instead of deleting them, so delivery counts and latency stay accurate
    without keeping anything that identifies a person."""

    __tablename__ = "alerts"
    __table_args__ = (
        Index("uq_alerts_watch_opening", "watch_id", "opening_id", unique=True),
        Index(
            "ix_alerts_pending",
            "next_attempt_at",
            postgresql_where=text("status = 'pending'"),
        ),
        Index("ix_alerts_sent", "sent_at"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    watch_id: Mapped[int | None] = mapped_column(ForeignKey("watches.id", ondelete="SET NULL"))
    opening_id: Mapped[int] = mapped_column(ForeignKey("openings.id", ondelete="CASCADE"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    # pending: waiting to send · sent: delivered · failed: gave up after retries
    status: Mapped[str] = mapped_column(String(8), server_default="pending")
    attempts: Mapped[int] = mapped_column(Integer, server_default="0")
    next_attempt_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    error: Mapped[str | None] = mapped_column(Text)
    # What the person did with it: snoozed · stopped · got_in
    action: Mapped[str | None] = mapped_column(String(8))
    acted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
