"""Metric regressions against PostgreSQL, including independently seeded terms."""

from datetime import timedelta

from sqlalchemy import insert, select

from rusnipez.db.models import Alert, Opening, Poll, TermRow
from rusnipez.services.catalog import store_catalog
from rusnipez.services.poller import TermPoller
from rusnipez.services.reports import prune_polls, service_stats
from rusnipez.settings import Settings
from rusnipez.soc.term import Term
from tests.conftest import T0, Clock, FakeSoc, course, upstream_error
from tests.test_api import seed


async def test_term_stats_keep_reused_indexes_and_catalogs_separate(api, sessions):
    await seed(sessions)
    winter = Term.parse("02027")
    await store_catalog(
        sessions,
        winter,
        "NB",
        [course("01:198:999", "WINTER ONLY", *[(f"1000{n}", str(n)) for n in range(1, 5)])],
    )
    clock = Clock()
    poller = TermPoller(
        sessions,
        FakeSoc(
            {"10001", "10004"}, {"10001", "10002", "10003", "10004"}, {"10001", "10003", "10004"}
        ),
        winter,
        Settings(),
        clock=clock,
    )
    for _ in range(3):
        await poller.poll_once()
        clock.advance(60)
    spring = (await api.get("/api/v1/terms/12027/stats")).json()
    winter_stats = (await api.get("/api/v1/terms/02027/stats")).json()
    assert (spring["sectionsTracked"], spring["openNow"], spring["openings24h"]) == (3, 1, 1)
    assert (
        winter_stats["sectionsTracked"],
        winter_stats["openNow"],
        winter_stats["openings24h"],
    ) == (4, 3, 2)
    assert spring["medianOpenSeconds7d"] == 30
    assert winter_stats["medianOpenSeconds7d"] == 60
    for term, stats in [("12027", spring), ("02027", winter_stats)]:
        opened = (await api.get(f"/api/v1/terms/{term}/open")).json()
        assert stats["openNow"] == len(opened["indexes"])
        assert stats["checks24h"] == 3
        feed = (await api.get(f"/api/v1/terms/{term}/events")).json()
        titles = {event["courseTitle"] for event in feed["events"]}
        assert ("WINTER ONLY" in titles) == (term == "02027")
    total = (await api.get("/api/v1/stats")).json()
    assert total["openNow"] == spring["openNow"] + winter_stats["openNow"]
    assert total["openings24h"] == 3
    assert (await api.get("/api/v1/terms/92026/stats")).status_code == 404


async def test_daily_checks_are_2880_per_term_and_exclude_failed_responses(api, sessions):
    now = T0 + timedelta(minutes=10)
    # 2,881 samples include BOTH endpoints; the rolling (now - 24h, now]
    # interval contains exactly 2,880 at a 30-second cadence.
    rows = [
        {
            "term": "12027",
            "started_at": at,
            "finished_at": at,
            "status": "held" if n == 100 else "ok",
        }
        for n in range(2881)
        for at in [now - timedelta(seconds=30 * n)]
    ]
    for at in [now - timedelta(seconds=1), now + timedelta(seconds=1)]:
        rows.append({"term": "12027", "started_at": at, "finished_at": at, "status": "error"})
    # A future successful observation must not inflate a past rolling window.
    future = now + timedelta(seconds=30)
    rows.append({"term": "12027", "started_at": future, "finished_at": future, "status": "ok"})
    async with sessions.begin() as session:
        await session.execute(insert(Poll), rows)
    stats = (await api.get("/api/v1/terms/12027/stats")).json()
    assert stats["checks24h"] == 24 * 60 * 60 // 30 == 2880
    assert (await api.get("/api/v1/terms/02027/stats")).json()["checks24h"] == 0


async def test_delivery_metrics_follow_the_openings_term(api, sessions):
    async with sessions.begin() as session:
        for term, delays in [("12027", [1, 3]), ("02027", [8])]:
            opening = Opening(term=term, index="10001", opened_at=T0)
            session.add(opening)
            await session.flush()
            for delay in delays:
                session.add(
                    Alert(
                        opening_id=opening.id,
                        status="sent",
                        sent_at=T0 + timedelta(seconds=delay),
                        action="got_in" if delay == 1 else None,
                    )
                )
    spring = (await api.get("/api/v1/terms/12027/stats")).json()
    winter = (await api.get("/api/v1/terms/02027/stats")).json()
    assert (spring["alertsSentTotal"], spring["alertsSent24h"], spring["gotInTotal"]) == (2, 2, 1)
    assert (winter["alertsSentTotal"], winter["alertsSent24h"], winter["gotInTotal"]) == (1, 1, 0)
    assert spring["medianAlertSeconds7d"] == 2
    assert winter["medianAlertSeconds7d"] == 8


