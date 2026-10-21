"""Read-side queries: open sets, live events, section history and service stats.

Every query takes ``now`` explicitly so results are deterministic under test.
An opening counts as *observed* only when a previous poll saw the section
closed (``open_detected_after IS NOT NULL``); sections already open when
tracking began never count as openings.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import bindparam, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from rusnipez.db.models import Catalog, Opening, Poll, Section, TermRow

OBSERVED = "open_detected_after IS NOT NULL"


def _window(seconds: float) -> str:
    return f"make_interval(secs => {float(seconds)})"


@dataclass(frozen=True, slots=True)
class OpenSet:
    observed_at: datetime | None
    indexes: list[str]


async def open_set(session: AsyncSession, term: str) -> OpenSet:
    indexes = await session.scalars(
        select(Opening.index)
        .where(Opening.term == term, Opening.closed_at.is_(None))
        .order_by(Opening.index)
    )
    observed_at = await session.scalar(
        select(func.max(Poll.finished_at)).where(Poll.term == term, Poll.status == "ok")
    )
    return OpenSet(observed_at, list(indexes))


async def recent_events(
    session: AsyncSession, term: str, *, limit: int, precise_window: float
) -> list[dict]:
    window = _window(precise_window)
    rows = await session.execute(
        text(f"""
            WITH events AS (
                (SELECT 'opened' AS kind, index, opened_at AS at,
                        opened_at - open_detected_after <= {window} AS precise
                   FROM openings
                  WHERE term = :term AND {OBSERVED}
                  ORDER BY opened_at DESC LIMIT :limit)
                UNION ALL
                (SELECT 'closed' AS kind, index, closed_at AS at,
                        closed_at - close_detected_after <= {window} AS precise
                   FROM openings
                  WHERE term = :term AND closed_at IS NOT NULL
                        AND close_detected_after IS NOT NULL
                  ORDER BY closed_at DESC LIMIT :limit)
            )
            SELECT e.kind, e.index, e.at, e.precise, s.campus, s.course_code,
                   s.course_title, s.section_number
              FROM events e
              LEFT JOIN sections s ON s.term = :term AND s.index = e.index
             ORDER BY e.at DESC, e.kind DESC, e.index
             LIMIT :limit
        """),
        {"term": term, "limit": limit},
    )
    return [dict(row._mapping) for row in rows]


async def history_summary(session: AsyncSession, term: str, now: datetime) -> dict[str, dict]:
    """Last time each section was seen open, and observed openings in 7 days.

    Sections open right now with no recent openings are omitted: the open set
    already says everything about them, and there are thousands.
    """
    rows = await session.execute(
        text(f"""
            SELECT index,
                   max(CASE WHEN closed_at IS NULL THEN CAST(:now AS timestamptz)
                            ELSE coalesce(close_detected_after, opened_at) END) AS last_seen_open,
                   count(*) FILTER (WHERE {OBSERVED} AND opened_at >= :week_ago) AS openings_7d
              FROM openings
             WHERE term = :term
             GROUP BY index
            HAVING NOT bool_or(closed_at IS NULL)
                   OR count(*) FILTER (WHERE {OBSERVED} AND opened_at >= :week_ago) > 0
        """),
        {"term": term, "now": now, "week_ago": now - timedelta(days=7)},
    )
    return {
        row.index: {"last_seen_open": row.last_seen_open, "openings_7d": row.openings_7d}
        for row in rows
    }


async def section_history(
    session: AsyncSession, term: str, index: str, now: datetime, *, precise_window: float
) -> dict:
    window = _window(precise_window)
    precise = (
        f"{OBSERVED} AND opened_at - open_detected_after <= {window} "
        f"AND closed_at IS NOT NULL AND close_detected_after IS NOT NULL "
        f"AND closed_at - close_detected_after <= {window}"
    )
    params = {
        "term": term,
        "index": index,
        "now": now,
        "week_ago": now - timedelta(days=7),
        "month_ago": now - timedelta(days=30),
    }
    summary = (
        await session.execute(
            text(f"""
                SELECT max(opened_at) FILTER (WHERE closed_at IS NULL) AS open_since,
                       bool_or(closed_at IS NULL AND {OBSERVED}) AS open_since_known,
                       max(opened_at) FILTER (WHERE {OBSERVED}) AS last_opened_at,
                       max(CASE WHEN closed_at IS NULL THEN CAST(:now AS timestamptz)
                                ELSE coalesce(close_detected_after, opened_at) END)
                           AS last_seen_open_at,
                       count(*) FILTER (WHERE {OBSERVED} AND opened_at >= :week_ago)
                           AS openings_7d,
                       count(*) FILTER (WHERE {OBSERVED} AND opened_at >= :month_ago)
                           AS openings_30d,
                       percentile_cont(0.5) WITHIN GROUP (
                           ORDER BY extract(epoch FROM closed_at - opened_at)
                       ) FILTER (WHERE {precise} AND opened_at >= :month_ago)
                           AS median_open_seconds
                  FROM openings
                 WHERE term = :term AND index = :index
            """),
            params,
        )
    ).one()

    hours = [0] * 24
    for row in await session.execute(
        text(f"""
            SELECT extract(hour FROM opened_at AT TIME ZONE 'America/New_York')::int AS hour,
                   count(*) AS openings
              FROM openings
             WHERE term = :term AND index = :index AND {OBSERVED}
                   AND opened_at - open_detected_after <= {window}
                   AND opened_at >= :month_ago
             GROUP BY hour
        """),
        params,
    ):
        hours[row.hour] = row.openings

    recent = await session.execute(
        text(f"""
            SELECT opened_at, closed_at,
                   coalesce({OBSERVED} AND opened_at - open_detected_after <= {window}, false)
                       AS opened_precise
              FROM openings
             WHERE term = :term AND index = :index
             ORDER BY opened_at DESC
             LIMIT 10
        """),
        params,
    )
    median = summary.median_open_seconds
    return {
        "open_now": summary.open_since is not None,
        "open_since": summary.open_since if summary.open_since_known else None,
        "last_opened_at": summary.last_opened_at,
        "last_seen_open_at": summary.last_seen_open_at,
        "openings_7d": summary.openings_7d,
        "openings_30d": summary.openings_30d,
        "median_open_seconds": round(median) if median is not None else None,
        "openings_by_hour": hours,
        "recent": [dict(row._mapping) for row in recent],
    }


async def section_info(session: AsyncSession, term: str, index: str) -> Section | None:
    return await session.get(Section, (term, index))


async def term_overview(session: AsyncSession, terms: list[str]) -> list[dict]:
    names = dict((await session.execute(select(TermRow.code, TermRow.name))).all())
    catalogs = await session.scalars(
        select(Catalog).where(Catalog.term.in_(terms)).order_by(Catalog.term, Catalog.campus)
    )
    by_term: dict[str, list[dict]] = {term: [] for term in terms}
    for catalog in catalogs:
        by_term[catalog.term].append(
            {
                "campus": catalog.campus,
                "courses": catalog.course_count,
                "sections": catalog.section_count,
                "generated_at": catalog.generated_at,
            }
        )
    last_polls = dict(
        (
            await session.execute(
                select(Poll.term, func.max(Poll.finished_at))
                .where(Poll.term.in_(terms), Poll.status == "ok")
                .group_by(Poll.term)
            )
        ).all()
    )
    open_counts = dict(
        (
            await session.execute(
                select(Opening.term, func.count())
                .where(Opening.term.in_(terms), Opening.closed_at.is_(None))
                .group_by(Opening.term)
            )
        ).all()
    )
    return [
        {
            "code": term,
            "name": names.get(term),
            "catalogs": by_term[term],
            "last_poll_at": last_polls.get(term),
            "open_count": open_counts.get(term, 0),
        }
        for term in terms
    ]


async def service_stats(session: AsyncSession, terms: list[str], now: datetime) -> dict:
    day_ago = now - timedelta(days=1)
    in_terms = bindparam("terms", expanding=True)
    sections_tracked = await session.scalar(
        select(func.count()).select_from(Section).where(Section.term.in_(terms))
    )
    openings = (
        await session.execute(
            text(f"""
                SELECT count(*) FILTER (WHERE closed_at IS NULL) AS open_now,
                       count(*) FILTER (WHERE {OBSERVED} AND opened_at >= :day_ago)
                           AS openings_24h,
                       count(*) FILTER (WHERE {OBSERVED}) AS openings_total
                  FROM openings
                 WHERE term IN :terms
            """).bindparams(in_terms),
            {"terms": terms, "day_ago": day_ago},
        )
    ).one()
    # Uptime is the share of minutes in the last day (or since tracking began)
    # with at least one successful poll, averaged over terms.
    coverage = await session.execute(
        text("""
            SELECT term,
                   count(DISTINCT date_trunc('minute', finished_at))
                       FILTER (WHERE status <> 'error' AND finished_at >= :day_ago) AS covered,
                   min(finished_at) AS first_poll
              FROM polls
             WHERE term IN :terms
             GROUP BY term
        """).bindparams(in_terms),
        {"terms": terms, "day_ago": day_ago},
    )
    ratios = []
    for row in coverage:
        start = max(row.first_poll, day_ago)
        minutes = max(1, int((now - start).total_seconds() // 60) + 1)
        ratios.append(min(1.0, row.covered / minutes))
    last_poll_at = await session.scalar(
        select(func.max(Poll.finished_at)).where(Poll.term.in_(terms), Poll.status == "ok")
    )
    return {
        "sections_tracked": sections_tracked or 0,
        "open_now": openings.open_now,
        "openings_24h": openings.openings_24h,
        "openings_total": openings.openings_total,
        "uptime_24h": round(sum(ratios) / len(ratios), 4) if ratios else None,
        "last_poll_at": last_poll_at,
    }


async def prune_polls(session: AsyncSession, before: datetime) -> int:
    """Delete old poll rows, keeping each term's latest successful poll."""
    result = await session.execute(
        text("""
            DELETE FROM polls p
             WHERE p.finished_at < :before
               AND p.id <> coalesce((SELECT max(id) FROM polls
                                      WHERE term = p.term AND status = 'ok'), -1)
        """),
        {"before": before},
    )
    return result.rowcount
