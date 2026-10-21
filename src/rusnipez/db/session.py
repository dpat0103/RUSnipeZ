from __future__ import annotations

from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy.ext.asyncio import AsyncEngine, async_sessionmaker, create_async_engine

MIGRATIONS = Path(__file__).parent / "migrations"


def create_engine(url: str) -> AsyncEngine:
    return create_async_engine(url, pool_pre_ping=True)


def create_sessionmaker(engine: AsyncEngine) -> async_sessionmaker:
    return async_sessionmaker(engine, expire_on_commit=False)


def migrate(url: str, revision: str = "head") -> None:
    """Apply migrations. Synchronous: call it before an event loop starts."""
    config = Config()
    config.set_main_option("script_location", str(MIGRATIONS))
    # ConfigParser treats % as interpolation; passwords may contain it.
    config.set_main_option("sqlalchemy.url", url.replace("%", "%%"))
    command.upgrade(config, revision)
