"""Upgrade an existing v3 database and retain its historical tracking start."""

import asyncio

from alembic import command
from alembic.config import Config
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from rusnipez.db.session import MIGRATIONS, migrate


def test_tracking_start_backfill_uses_earliest_surviving_evidence(database_url):
    config = Config()
    config.set_main_option("script_location", str(MIGRATIONS))
    config.set_main_option("sqlalchemy.url", database_url.replace("%", "%%"))
    command.downgrade(config, "0003")

    async def seed_legacy():
        engine = create_async_engine(database_url)
        try:
            async with engine.begin() as connection:
                await connection.execute(text("TRUNCATE terms CASCADE"))
                await connection.execute(
                    text("""
                    INSERT INTO terms (code, name) VALUES
                        ('12027', 'Spring'), ('02027', 'Winter'), ('92026', 'Untracked');
                """)
                )
                await connection.execute(
                    text("""
                    INSERT INTO polls (term, started_at, finished_at, status, opened, closed) VALUES
                        ('12027', '2026-10-25Z', '2026-10-25Z', 'ok', 0, 0),
                        ('02027', '2026-10-20Z', '2026-10-20Z', 'error', 0, 0),
                        ('02027', '2026-10-21Z', '2026-10-21Z', 'ok', 0, 0);
                """)
                )
                # Spring's older poll logs have been pruned, but a baseline remains.
                await connection.execute(
                    text("""
                    INSERT INTO openings (term, index, opened_at) VALUES
                        ('12027', '10001', '2026-10-10Z');
                """)
                )
        finally:
            await engine.dispose()

    try:
        asyncio.run(seed_legacy())
    finally:
        migrate(database_url)

    async def read():
        engine = create_async_engine(database_url)
        try:
            async with engine.connect() as connection:
                return dict(
                    (
                        await connection.execute(
                            text("SELECT code, tracking_started_at FROM terms")
                        )
                    ).all()
                )
        finally:
            await engine.dispose()

    starts = asyncio.run(read())
    assert starts["12027"].isoformat() == "2026-10-10T00:00:00+00:00"
    assert starts["02027"].isoformat() == "2026-10-21T00:00:00+00:00"
    assert starts["92026"] is None
