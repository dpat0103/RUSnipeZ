"""Shared fixtures. Database tests run against a real PostgreSQL database
(``docker compose up -d db`` creates ``rusnipez_test``). Locally they are
skipped when it is unreachable; CI sets RUSNIPEZ_REQUIRE_DB=1 to fail instead."""

from __future__ import annotations

import asyncio
import os
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from rusnipez.db.session import create_engine, create_sessionmaker, migrate
from rusnipez.services.catalog import ensure_terms
from rusnipez.soc.client import SocError
from rusnipez.soc.term import Term

TEST_DATABASE_URL = os.environ.get(
    "RUSNIPEZ_TEST_DATABASE_URL",
    "postgresql+asyncpg://rusnipez:rusnipez@127.0.0.1:5432/rusnipez_test",
)
TERMS = ["12027", "02027"]
T0 = datetime(2026, 11, 16, 14, 0, tzinfo=UTC)  # 9:00 AM Eastern


async def _reset_schema() -> None:
    engine = create_async_engine(TEST_DATABASE_URL)
    try:
        async with engine.begin() as connection:
            await connection.execute(text("DROP SCHEMA public CASCADE"))
            await connection.execute(text("CREATE SCHEMA public"))
    finally:
        await engine.dispose()


@pytest.fixture(scope="session")
def database_url() -> str:
    try:
        asyncio.run(_reset_schema())
    except (OSError, ConnectionError) as error:
        if os.environ.get("RUSNIPEZ_REQUIRE_DB"):
            raise
        pytest.skip(f"test database unavailable ({error}); run `docker compose up -d db`")
    migrate(TEST_DATABASE_URL)
    return TEST_DATABASE_URL


@pytest.fixture
async def sessions(database_url: str) -> AsyncIterator[async_sessionmaker]:
    engine = create_engine(database_url)
    async with engine.begin() as connection:
        await connection.execute(
            text(
                "TRUNCATE terms, catalogs, sections, openings, polls, users"
                " RESTART IDENTITY CASCADE"
            )
        )
    factory = create_sessionmaker(engine)
    async with factory.begin() as session:
        await ensure_terms(session, [Term.parse(code) for code in TERMS])
    yield factory
    await engine.dispose()


class FakeSoc:
    """Stands in for SocClient: returns queued open sets or raises queued errors."""

    def __init__(self, *responses: set[str] | Exception) -> None:
        self.responses = list(responses)

    def queue(self, *responses: set[str] | Exception) -> None:
        self.responses.extend(responses)

    async def open_sections(self, term: Term) -> set[str]:
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return set(response)


class Clock:
    """Deterministic clock that advances by one poll interval per call pair."""

    def __init__(self, start: datetime = T0) -> None:
        self.now = start

    def __call__(self) -> datetime:
        return self.now

    def advance(self, seconds: float = 30) -> None:
        self.now += timedelta(seconds=seconds)


def upstream_error() -> SocError:
    return SocError("openSections.json returned HTTP 503")


def course(code: str, title: str, *sections: tuple[str, str], spn: bool = False) -> dict:
    """A normalized course with (index, section number) pairs."""
    return {
        "code": code,
        "title": title,
        "subject": code.split(":")[1],
        "subjectName": "Test Subject",
        "school": "School of Arts and Sciences",
        "schoolCode": "01",
        "credits": 3,
        "creditsText": "3.0 credits",
        "level": "U",
        "core": [],
        "synopsis": None,
        "prereqs": None,
        "sections": [
            {
                "index": index,
                "number": number,
                "instructors": ["DOE, JANE"],
                "meets": [],
                "exam": None,
                "spn": spn,
                "crossListed": [],
                "subtitle": None,
                "campus": "NB",
            }
            for index, number in sections
        ],
    }
