from __future__ import annotations

import gzip
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request, Response
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from rusnipez.api import schemas
from rusnipez.db.models import Catalog
from rusnipez.services import reports
from rusnipez.settings import Settings

router = APIRouter(prefix="/api")

# CDN and browser lifetimes. Live data matches the 30s upstream cadence;
# catalogs change a few times a day at most and are validated by ETag.
LIVE = "public, max-age=10, s-maxage=10"
# Meta carries the last check time behind the site's "checked 12s ago", and is
# small, so the CDN holds it briefly to keep that label close to the truth.
META = "public, max-age=2, s-maxage=4"
HISTORY = "public, max-age=60, s-maxage=60"
CATALOG = "public, max-age=300, s-maxage=3600"


def get_settings(request: Request) -> Settings:
    return request.app.state.settings


async def get_session(request: Request) -> AsyncIterator[AsyncSession]:
    async with request.app.state.sessions() as session:
        yield session


SessionDep = Annotated[AsyncSession, Depends(get_session)]
SettingsDep = Annotated[Settings, Depends(get_settings)]
IndexPath = Annotated[str, Path(pattern=r"^\d{5}$")]


def active_term(term: Annotated[str, Path(pattern=r"^\d{5}$")], request: Request) -> str:
    if term not in request.app.state.settings.active_terms:
        raise HTTPException(404, f"Term {term} is not tracked.")
    return term


TermDep = Annotated[str, Depends(active_term)]


def now() -> datetime:
    return datetime.now(UTC)


@router.get("/health", response_model=schemas.Health)
async def health(session: SessionDep, response: Response) -> dict:
    await session.execute(text("SELECT 1"))
    response.headers["Cache-Control"] = "no-store"
    return {"status": "ok"}


@router.get("/v1/meta", response_model=schemas.Meta)
async def meta(session: SessionDep, settings: SettingsDep, response: Response) -> dict:
    response.headers["Cache-Control"] = META
    return {
        "default_term": settings.active_terms[0],
        "poll_seconds": settings.poll_seconds,
        "terms": await reports.term_overview(session, settings.active_terms),
    }


@router.get("/v1/stats", response_model=schemas.Stats)
async def stats(session: SessionDep, settings: SettingsDep, response: Response) -> dict:
    response.headers["Cache-Control"] = LIVE
    return await reports.service_stats(
        session, settings.active_terms, now(), precise_window=settings.precise_window_seconds
    )


@router.get("/v1/terms/{term}/open", response_model=schemas.OpenSections)
async def open_sections(term: TermDep, session: SessionDep, response: Response) -> dict:
    response.headers["Cache-Control"] = LIVE
    result = await reports.open_set(session, term)
    return {"term": term, "observed_at": result.observed_at, "indexes": result.indexes}


@router.get("/v1/terms/{term}/events", response_model=schemas.Events)
async def events(
    term: TermDep,
    session: SessionDep,
    settings: SettingsDep,
    response: Response,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> dict:
    response.headers["Cache-Control"] = LIVE
    rows = await reports.recent_events(
        session, term, limit=limit, precise_window=settings.precise_window_seconds
    )
    return {"term": term, "events": rows}


@router.get("/v1/terms/{term}/history", response_model=schemas.HistorySummary)
async def history(term: TermDep, session: SessionDep, response: Response) -> dict:
    response.headers["Cache-Control"] = HISTORY
    generated = now()
    return {
        "term": term,
        "generated_at": generated,
        "sections": await reports.history_summary(session, term, generated),
    }


@router.get("/v1/terms/{term}/sections/{index}", response_model=schemas.SectionHistory)
async def section(
    term: TermDep,
    index: IndexPath,
    session: SessionDep,
    settings: SettingsDep,
    response: Response,
) -> dict:
    info = await reports.section_info(session, term, index)
    history = await reports.section_history(
        session, term, index, now(), precise_window=settings.precise_window_seconds
    )
    if info is None and history["last_seen_open_at"] is None:
        raise HTTPException(404, f"Section {index} is not in the {term} catalog.")
    response.headers["Cache-Control"] = HISTORY
    return {
        "term": term,
        "index": index,
        "course_code": info.course_code if info else None,
        "course_title": info.course_title if info else None,
        "section_number": info.section_number if info else None,
        "instructors": info.instructors if info else None,
        "campus": info.campus if info else None,
        **history,
    }


@router.get(
    "/v1/terms/{term}/catalogs/{campus}",
    responses={200: {"content": {"application/json": {}}}, 304: {}},
)
async def catalog(
    term: TermDep,
    campus: Annotated[str, Path(pattern=r"^(NB|NK|CM)$")],
    session: SessionDep,
    request: Request,
) -> Response:
    etag = await session.scalar(
        select(Catalog.etag).where(Catalog.term == term, Catalog.campus == campus)
    )
    if etag is None:
        raise HTTPException(404, f"The {term} {campus} catalog has not been built yet.")
    headers = {"ETag": f'"{etag}"', "Cache-Control": CATALOG, "Vary": "Accept-Encoding"}
    if request.headers.get("if-none-match") == headers["ETag"]:
        return Response(status_code=304, headers=headers)

    payload = await session.scalar(
        select(Catalog.payload_gzip).where(Catalog.term == term, Catalog.campus == campus)
    )
    if "gzip" in request.headers.get("accept-encoding", ""):
        headers["Content-Encoding"] = "gzip"
        return Response(payload, media_type="application/json", headers=headers)
    return Response(gzip.decompress(payload), media_type="application/json", headers=headers)
