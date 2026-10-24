"""Watches: the only code that creates, lists or removes them, so the bot and any
later entry point share the same limits.

Callers own the transaction. ``add_watch`` locks the user's row, so two
requests from one person cannot both slip under the watch limit.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Literal

from sqlalchemy import case, delete, exists, func, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from rusnipez.db.models import Alert, Identity, Opening, Section, User, Watch

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


async def remove_watch_by_id(session: AsyncSession, user_id: int, watch_id: int) -> bool:
    removed = await session.execute(
        delete(Watch).where(Watch.id == watch_id, Watch.user_id == user_id)
    )
    return removed.rowcount > 0


async def record_action(session: AsyncSession, alert_id: int, action: str, now: datetime) -> None:
    """What someone did with an alert: snoozed, stopped or got_in. The first
    answer counts; pressing another button later does not overwrite it."""
    await session.execute(
        update(Alert)
        .where(Alert.id == alert_id, Alert.action.is_(None))
        .values(action=action, acted_at=now)
    )


@dataclass(frozen=True, slots=True)
class SectionMatch:
    term: str
    index: str
    course_code: str
    course_title: str
    section_number: str


async def find_sections(
    session: AsyncSession, terms: list[str], query: str, limit: int = 25
) -> list[SectionMatch]:
    """Sections for autocomplete: by index prefix, course code or title words.
    Earlier active terms come first."""
    query = query.strip()
    filters = []
    if query.isdigit():
        filters.append(Section.index.startswith(query))
    elif query:
        pattern = f"%{query.replace('%', '').replace('_', '')}%"
        filters.append(Section.course_code.ilike(pattern) | Section.course_title.ilike(pattern))
    term_order = case({term: n for n, term in enumerate(terms)}, value=Section.term)
    rows = await session.execute(
        select(
            Section.term,
            Section.index,
            Section.course_code,
            Section.course_title,
            Section.section_number,
        )
        .where(Section.term.in_(terms), *filters)
        .order_by(term_order, Section.course_code, Section.section_number, Section.index)
        .limit(limit)
    )
    return [SectionMatch(*row) for row in rows]


async def resolve_section(
    session: AsyncSession, terms: list[str], value: str
) -> tuple[str, str] | None:
    """A (term, index) from autocomplete's ``term:index`` or a typed index. A
    typed index belongs to the first active term that has it."""
    value = value.strip()
    if ":" in value:
        term, _, index = value.partition(":")
        return (term, index) if term in terms and index.isdigit() and len(index) == 5 else None
    if not (value.isdigit() and len(value) == 5):
        return None
    for term in terms:
        if await section_known(session, term, value):
            return term, value
    return None


async def find_courses(
    session: AsyncSession, terms: list[str], query: str, limit: int = 25
) -> list[tuple[str, str, str]]:
    """(term, course code, title) for /course autocomplete."""
    pattern = f"%{query.strip().replace('%', '').replace('_', '')}%"
    term_order = func.min(case({term: n for n, term in enumerate(terms)}, value=Section.term))
    rows = await session.execute(
        select(Section.term, Section.course_code, Section.course_title)
        .where(
            Section.term.in_(terms),
            Section.course_code.ilike(pattern) | Section.course_title.ilike(pattern),
        )
        .group_by(Section.term, Section.course_code, Section.course_title)
        .order_by(term_order, Section.course_code)
        .limit(limit)
    )
    return [tuple(row) for row in rows]


@dataclass(frozen=True, slots=True)
class CourseSection:
    index: str
    number: str
    instructors: str
    campus: str
    open: bool


async def course_sections(
    session: AsyncSession, term: str, course_code: str
) -> tuple[str | None, list[CourseSection]]:
    """A course's title and every section with live status, by section number."""
    open_now = (
        exists()
        .where(
            Opening.term == Section.term,
            Opening.index == Section.index,
            Opening.closed_at.is_(None),
        )
        .label("open")
    )
    rows = (
        await session.execute(
            select(
                Section.course_title,
                Section.index,
                Section.section_number,
                Section.instructors,
                Section.campus,
                open_now,
            )
            .where(Section.term == term, Section.course_code == course_code)
            .order_by(Section.section_number, Section.index)
        )
    ).all()
    title = rows[0].course_title if rows else None
    return title, [CourseSection(*row[1:]) for row in rows]