async def test_repeated_openings_count_but_baselines_and_window_boundaries_do_not(api, sessions):
    now = T0 + timedelta(minutes=10)
    day_ago = now - timedelta(days=1)
    async with sessions.begin() as session:
        for _n, at in enumerate(
            [day_ago, day_ago + timedelta(seconds=1), now, now + timedelta(seconds=1)]
        ):
            session.add(
                Opening(
                    term="12027",
                    index="10001",
                    opened_at=at,
                    open_detected_after=at - timedelta(seconds=30),
                    closed_at=at,
                )
            )
        session.add(Opening(term="12027", index="10002", opened_at=now))  # initial baseline
    stats = (await api.get("/api/v1/terms/12027/stats")).json()
    assert stats["openings24h"] == 2  # two transitions, even for the same index
    assert stats["openNow"] == 1


async def test_duration_uses_completed_precise_intervals_closed_in_the_week(api, sessions):
    now = T0 + timedelta(minutes=10)
    async with sessions.begin() as session:
        for n, seconds in enumerate([30, 120, 600]):
            end = now - timedelta(minutes=1)
            start = end - timedelta(seconds=seconds)
            session.add(
                Opening(
                    term="12027",
                    index=f"1000{n}",
                    opened_at=start,
                    open_detected_after=start - timedelta(seconds=30),
                    closed_at=end,
                    close_detected_after=end - timedelta(seconds=30),
                )
            )
        # Neither a baseline, an ongoing interval, nor an outage-bounded change
        # can supply a reliable completed duration.
        for n, (start_known, end_known, closed) in enumerate(
            [
                (None, now, now),
                (now, None, None),
                (now - timedelta(hours=1), now, now),
                (now, now - timedelta(hours=1), now),
            ]
        ):
            session.add(
                Opening(
                    term="12027",
                    index=f"2000{n}",
                    opened_at=now,
                    open_detected_after=start_known,
                    closed_at=closed,
                    close_detected_after=end_known,
                )
            )
        # Old opening is eligible if it CLOSED this week; old closures aren't.
        for n, end in enumerate([now - timedelta(days=1), now - timedelta(days=7)]):
            start = now - timedelta(days=8)
            session.add(
                Opening(
                    term="12027",
                    index=f"3000{n}",
                    opened_at=start,
                    open_detected_after=start - timedelta(seconds=30),
                    closed_at=end,
                    close_detected_after=end - timedelta(seconds=30),
                )
            )
    stats = (await api.get("/api/v1/terms/12027/stats")).json()
    assert stats["medianOpenSamples7d"] == 4
    assert stats["medianOpenSeconds7d"] == 360  # median of 30, 120, 600, 604800


async def test_held_and_failed_checks_do_not_refresh_trusted_data_or_reset_tracking(api, sessions):
    clock = Clock()
    poller = TermPoller(
        sessions,
        FakeSoc(set(), {"10001"}, set(), upstream_error()),
        Term.parse("12027"),
        Settings(change_guard_minimum=1),
        clock=clock,
    )
    for _ in range(4):
        await poller.poll_once()
        clock.advance()
    # Empty baseline still starts tracking, even with no Opening row.
    async with sessions() as session:
        assert (await session.get(TermRow, "12027")).tracking_started_at == T0
    stats = (await api.get("/api/v1/terms/12027/stats")).json()
    assert stats["checks24h"] == 3  # ok, ok, held; error does not count
    assert stats["lastPollAt"] == (T0 + timedelta(seconds=60)).isoformat().replace("+00:00", "Z")
    assert stats["openObservedAt"] == (T0 + timedelta(seconds=30)).isoformat().replace(
        "+00:00", "Z"
    )
    meta = (await api.get("/api/v1/meta")).json()
    assert meta["terms"][0]["lastPollAt"] == stats["openObservedAt"]
    async with sessions.begin() as session:
        await prune_polls(session, T0 + timedelta(days=20))
        assert (
            await session.scalar(select(TermRow.tracking_started_at).where(TermRow.code == "12027"))
            == T0
        )
    async with sessions() as session:
        after_pruning = await service_stats(
            session, ["12027"], T0 + timedelta(days=20), precise_window=90
        )
    assert after_pruning["tracking_since"] == T0
