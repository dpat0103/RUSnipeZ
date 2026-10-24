"""Poll Rutgers' open-section list and record openings and closings."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, insert, select, update
from sqlalchemy.ext.asyncio import async_sessionmaker

from rusnipez.core.detection import ChangeGuard, diff_open_sets, fingerprint
from rusnipez.db.models import Opening, Poll
from rusnipez.services.alerts import queue_alerts
from rusnipez.settings import Settings
from rusnipez.soc.client import SocClient, SocError
from rusnipez.soc.term import Term

log = logging.getLogger(__name__)


def utcnow() -> datetime:
    return datetime.now(UTC)


class TermPoller:
    """Polls one term. One instance per term keeps outage-guard state separate."""

    def __init__(
        self,
        sessions: async_sessionmaker,
        client: SocClient,
        term: Term,
        settings: Settings,
        clock: Callable[[], datetime] = utcnow,
    ) -> None:
        self.sessions = sessions
        self.client = client
        self.term = term
        self.settings = settings
        self.clock = clock
        self.guard = ChangeGuard(
            ratio=settings.change_guard_ratio,
            minimum=settings.change_guard_minimum,
            confirm_after=timedelta(seconds=settings.change_guard_confirm_seconds),
        )

    async def poll_once(self) -> str:
        """Fetch, compare and record one observation. Returns the poll status."""
        started = self.clock()
        try:
            current = await self.client.open_sections(self.term)
        except SocError as error:
            async with self.sessions.begin() as session:
                session.add(
                    Poll(
                        term=self.term.code,
                        started_at=started,
                        finished_at=self.clock(),
                        status="error",
                        error=str(error)[:500],
                    )
                )
            log.warning("poll %s failed: %s", self.term.code, error)
            return "error"

        observed = self.clock()
        async with self.sessions.begin() as session:
            previous = set(
                await session.scalars(
                    select(Opening.index).where(
                        Opening.term == self.term.code, Opening.closed_at.is_(None)
                    )
                )
            )
            changes = diff_open_sets(previous, current)
            snapshot = fingerprint(current)
            if not self.guard.should_apply(len(previous), changes, observed, snapshot):
                session.add(
                    Poll(
                        term=self.term.code,
                        started_at=started,
                        finished_at=observed,
                        status="held",
                        open_count=len(current),
                        opened=len(changes.opened),
                        closed=len(changes.closed),
                    )
                )
                log.warning(
                    "poll %s held: %d opened, %d closed in one poll; %s",
                    self.term.code,
                    len(changes.opened),
                    len(changes.closed),
                    "known stale snapshot"
                    if self.guard.is_known_stale(snapshot)
                    else "waiting to confirm",
                )
                return "held"

            # The previous applied poll bounds when each change happened.
            # NULL means no earlier observation, so opening times are unknown.
            previous_poll = await session.scalar(
                select(func.max(Poll.finished_at)).where(
                    Poll.term == self.term.code, Poll.status == "ok"
                )
            )
            if changes.opened:
                opening_ids = await session.scalars(
                    insert(Opening).returning(Opening.id),
                    [
                        {
                            "term": self.term.code,
                            "index": index,
                            "opened_at": observed,
                            "open_detected_after": previous_poll,
                        }
                        for index in changes.opened
                    ],
                )
                # The first poll's open sections were open before tracking began;
                # they are not openings anyone should be alerted about.
                if previous_poll is not None:
                    await queue_alerts(session, list(opening_ids), observed)
            if changes.closed:
                await session.execute(
                    update(Opening)
                    .where(
                        Opening.term == self.term.code,
                        Opening.index.in_(changes.closed),
                        Opening.closed_at.is_(None),
                    )
                    .values(closed_at=observed, close_detected_after=previous_poll)
                )
            session.add(
                Poll(
                    term=self.term.code,
                    started_at=started,
                    finished_at=observed,
                    status="ok",
                    open_count=len(current),
                    opened=len(changes.opened),
                    closed=len(changes.closed),
                )
            )
        if changes.opened or changes.closed:
            log.info(
                "poll %s: %d opened, %d closed, %d open",
                self.term.code,
                len(changes.opened),
                len(changes.closed),
                len(current),
            )
        return "ok"

    async def run(self) -> None:
        """Poll on a fixed cadence; back off exponentially while upstream fails."""
        loop = asyncio.get_running_loop()
        failures = 0
        while True:
            started = loop.time()
            try:
                status = await self.poll_once()
            except Exception:
                log.exception("poll %s crashed", self.term.code)
                status = "error"
            failures = failures + 1 if status == "error" else 0
            delay = min(
                self.settings.poll_seconds * 2 ** min(failures, 10),
                max(self.settings.poll_seconds, self.settings.max_backoff_seconds),
            )
            await asyncio.sleep(max(0.0, started + delay - loop.time()))
