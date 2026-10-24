"""Runtime configuration. Every value can be set by an environment variable
prefixed with ``RUSNIPEZ_`` (for example ``RUSNIPEZ_ACTIVE_TERMS=12027,02027``)."""

from __future__ import annotations

from functools import lru_cache
from typing import Annotated

from pydantic import SecretStr, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

from rusnipez.soc.term import Term

CAMPUSES = ("NB", "NK", "CM")

# Rutgers also teaches at partner colleges and bases. Each is its own campus
# code in courses.json, while openSections.json covers them all, so without
# these their sections open and close with no name. The list is the Schedule
# of Classes' own (classes.rutgers.edu/soc/js/soc_utils.js, campus type 3).
# Most terms use only a few, so they are synced together as one catalog.
OFF_CAMPUS = "OC"
OFF_CAMPUS_LOCATIONS = {
    "B": "Burlington County Community College - Mt Laurel",
    "CC": "Camden County College - Blackwood Campus",
    "H": "County College of Morris",
    "CU": "Cumberland County College",
    "MC": "Denville - RU-Morris",
    "WM": "Freehold WMHEC - RU-BCC",
    "L": "Lincroft - RU-BCC",
    "AC": "Mays Landing - RU-ACCC",
    "J": "McGuire-Dix-Lakehurst RU-JBMDL",
    "D": "Mercer County Community College",
    "RV": "North Branch - RU-RVCC",
}

# Every catalog the service keeps per term.
CATALOGS = (*CAMPUSES, OFF_CAMPUS)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="RUSNIPEZ_", env_file=".env", extra="ignore")

    database_url: str = "postgresql+asyncpg://rusnipez:rusnipez@127.0.0.1:5432/rusnipez"

    # Terms to poll, most important first. The first one is the website's default.
    # Changing terms is this one setting; nothing else is hardcoded.
    active_terms: Annotated[list[str], NoDecode] = ["12027", "02027"]

    # Rutgers declares Cache-Control: max-age=30 on openSections.json, so polling
    # faster cannot return fresher data.
    poll_seconds: float = 30.0
    poll_timeout_seconds: float = 10.0
    max_backoff_seconds: float = 300.0

    # A poll that changes at least max(minimum, ratio x open sections) is held
    # until the change has lasted confirm_seconds. Rutgers occasionally serves a
    # stale snapshot for about a minute; this stops it from faking mass
    # closings, then mass openings and alerts on recovery.
    change_guard_ratio: float = 0.02
    change_guard_minimum: int = 50
    change_guard_confirm_seconds: float = 120.0

    # Per user per term. Generous for a full course load, small enough that
    # nobody hoards popular sections.
    watch_limit: int = 15

    # Discord. Without a token the service runs without the bot. The bot works
    # in one server only: it registers commands there and leaves any other.
    discord_token: SecretStr | None = None
    discord_guild_id: int | None = None
    discord_application_id: int | None = None
    discord_owner_ids: Annotated[list[int], NoDecode] = []
    # Brand-new accounts are the cheap way around the watch limit.
    discord_min_account_age_days: int = 7

    catalog_refresh_hours: float = 6.0
    poll_log_retention_days: int = 14

    # Start the poller and catalog jobs with the API. Tests turn this off.
    run_workers: bool = True

    @field_validator("active_terms", mode="before")
    @classmethod
    def _split_terms(cls, value: object) -> object:
        if isinstance(value, str):
            value = [part.strip() for part in value.split(",") if part.strip()]
        return value

    @field_validator("discord_owner_ids", mode="before")
    @classmethod
    def _split_owner_ids(cls, value: object) -> object:
        if isinstance(value, str):
            value = [part.strip() for part in value.split(",") if part.strip()]
        return value

    # Compose passes unset variables as empty strings.
    @field_validator("discord_token", "discord_guild_id", "discord_application_id", mode="before")
    @classmethod
    def _empty_is_unset(cls, value: object) -> object:
        return None if value == "" else value

    @field_validator("active_terms")
    @classmethod
    def _validate_terms(cls, value: list[str]) -> list[str]:
        if not value:
            raise ValueError("at least one active term is required")
        if len(set(value)) != len(value):
            raise ValueError("active terms must be unique")
        for code in value:
            Term.parse(code)
        return value

    @property
    def precise_window_seconds(self) -> float:
        """Openings detected within this gap after the previous poll have exact timing."""
        return self.poll_seconds * 3


@lru_cache
def get_settings() -> Settings:
    return Settings()
