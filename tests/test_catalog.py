from __future__ import annotations

import gzip
import json

from sqlalchemy import select

from rusnipez.db.models import Catalog, Opening, Section
from rusnipez.services.catalog import (
    catalog_etag,
    count_unlisted_open,
    is_truncated,
    merge_courses,
    store_catalog,
    sync_catalog,
)
from rusnipez.settings import OFF_CAMPUS, OFF_CAMPUS_LOCATIONS
from rusnipez.soc.term import Term
from tests.conftest import T0, course

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


def test_merge_combines_a_course_listed_at_several_locations() -> None:
    lincroft = course("01:202:308", "ADV CRM JST RES MTHD", ("14603", "B1"))
    mays_landing = course("01:202:308", "ADV CRM JST RES MTHD", ("13250", "A1"), ("14603", "B1"))
    merged = merge_courses(
        [course("50:070:101", "INTRO TO CULT ANTHRO", ("12404", "C1")), lincroft, mays_landing]
    )
    assert [c["code"] for c in merged] == ["01:202:308", "50:070:101"]
    assert [s["index"] for s in merged[0]["sections"]] == ["13250", "14603"]
    # The inputs are left alone.
    assert [s["index"] for s in lincroft["sections"]] == ["14603"]


class FakeCatalogSoc:
    """Raw courses.json per campus code; locations not listed have no classes."""

    def __init__(self, by_campus: dict[str, list[dict]]) -> None:
        self.by_campus = by_campus
        self.requested: list[str] = []

    async def courses(self, term: Term, campus: str, *, allow_empty: bool = False) -> list[dict]:
        self.requested.append(campus)
        return self.by_campus.get(campus, [])


def raw_course(code: str, title: str, index: str, campus: str) -> dict:
    return {
        "courseString": code,
        "title": title,
        "subject": code.split(":")[1],
        "sections": [{"index": index, "number": "01", "campusCode": campus, "instructors": []}],
    }


async def test_off_campus_locations_sync_as_one_catalog(sessions) -> None:
    soc = FakeCatalogSoc(
        {
            "CC": [raw_course("50:202:204", "CRIMINAL COURTS", "26045", "CC")],
            "L": [raw_course("01:202:488", "ADV CRIMINAL JUSTICE SEM", "14611", "L")],
        }
    )
    result = await sync_catalog(sessions, soc, SPRING, OFF_CAMPUS)  # type: ignore[arg-type]
    assert (result.status, result.sections) == ("updated", 2)
    assert soc.requested == list(OFF_CAMPUS_LOCATIONS)
    async with sessions() as session:
        rows = dict((await session.execute(select(Section.index, Section.campus))).all())
    assert rows == {"26045": "OC", "14611": "OC"}


async def test_term_without_off_campus_classes_stores_nothing(sessions) -> None:
    result = await sync_catalog(sessions, FakeCatalogSoc({}), SPRING, OFF_CAMPUS)  # type: ignore[arg-type]
    assert (result.status, result.sections) == ("empty", 0)
    async with sessions() as session:
        assert await session.get(Catalog, ("12027", OFF_CAMPUS)) is None


async def test_unlisted_open_sections_are_counted(sessions) -> None:
    await store_catalog(sessions, SPRING, "NB", COURSES)
    async with sessions.begin() as session:
        session.add_all(
            Opening(term="12027", index=index, opened_at=T0, closed_at=closed)
            for index, closed in [("10001", None), ("26188", None), ("26190", None), ("26191", T0)]
        )
    async with sessions() as session:
        # 10001 is in the catalog and 26191 has closed again.
        assert await count_unlisted_open(session, "12027") == 2
