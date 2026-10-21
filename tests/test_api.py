from __future__ import annotations

import json
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from sqlalchemy import insert

from rusnipez.api import routes
from rusnipez.api.app import create_app
from rusnipez.db.models import Opening, Poll
from rusnipez.services.catalog import store_catalog
from rusnipez.services.poller import TermPoller
from rusnipez.settings import Settings
from rusnipez.soc.term import Term
from tests.conftest import T0, TERMS, Clock, FakeSoc, course

SPRING = Term.parse("12027")
COURSES = [
    course("01:198:111", "INTRO COMPUTER SCI", ("10001", "01"), ("10002", "02")),
    course("01:355:101", "COLLEGE WRITING", ("10003", "01")),
]


@pytest.fixture
async def api(sessions, database_url, monkeypatch) -> AsyncIterator[httpx.AsyncClient]:
    # Freeze "now" ten minutes after the seeded polls.
    monkeypatch.setattr(routes, "now", lambda: T0 + timedelta(minutes=10))
    app = create_app(Settings(database_url=database_url, active_terms=TERMS, run_workers=False))
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        yield client
    await app.state.engine.dispose()


async def seed(sessions) -> None:
    """Catalog plus three polls: 10001 open from the start, 10002 opens, then closes."""
    await store_catalog(sessions, SPRING, "NB", COURSES)
    clock = Clock()
    soc = FakeSoc({"10001"}, {"10001", "10002"}, {"10001"})
    poller = TermPoller(sessions, soc, SPRING, Settings(), clock=clock)  # type: ignore[arg-type]
    for _ in range(3):
        await poller.poll_once()
        clock.advance()


async def test_health(api) -> None:
    response = await api.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


async def test_meta_lists_active_terms_in_priority_order(api, sessions) -> None:
    await seed(sessions)
    body = (await api.get("/api/v1/meta")).json()
    assert body["defaultTerm"] == "12027"
    assert body["pollSeconds"] == 30
    spring, winter = body["terms"]
    assert spring["code"] == "12027" and spring["name"] == "Spring 2027"
    assert spring["openCount"] == 1
    assert spring["catalogs"][0]["campus"] == "NB" and spring["catalogs"][0]["sections"] == 3
    assert spring["lastPollAt"] == "2026-11-16T14:01:00Z"
    assert winter == {
        "code": "02027",
        "name": "Winter 2027",
        "catalogs": [],
        "lastPollAt": None,
        "openCount": 0,
    }


async def test_open_sections(api, sessions) -> None:
    await seed(sessions)
    response = await api.get("/api/v1/terms/12027/open")
    assert response.headers["cache-control"] == routes.LIVE
    assert response.json() == {
        "term": "12027",
        "observedAt": "2026-11-16T14:01:00Z",
        "indexes": ["10001"],
    }


async def test_events_are_newest_first_with_section_details(api, sessions) -> None:
    await seed(sessions)
    events = (await api.get("/api/v1/terms/12027/events")).json()["events"]
    assert [(e["kind"], e["index"], e["at"]) for e in events] == [
        ("closed", "10002", "2026-11-16T14:01:00Z"),
        ("opened", "10002", "2026-11-16T14:00:30Z"),
    ]
    assert events[0]["courseTitle"] == "INTRO COMPUTER SCI"
    assert events[0]["sectionNumber"] == "02"
    assert events[0]["campus"] == "NB"
    assert all(e["precise"] for e in events)


async def test_events_limit_is_validated(api) -> None:
    assert (await api.get("/api/v1/terms/12027/events?limit=0")).status_code == 422
    assert (await api.get("/api/v1/terms/12027/events?limit=201")).status_code == 422


async def test_history_summary(api, sessions) -> None:
    await seed(sessions)
    body = (await api.get("/api/v1/terms/12027/history")).json()
    # 10001 is open now and has no observed openings, so the open set covers it.
    assert body["sections"] == {
        "10002": {"lastSeenOpen": "2026-11-16T14:00:30Z", "openings7d": 1},
    }


async def test_section_history_for_observed_openings(api, sessions) -> None:
    await seed(sessions)
    body = (await api.get("/api/v1/terms/12027/sections/10002")).json()
    assert body["courseCode"] == "01:198:111"
    assert body["openNow"] is False
    assert body["openSince"] is None
    assert body["lastOpenedAt"] == "2026-11-16T14:00:30Z"
    assert body["lastSeenOpenAt"] == "2026-11-16T14:00:30Z"
    assert body["openings7d"] == 1 and body["openings30d"] == 1
    assert body["medianOpenSeconds"] == 30
    assert body["openingsByHour"][9] == 1 and sum(body["openingsByHour"]) == 1
    assert body["recent"] == [
        {
            "openedAt": "2026-11-16T14:00:30Z",
            "closedAt": "2026-11-16T14:01:00Z",
            "openedPrecise": True,
        }
    ]


async def test_section_open_since_tracking_began_has_no_known_start(api, sessions) -> None:
    await seed(sessions)
    body = (await api.get("/api/v1/terms/12027/sections/10001")).json()
    assert body["openNow"] is True
    assert body["openSince"] is None  # it was already open on the first poll
    assert body["lastOpenedAt"] is None
    assert body["openings7d"] == 0


