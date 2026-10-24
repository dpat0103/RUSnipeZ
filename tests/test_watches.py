from __future__ import annotations

import asyncio
from datetime import timedelta

from sqlalchemy import func, select

from rusnipez.db.models import Identity, Opening, Section, User, Watch
from rusnipez.services import watches
from tests.conftest import T0

TERMS = ["12027", "02027"]


def section(index: str, code: str = "01:198:111", term: str = "12027") -> Section:
    return Section(
        term=term,
        index=index,
        campus="NB",
        course_code=code,
        course_title="INTRO COMPUTER SCI",
        section_number="01",
        instructors="DOE, JANE",
        spn=False,
    )


async def seed_sections(sessions, *indexes: str) -> None:
    async with sessions.begin() as session:
        session.add_all(section(index) for index in indexes)


async def new_user(sessions, subject: str = "1001") -> User:
    async with sessions.begin() as session:
        return await watches.user_for(session, "discord", subject)


async def add(sessions, user: User, index: str, *, limit: int = 15, term: str = "12027") -> str:
    async with sessions.begin() as session:
        return await watches.add_watch(session, user, term, index, limit=limit)


async def test_an_identity_maps_to_one_user(sessions) -> None:
    first = await new_user(sessions, "1001")
    again = await new_user(sessions, "1001")
    other = await new_user(sessions, "1002")
    assert first.id == again.id != other.id
    async with sessions() as session:
        assert await session.scalar(select(func.count()).select_from(Identity)) == 2


async def test_concurrent_first_commands_create_one_user(sessions) -> None:
    users = await asyncio.gather(*(new_user(sessions, "1001") for _ in range(5)))
    assert len({user.id for user in users}) == 1
    async with sessions() as session:
        assert await session.scalar(select(func.count()).select_from(Identity)) == 1


async def test_add_reports_each_outcome(sessions) -> None:
    await seed_sections(sessions, "10001", "10002")
    user = await new_user(sessions)
    assert await add(sessions, user, "10001") == "added"
    assert await add(sessions, user, "10001") == "duplicate"
    assert await add(sessions, user, "99999") == "unknown"
    assert await add(sessions, user, "10002", limit=1) == "limit"


async def test_an_open_unlisted_section_can_be_watched(sessions) -> None:
    async with sessions.begin() as session:
        session.add(Opening(term="12027", index="26181", opened_at=T0))
    user = await new_user(sessions)
    assert await add(sessions, user, "26181") == "added"


async def test_the_limit_is_per_term(sessions) -> None:
    async with sessions.begin() as session:
        session.add_all([section("10001"), section("10001", term="02027")])
    user = await new_user(sessions)
    assert await add(sessions, user, "10001", limit=1) == "added"
    assert await add(sessions, user, "10001", limit=1, term="02027") == "added"


async def test_concurrent_adds_cannot_exceed_the_limit(sessions) -> None:
    indexes = [f"1{n:04d}" for n in range(10)]
    await seed_sections(sessions, *indexes)
    user = await new_user(sessions)
    results = await asyncio.gather(*(add(sessions, user, index, limit=3) for index in indexes))
    assert results.count("added") == 3
    assert results.count("limit") == 7


async def test_banned_users_cannot_add(sessions) -> None:
    await seed_sections(sessions, "10001")
    user = await new_user(sessions)
    async with sessions.begin() as session:
        (await session.get_one(User, user.id)).banned_at = T0
    assert await add(sessions, user, "10001") == "banned"


async def test_list_shows_open_sections_first_with_details(sessions) -> None:
    async with sessions.begin() as session:
        session.add_all([section("10001", "01:198:112"), section("10002", "01:198:111")])
        session.add(Opening(term="12027", index="10001", opened_at=T0))
    user = await new_user(sessions)
    await add(sessions, user, "10002")
    await add(sessions, user, "10001")
    async with sessions() as session:
        rows = await watches.list_watches(session, user.id, TERMS)
    assert [(row.index, row.open, row.course_code) for row in rows] == [
        ("10001", True, "01:198:112"),
        ("10002", False, "01:198:111"),
    ]


async def test_list_skips_terms_no_longer_polled(sessions) -> None:
    await seed_sections(sessions, "10001")
    user = await new_user(sessions)
    await add(sessions, user, "10001")
    async with sessions() as session:
        assert await watches.list_watches(session, user.id, ["02027"]) == []


async def test_remove_clear_and_snooze_touch_only_the_owner(sessions) -> None:
    await seed_sections(sessions, "10001", "10002")
    owner = await new_user(sessions, "1001")
    other = await new_user(sessions, "1002")
    for index in ("10001", "10002"):
        await add(sessions, owner, index)
    async with sessions.begin() as session:
        watch_id = await session.scalar(select(Watch.id).where(Watch.index == "10001"))
        assert not await watches.remove_watch(session, other.id, "12027", "10001")
        assert not await watches.snooze_watch(session, other.id, watch_id, T0)
        assert await watches.clear_watches(session, other.id) == 0
        assert await watches.snooze_watch(session, owner.id, watch_id, T0 + timedelta(hours=1))
        assert await watches.remove_watch(session, owner.id, "12027", "10002")
        assert not await watches.remove_watch(session, owner.id, "12027", "10002")
    async with sessions() as session:
        rows = await watches.list_watches(session, owner.id, TERMS)
    assert [(row.index, row.snoozed_until) for row in rows] == [("10001", T0 + timedelta(hours=1))]
    async with sessions.begin() as session:
        assert await watches.clear_watches(session, owner.id) == 1


async def test_watches_end_with_their_term(sessions) -> None:
    async with sessions.begin() as session:
        session.add_all([section("10001"), section("10001", term="02027")])
    user = await new_user(sessions)
    await add(sessions, user, "10001")
    await add(sessions, user, "10001", term="02027")
    async with sessions.begin() as session:
        assert await watches.prune_inactive_watches(session, ["12027"]) == 1
    async with sessions() as session:
        assert await session.scalar(select(Watch.term)) == "12027"
