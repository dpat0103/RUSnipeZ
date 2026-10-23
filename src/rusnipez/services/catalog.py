"""Keep each term's catalog current in the database.

The catalog is stored twice on purpose: as one gzipped JSON document that the
website downloads unchanged, and as one row per section for joins (event
titles, index validation).
"""

from __future__ import annotations

import gzip
import hashlib
import json
import logging
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from rusnipez.catalog.build import build_payload
from rusnipez.db.models import Catalog, Opening, Section, TermRow
from rusnipez.settings import OFF_CAMPUS, OFF_CAMPUS_LOCATIONS
from rusnipez.soc.client import SocClient
from rusnipez.soc.normalize import normalize_catalog
from rusnipez.soc.term import Term

log = logging.getLogger(__name__)

# A rebuild with fewer than this fraction of the stored sections is treated as
# a truncated upstream response and rejected.
MIN_RETAINED_FRACTION = 0.5
MIN_SECTIONS_FOR_CHECK = 100


@dataclass(frozen=True, slots=True)
class SyncResult:
    status: str  # updated | unchanged | rejected | empty
    sections: int


async def ensure_terms(session: AsyncSession, terms: list[Term]) -> None:
    for term in terms:
        await session.execute(
            insert(TermRow)
            .values(code=term.code, name=str(term))
            .on_conflict_do_update(index_elements=[TermRow.code], set_={"name": str(term)})
        )


def catalog_etag(courses: list[dict]) -> str:
    """Content hash of the courses, so an unchanged catalog keeps its ETag."""
    encoded = json.dumps(courses, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(encoded).hexdigest()[:32]


def is_truncated(previous_sections: int | None, sections: int) -> bool:
    if sections == 0:
        return True
    if previous_sections is None or previous_sections < MIN_SECTIONS_FOR_CHECK:
        return False
    return sections < previous_sections * MIN_RETAINED_FRACTION


async def store_catalog(
    sessions: async_sessionmaker, term: Term, campus: str, courses: list[dict]
) -> SyncResult:
    payload = build_payload(courses, term, campus)
    counts = payload["meta"]["counts"]
    etag = catalog_etag(courses)

    async with sessions.begin() as session:
        await ensure_terms(session, [term])
        previous = await session.get(Catalog, (term.code, campus))
        if previous is not None and previous.etag == etag:
            return SyncResult("unchanged", counts["sections"])
        if is_truncated(previous.section_count if previous else None, counts["sections"]):
            log.warning(
                "rejected %s %s catalog: %d sections (stored: %s)",
                term.code,
                campus,
                counts["sections"],
                previous.section_count if previous else None,
            )
            return SyncResult("rejected", counts["sections"])

        body = json.dumps(payload, separators=(",", ":")).encode()
        values = {
            "generated_at": datetime.fromisoformat(payload["meta"]["generated"]),
            "etag": etag,
            "course_count": counts["courses"],
            "section_count": counts["sections"],
            "payload_gzip": gzip.compress(body, compresslevel=9),
        }
        await session.execute(
            insert(Catalog)
            .values(term=term.code, campus=campus, **values)
            .on_conflict_do_update(index_elements=[Catalog.term, Catalog.campus], set_=values)
        )

        # Keyed by index so a duplicated index cannot hit the same row twice in one upsert.
        rows = {
            section["index"]: {
                "term": term.code,
                "index": section["index"],
                "campus": campus,
                "course_code": course["code"],
                "course_title": course["title"],
                "section_number": section["number"],
                "instructors": ", ".join(section["instructors"]),
                "spn": section["spn"],
            }
            for course in courses
            for section in course["sections"]
        }
        await session.execute(
            delete(Section).where(Section.term == term.code, Section.campus == campus)
        )
        if rows:
            statement = insert(Section)
            await session.execute(
                statement.on_conflict_do_update(
                    index_elements=[Section.term, Section.index],
                    set_={
                        column: statement.excluded[column]
                        for column in (
                            "campus",
                            "course_code",
                            "course_title",
                            "section_number",
                            "instructors",
                            "spn",
                        )
                    },
                ),
                list(rows.values()),
            )
    return SyncResult("updated", counts["sections"])


def merge_courses(courses: list[dict]) -> list[dict]:
    """Combine one course listed at several locations into a single entry."""
    merged: dict[str, dict] = {}
    for course in courses:
        if course["code"] not in merged:
            merged[course["code"]] = {**course, "sections": list(course["sections"])}
            continue
        sections = merged[course["code"]]["sections"]
        seen = {section["index"] for section in sections}
        sections.extend(s for s in course["sections"] if s["index"] not in seen)
    for course in merged.values():
        course["sections"].sort(key=lambda s: (s["number"], s["index"]))
    return sorted(merged.values(), key=lambda c: c["code"])


async def fetch_courses(client: SocClient, term: Term, campus: str) -> list[dict]:
    """Normalized courses for a campus, or for every off-campus location together."""
    if campus != OFF_CAMPUS:
        return normalize_catalog(await client.courses(term, campus))
    raw = []
    for location in OFF_CAMPUS_LOCATIONS:
        raw.extend(await client.courses(term, location, allow_empty=True))
    return merge_courses(normalize_catalog(raw))


async def count_unlisted_open(session: AsyncSession, term: str) -> int:
    """Open sections that no catalog names: new, unpublished, or at an unknown location."""
    return await session.scalar(
        select(func.count())
        .select_from(Opening)
        .outerjoin(Section, (Section.term == Opening.term) & (Section.index == Opening.index))
        .where(Opening.term == term, Opening.closed_at.is_(None), Section.index.is_(None))
    )


async def sync_catalog(
    sessions: async_sessionmaker, client: SocClient, term: Term, campus: str
) -> SyncResult:
    courses = await fetch_courses(client, term, campus)
    if not courses:
        # Only off-campus can be empty; the main campuses raise instead.
        log.info("catalog %s %s: no classes this term", term.code, campus)
        return SyncResult("empty", 0)
    result = await store_catalog(sessions, term, campus, courses)
    log.info("catalog %s %s: %s (%d sections)", term.code, campus, result.status, result.sections)
    return result
