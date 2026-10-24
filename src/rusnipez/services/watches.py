"""Watches: the only code that creates, lists or removes them, so the bot and any
later entry point share the same limits.

Callers own the transaction. ``add_watch`` locks the user's row, so two
requests from one person cannot both slip under the watch limit.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Literal

from sqlalchemy import delete, exists, func, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from rusnipez.db.models import Identity, Opening, Section, User, Watch

AddResult = Literal["added", "duplicate", "limit", "unknown", "banned"]


@dataclass(frozen=True, slots=True)
class WatchView:
    id: int
    term: str
    index: str
    created_at: datetime
    snoozed_until: datetime | None
    open: bool
    # None when Rutgers has not listed the section yet.
    course_code: str | None
    course_title: str | None
    section_number: str | None
    instructors: str | None


async def user_for(session: AsyncSession, provider: str, subject: str) -> User:
    """The user behind an identity, created on first use."""
    user_id = await session.scalar(
        select(Identity.user_id).where(Identity.provider == provider, Identity.subject == subject)
    )
    if user_id is None:
        user = User()
        session.add(user)
        await session.flush()
        # A concurrent first command from the same person may have won the race.
        user_id = await session.scalar(
            insert(Identity)
            .values(user_id=user.id, provider=provider, subject=subject)
            .on_conflict_do_nothing(index_elements=["provider", "subject"])
            .returning(Identity.user_id)
        )
        if user_id is None:
            await session.delete(user)
            return await user_for(session, provider, subject)
        return user
    return await session.get_one(User, user_id)


async def section_known(session: AsyncSession, term: str, index: str) -> bool:
    """Listed in a catalog, or open even though Rutgers has not listed it yet."""
    listed = exists().where(Section.term == term, Section.index == index)
    open_now = exists().where(
        Opening.term == term, Opening.index == index, Opening.closed_at.is_(None)
    )
    return bool(await session.scalar(select(listed | open_now)))


async def add_watch(
    session: AsyncSession, user: User, term: str, index: str, *, limit: int
) -> AddResult:
    locked = await session.scalar(select(User).where(User.id == user.id).with_for_update())
    if locked is None or locked.banned_at is not None:
        return "banned"
    if await session.scalar(
        select(Watch.id).where(Watch.user_id == user.id, Watch.term == term, Watch.index == index)
    ):
        return "duplicate"
    count = await session.scalar(
        select(func.count()).where(Watch.user_id == user.id, Watch.term == term)
    )
    if count >= limit:
        return "limit"
    if not await section_known(session, term, index):
        return "unknown"
    session.add(Watch(user_id=user.id, term=term, index=index))
    await session.flush()
    return "added"


async def list_watches(session: AsyncSession, user_id: int, terms: list[str]) -> list[WatchView]:
    """A user's watches in active terms, open sections first."""
    open_now = (
        exists()
        .where(
            Opening.term == Watch.term, Opening.index == Watch.index, Opening.closed_at.is_(None)
        )
        .label("open")
    )
    rows = await session.execute(
        select(
            Watch.id,
            Watch.term,
            Watch.index,
            Watch.created_at,
            Watch.snoozed_until,
            open_now,
            Section.course_code,
            Section.course_title,
            Section.section_number,
            Section.instructors,
        )
        .outerjoin(Section, (Section.term == Watch.term) & (Section.index == Watch.index))
        .where(Watch.user_id == user_id, Watch.term.in_(terms))
        .order_by(open_now.desc(), Watch.term, Section.course_code, Watch.index)
    )
    return [WatchView(*row) for row in rows]


async def remove_watch(session: AsyncSession, user_id: int, term: str, index: str) -> bool:
    removed = await session.execute(
        delete(Watch).where(Watch.user_id == user_id, Watch.term == term, Watch.index == index)
    )
    return removed.rowcount > 0


async def clear_watches(session: AsyncSession, user_id: int) -> int:
    removed = await session.execute(delete(Watch).where(Watch.user_id == user_id))
    return removed.rowcount


async def snooze_watch(session: AsyncSession, user_id: int, watch_id: int, until: datetime) -> bool:
    snoozed = await session.execute(
        update(Watch)
        .where(Watch.id == watch_id, Watch.user_id == user_id)
        .values(snoozed_until=until)
    )
    return snoozed.rowcount > 0


async def prune_inactive_watches(session: AsyncSession, active_terms: list[str]) -> int:
    """Watches end with their term: drop those for terms no longer polled."""
    removed = await session.execute(delete(Watch).where(Watch.term.not_in(active_terms)))
    return removed.rowcount
