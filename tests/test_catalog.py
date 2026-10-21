from __future__ import annotations

import gzip
import json

from sqlalchemy import select

from rusnipez.db.models import Catalog, Section
from rusnipez.services.catalog import catalog_etag, is_truncated, store_catalog
from rusnipez.soc.term import Term
from tests.conftest import course

SPRING = Term.parse("12027")
COURSES = [
    course("01:198:111", "INTRO COMPUTER SCI", ("10001", "01"), ("10002", "02")),
    course("01:355:101", "COLLEGE WRITING", ("10003", "01"), spn=True),
]


async def test_new_catalog_is_stored_for_serving_and_joins(sessions) -> None:
    result = await store_catalog(sessions, SPRING, "NB", COURSES)
    assert (result.status, result.sections) == ("updated", 3)

    async with sessions() as session:
        stored = await session.get(Catalog, ("12027", "NB"))
        sections = list(await session.scalars(select(Section).order_by(Section.index)))
    payload = json.loads(gzip.decompress(stored.payload_gzip))
    assert payload["meta"]["termName"] == "Spring 2027"
    assert payload["meta"]["counts"] == {
        "courses": 2,
        "sections": 3,
        "schools": 1,
        "crossListed": 0,
        "requiresSPN": 1,
    }
    assert [s.index for s in sections] == ["10001", "10002", "10003"]
    assert sections[2].course_title == "COLLEGE WRITING" and sections[2].spn


async def test_unchanged_catalog_keeps_its_etag_and_timestamp(sessions) -> None:
    await store_catalog(sessions, SPRING, "NB", COURSES)
    async with sessions() as session:
        before = await session.get(Catalog, ("12027", "NB"))
    assert (await store_catalog(sessions, SPRING, "NB", COURSES)).status == "unchanged"
    async with sessions() as session:
        after = await session.get(Catalog, ("12027", "NB"))
    assert (after.etag, after.generated_at) == (before.etag, before.generated_at)


async def test_changed_catalog_replaces_sections(sessions) -> None:
    await store_catalog(sessions, SPRING, "NB", COURSES)
    await store_catalog(sessions, SPRING, "NB", COURSES[:1])
    async with sessions() as session:
        indexes = list(await session.scalars(select(Section.index).order_by(Section.index)))
    assert indexes == ["10001", "10002"]


async def test_truncated_rebuild_is_rejected(sessions) -> None:
    big = [course("01:198:111", "INTRO", *[(f"2{n:04d}", "01") for n in range(200)])]
    await store_catalog(sessions, SPRING, "NB", big)
    result = await store_catalog(sessions, SPRING, "NB", COURSES)
    assert result.status == "rejected"
    async with sessions() as session:
        assert (await session.get(Catalog, ("12027", "NB"))).section_count == 200


async def test_campuses_are_stored_separately(sessions) -> None:
    await store_catalog(sessions, SPRING, "NB", COURSES[:1])
    await store_catalog(sessions, SPRING, "NK", COURSES[1:])
    async with sessions() as session:
        campuses = dict((await session.execute(select(Section.index, Section.campus))).all())
    assert campuses == {"10001": "NB", "10002": "NB", "10003": "NK"}


def test_truncation_rule() -> None:
    assert is_truncated(None, 0)
    assert not is_truncated(None, 5)
    assert not is_truncated(50, 1)  # too small to judge
    assert is_truncated(1000, 499)
    assert not is_truncated(1000, 500)


def test_etag_ignores_key_order() -> None:
    assert catalog_etag([{"a": 1, "b": 2}]) == catalog_etag([{"b": 2, "a": 1}])
    assert catalog_etag([{"a": 1}]) != catalog_etag([{"a": 2}])
