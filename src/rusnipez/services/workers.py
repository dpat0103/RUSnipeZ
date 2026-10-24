"""Long-running jobs started with the API: one poller per term, catalog refresh,
pruning and, when configured, the Discord bot."""

from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime, timedelta

from sqlalchemy.ext.asyncio import async_sessionmaker

from rusnipez.services.alerts import drop_orphaned
from rusnipez.services.catalog import count_unlisted_open, ensure_terms, sync_catalog
from rusnipez.services.poller import TermPoller
from rusnipez.services.reports import prune_polls
from rusnipez.services.watches import prune_inactive_watches
from rusnipez.settings import CATALOGS, Settings
from rusnipez.soc.client import SocClient, SocError
from rusnipez.soc.term import Term

log = logging.getLogger(__name__)


async def refresh_catalogs(sessions: async_sessionmaker, terms: list[Term]) -> None:
    async with SocClient() as client:
        for term in terms:
            for campus in CATALOGS:
                try:
                    await sync_catalog(sessions, client, term, campus)
                except SocError as error:
                    log.warning("catalog %s %s failed: %s", term.code, campus, error)
            # A jump here means Rutgers added a location or changed its catalog.
            async with sessions() as session:
                unlisted = await count_unlisted_open(session, term.code)
            log.info("catalog %s: %d open sections are in no catalog", term.code, unlisted)


async def catalog_loop(sessions: async_sessionmaker, terms: list[Term], hours: float) -> None:
    while True:
        try:
            await refresh_catalogs(sessions, terms)
        except Exception:
            log.exception("catalog refresh crashed")
        await asyncio.sleep(hours * 3600)


async def prune_loop(
    sessions: async_sessionmaker, retention_days: int, active_terms: list[str]
) -> None:
    while True:
        try:
            async with sessions.begin() as session:
                removed = await prune_polls(
                    session, datetime.now(UTC) - timedelta(days=retention_days)
                )
                ended = await prune_inactive_watches(session, active_terms)
                await drop_orphaned(session)
            if removed:
                log.info("pruned %d old poll rows", removed)
            if ended:
                log.info("removed %d watches for terms no longer polled", ended)
        except Exception:
            log.exception("poll pruning crashed")
        await asyncio.sleep(3600)


async def run_workers(sessions: async_sessionmaker, settings: Settings) -> None:
    terms = [Term.parse(code) for code in settings.active_terms]
    async with sessions.begin() as session:
        await ensure_terms(session, terms)
    async with (
        SocClient(timeout=settings.poll_timeout_seconds) as client,
        asyncio.TaskGroup() as group,
    ):
        for term in terms:
            group.create_task(TermPoller(sessions, client, term, settings).run())
        group.create_task(catalog_loop(sessions, terms, settings.catalog_refresh_hours))
        group.create_task(
            prune_loop(sessions, settings.poll_log_retention_days, settings.active_terms)
        )
        if settings.discord_token is not None:
            from rusnipez.bot.client import run_bot

            group.create_task(run_bot(sessions, settings))
        else:
            log.info("no Discord token; running without the bot")
