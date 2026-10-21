from __future__ import annotations

from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from rusnipez.db.models import Opening, Poll
from rusnipez.services.poller import TermPoller
from rusnipez.settings import Settings
from rusnipez.soc.term import Term
from tests.conftest import T0, Clock, FakeSoc, upstream_error

SPRING = Term.parse("12027")
SETTINGS = Settings(change_guard_minimum=5, change_guard_confirm_seconds=60)
MANY = {f"1{n:04d}" for n in range(10)}


def make_poller(sessions: async_sessionmaker, soc: FakeSoc, clock: Clock) -> TermPoller:
    return TermPoller(sessions, soc, SPRING, SETTINGS, clock=clock)  # type: ignore[arg-type]


async def openings(sessions: async_sessionmaker) -> list[Opening]:
    async with sessions() as session:
        return list(await session.scalars(select(Opening).order_by(Opening.index, Opening.id)))


async def polls(sessions: async_sessionmaker) -> list[Poll]:
    async with sessions() as session:
        return list(await session.scalars(select(Poll).order_by(Poll.id)))


async def test_first_poll_records_baseline_with_unknown_opening_time(sessions) -> None:
    clock = Clock()
    assert await make_poller(sessions, FakeSoc({"10001", "10002"}), clock).poll_once() == "ok"
    rows = await openings(sessions)
    assert [row.index for row in rows] == ["10001", "10002"]
    assert all(row.opened_at == T0 and row.open_detected_after is None for row in rows)


async def test_openings_and_closings_are_bounded_by_the_previous_poll(sessions) -> None:
    clock = Clock()
    poller = make_poller(sessions, FakeSoc({"10001"}, {"10002"}, {"10002"}), clock)
    await poller.poll_once()
    clock.advance()
    await poller.poll_once()

    first, second = await openings(sessions)
    assert first.index == "10001"
    assert first.closed_at == T0 + timedelta(seconds=30)
    assert first.close_detected_after == T0
    assert second.index == "10002"
    assert second.opened_at == T0 + timedelta(seconds=30)
    assert second.open_detected_after == T0
    assert second.closed_at is None

    clock.advance()
    await poller.poll_once()
    assert len(await openings(sessions)) == 2  # staying open records nothing new
    assert [p.opened for p in await polls(sessions)] == [1, 1, 0]


async def test_reopening_creates_a_new_row(sessions) -> None:
    clock = Clock()
    poller = make_poller(sessions, FakeSoc({"10001"}, set(), {"10001"}), clock)
    for _ in range(3):
        await poller.poll_once()
        clock.advance()
    rows = await openings(sessions)
    assert len(rows) == 2
    assert rows[0].closed_at is not None and rows[1].closed_at is None


async def test_upstream_error_is_logged_and_changes_nothing(sessions) -> None:
    clock = Clock()
    poller = make_poller(sessions, FakeSoc({"10001"}, upstream_error()), clock)
    await poller.poll_once()
    clock.advance()
    assert await poller.poll_once() == "error"
    assert [p.status for p in await polls(sessions)] == ["ok", "error"]
    assert (await polls(sessions))[1].error == "openSections.json returned HTTP 503"
    assert len(await openings(sessions)) == 1


async def test_errors_do_not_count_as_the_previous_poll(sessions) -> None:
    clock = Clock()
    poller = make_poller(sessions, FakeSoc(set(), upstream_error(), {"10001"}), clock)
    for _ in range(3):
        await poller.poll_once()
        clock.advance()
    (row,) = await openings(sessions)
    assert row.open_detected_after == T0  # the failed poll at T0+30s saw nothing


async def test_mass_change_is_held_until_confirmed(sessions) -> None:
    clock = Clock()
    poller = make_poller(sessions, FakeSoc(MANY, set(), set(), set()), clock)
    await poller.poll_once()
    for expected in ("held", "held", "ok"):
        clock.advance()
        assert await poller.poll_once() == expected
    rows = await openings(sessions)
    assert all(row.closed_at == T0 + timedelta(seconds=90) for row in rows)
    # Held polls are not observations: closings are bounded by the last applied poll.
    assert all(row.close_detected_after == T0 for row in rows)
    held = [p for p in await polls(sessions) if p.status == "held"]
    assert [(p.open_count, p.closed) for p in held] == [(0, 10), (0, 10)]


async def test_stale_snapshot_then_recovery_records_nothing(sessions) -> None:
    clock = Clock()
    stale = (MANY - {"10000", "10001", "10002", "10003", "10004"}) | {"19999"}
    poller = make_poller(sessions, FakeSoc(MANY, stale, stale, MANY), clock)
    for _ in range(4):
        await poller.poll_once()
        clock.advance()
    assert len(await openings(sessions)) == len(MANY)
    assert all(row.closed_at is None for row in await openings(sessions))
    assert [p.status for p in await polls(sessions)] == ["ok", "held", "held", "ok"]


async def test_recurring_stale_snapshot_stays_held(sessions) -> None:
    clock = Clock()
    stale = MANY - {"10000", "10001", "10002", "10003", "10004"}
    soc = FakeSoc(MANY, stale, MANY, *[stale] * 6)
    poller = make_poller(sessions, soc, clock)
    for _ in range(9):
        await poller.poll_once()
        clock.advance()
    # Three minutes of the remembered snapshot, past the 60 s window: still held.
    assert all(row.closed_at is None for row in await openings(sessions))
    assert [p.status for p in await polls(sessions)][-6:] == ["held"] * 6


async def test_restart_resumes_from_stored_state(sessions) -> None:
    clock = Clock()
    await make_poller(sessions, FakeSoc({"10001", "10002"}), clock).poll_once()
    clock.advance(3600)  # service was down for an hour
    restarted = make_poller(sessions, FakeSoc({"10002", "10003"}), clock)
    await restarted.poll_once()

    rows = {row.index: row for row in await openings(sessions)}
    assert rows["10001"].closed_at == T0 + timedelta(hours=1)
    assert rows["10001"].close_detected_after == T0
    assert rows["10002"].closed_at is None  # still open: not reopened, not duplicated
    assert rows["10003"].open_detected_after == T0  # wide window: imprecise, but honest


async def test_terms_are_tracked_independently(sessions) -> None:
    clock = Clock()
    await make_poller(sessions, FakeSoc({"10001"}), clock).poll_once()
    winter = TermPoller(sessions, FakeSoc({"10001"}), Term.parse("02027"), SETTINGS, clock=clock)  # type: ignore[arg-type]
    await winter.poll_once()
    assert sorted(row.term for row in await openings(sessions)) == ["02027", "12027"]
