"""Response models. Fields are snake_case in Python and camelCase in JSON."""

from __future__ import annotations

import re
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


def camel(name: str) -> str:
    """``openings_7d`` becomes ``openings7d``, not pydantic's ``openings7D``."""
    return re.sub(r"(\d)([A-Z])", lambda m: m[1] + m[2].lower(), to_camel(name))


class Model(BaseModel):
    model_config = ConfigDict(alias_generator=camel, populate_by_name=True)


class CatalogInfo(Model):
    campus: str
    courses: int
    sections: int
    generated_at: datetime


class TermInfo(Model):
    code: str
    name: str | None
    catalogs: list[CatalogInfo]
    last_poll_at: datetime | None
    open_count: int


class Meta(Model):
    default_term: str
    poll_seconds: float
    terms: list[TermInfo]


class OpenSections(Model):
    term: str
    observed_at: datetime | None
    indexes: list[str]


class Event(Model):
    kind: Literal["opened", "closed"]
    index: str
    at: datetime
    precise: bool
    campus: str | None
    course_code: str | None
    course_title: str | None
    section_number: str | None


class Events(Model):
    term: str
    events: list[Event]


class SectionSeen(Model):
    last_seen_open: datetime
    openings_7d: int


class HistorySummary(Model):
    term: str
    generated_at: datetime
    sections: dict[str, SectionSeen]


class PastOpening(Model):
    opened_at: datetime
    closed_at: datetime | None
    opened_precise: bool


class SectionHistory(Model):
    term: str
    index: str
    course_code: str | None
    course_title: str | None
    section_number: str | None
    instructors: str | None
    campus: str | None
    open_now: bool
    open_since: datetime | None
    last_opened_at: datetime | None
    last_seen_open_at: datetime | None
    openings_7d: int
    openings_30d: int
    median_open_seconds: int | None
    openings_by_hour: list[int] = Field(min_length=24, max_length=24)
    recent: list[PastOpening]


class Stats(Model):
    sections_tracked: int
    open_now: int
    openings_24h: int
    openings_total: int
    median_open_seconds_7d: int | None
    checks_24h: int
    uptime_24h: float | None
    last_poll_at: datetime | None
    tracking_since: datetime | None


class Health(Model):
    status: Literal["ok"]