async def test_section_never_seen_open(api, sessions) -> None:
    await seed(sessions)
    body = (await api.get("/api/v1/terms/12027/sections/10003")).json()
    assert body["openNow"] is False
    assert body["lastSeenOpenAt"] is None
    assert body["medianOpenSeconds"] is None
    assert body["recent"] == []


async def test_imprecise_openings_are_excluded_from_timing_stats(api, sessions) -> None:
    await store_catalog(sessions, SPRING, "NB", COURSES)
    async with sessions.begin() as session:
        await session.execute(
            insert(Opening),
            [
                {  # detected after a two-hour outage: when it opened is unknown
                    "term": "12027",
                    "index": "10003",
                    "opened_at": T0,
                    "open_detected_after": T0 - timedelta(hours=2),
                    "closed_at": T0 + timedelta(minutes=5),
                    "close_detected_after": T0 + timedelta(minutes=4, seconds=30),
                }
            ],
        )
    body = (await api.get("/api/v1/terms/12027/sections/10003")).json()
    assert body["openings7d"] == 1
    assert body["medianOpenSeconds"] is None
    assert sum(body["openingsByHour"]) == 0
    assert body["recent"][0]["openedPrecise"] is False


async def test_unknown_section_and_term(api, sessions) -> None:
    await seed(sessions)
    assert (await api.get("/api/v1/terms/12027/sections/99999")).status_code == 404
    assert (await api.get("/api/v1/terms/92026/open")).status_code == 404
    assert (await api.get("/api/v1/terms/abc/open")).status_code == 422
    assert (await api.get("/api/v1/terms/12027/sections/1234")).status_code == 422


async def test_catalog_is_served_gzipped_with_etag(api, sessions) -> None:
    await store_catalog(sessions, SPRING, "NB", COURSES)
    response = await api.get("/api/v1/terms/12027/catalogs/NB")
    assert response.status_code == 200
    assert response.headers["content-encoding"] == "gzip"
    assert response.headers["cache-control"] == routes.CATALOG
    assert response.json()["meta"]["counts"]["sections"] == 3  # httpx decompresses

    etag = response.headers["etag"]
    cached = await api.get("/api/v1/terms/12027/catalogs/NB", headers={"If-None-Match": etag})
    assert cached.status_code == 304 and cached.content == b""


async def test_catalog_without_gzip_support(api, sessions) -> None:
    await store_catalog(sessions, SPRING, "NB", COURSES)
    response = await api.get(
        "/api/v1/terms/12027/catalogs/NB", headers={"Accept-Encoding": "identity"}
    )
    assert "content-encoding" not in response.headers
    assert json.loads(response.content)["meta"]["campus"] == "NB"
    assert response.content.startswith(b"{")


async def test_missing_catalog_and_bad_campus(api) -> None:
    assert (await api.get("/api/v1/terms/12027/catalogs/NB")).status_code == 404
    assert (await api.get("/api/v1/terms/12027/catalogs/XX")).status_code == 422


async def test_stats(api, sessions) -> None:
    await seed(sessions)
    body = (await api.get("/api/v1/stats")).json()
    assert body["sectionsTracked"] == 3
    assert body["openNow"] == 1
    assert body["openings24h"] == 1
    assert body["openingsTotal"] == 1
    assert body["lastPollAt"] == "2026-11-16T14:01:00Z"
    # Polls covered 2 of the 11 minutes since tracking began (14:00 to 14:10).
    assert body["uptime24h"] == round(2 / 11, 4)


async def test_stats_with_no_data(api) -> None:
    body = (await api.get("/api/v1/stats")).json()
    assert body == {
        "sectionsTracked": 0,
        "openNow": 0,
        "openings24h": 0,
        "openingsTotal": 0,
        "uptime24h": None,
        "lastPollAt": None,
    }


async def test_large_responses_are_compressed_once(api, sessions) -> None:
    await store_catalog(sessions, SPRING, "NB", COURSES)
    async with sessions.begin() as session:
        await session.execute(
            insert(Opening),
            [{"term": "12027", "index": f"{n:05d}", "opened_at": T0} for n in range(300)],
        )
    response = await api.get("/api/v1/terms/12027/open")
    assert response.headers["content-encoding"] == "gzip"
    assert len(response.json()["indexes"]) == 300
    catalog = await api.get("/api/v1/terms/12027/catalogs/NB")
    assert catalog.json()["meta"]["campus"] == "NB"  # pre-gzipped, not gzipped twice


async def test_openapi_docs_are_published(api) -> None:
    schema = (await api.get("/api/openapi.json")).json()
    assert "/api/v1/terms/{term}/sections/{index}" in schema["paths"]


async def test_prune_keeps_latest_successful_poll(sessions) -> None:
    from rusnipez.services.reports import prune_polls

    old = datetime(2026, 1, 1, tzinfo=UTC)
    async with sessions.begin() as session:
        await session.execute(
            insert(Poll),
            [
                {"term": "12027", "started_at": old, "finished_at": old, "status": "ok"},
                {"term": "12027", "started_at": old, "finished_at": old, "status": "ok"},
                {"term": "12027", "started_at": old, "finished_at": old, "status": "error"},
            ],
        )
        removed = await prune_polls(session, datetime(2026, 2, 1, tzinfo=UTC))
    assert removed == 2
