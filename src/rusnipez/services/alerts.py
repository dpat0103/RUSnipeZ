"""Alerts: queued by the poller, delivered by the dispatcher.

The poller calls ``queue_alerts`` inside the transaction that records the
openings, so an opening and its alerts are saved together or not at all. The
same transaction sends ``NOTIFY alerts``; PostgreSQL delivers it on commit,
which wakes the dispatcher without polling.

The dispatcher claims due alerts by pushing ``next_attempt_at`` a lease into
the future and committing, then sends with no transaction open. If the process
dies mid-send, the lease expires and the alert is sent again, so delivery is
at least once; the unique (watch, opening) key keeps it to one alert per
opening.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from enum import Enum
from typing import Protocol

import asyncpg
from sqlalchemy import bindparam, text, update
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from rusnipez.db.models import Alert, Identity

log = logging.getLogger(__name__)

CHANNEL = "alerts"


async def queue_alerts(session: AsyncSession, opening_ids: Sequence[int], now: datetime) -> int:
    """One pending alert per watcher of each opening, skipping snoozed watches
    and banned users. Returns how many were queued."""
    if not opening_ids:
        return 0
    queued = await session.execute(
        text("""
            INSERT INTO alerts (watch_id, opening_id)
            SELECT w.id, o.id
              FROM openings o
              JOIN watches w ON w.term = o.term AND w.index = o.index
              JOIN users u ON u.id = w.user_id
             WHERE o.id IN :ids
               AND u.banned_at IS NULL
               AND (w.snoozed_until IS NULL OR w.snoozed_until <= :now)
            ON CONFLICT DO NOTHING
        """).bindparams(bindparam("ids", expanding=True)),
        {"ids": list(opening_ids), "now": now},
    )
    if queued.rowcount:
        await session.execute(text(f"NOTIFY {CHANNEL}"))
    return queued.rowcount


async def drop_orphaned(session: AsyncSession) -> int:
    """Pending alerts whose watch was removed before they were sent."""
    dropped = await session.execute(
        update(Alert)
        .where(Alert.status == "pending", Alert.watch_id.is_(None))
        .values(status="failed", error="watch removed")
    )
    return dropped.rowcount


@dataclass(frozen=True, slots=True)
class AlertJob:
    """Everything a notifier needs to send one alert."""

    id: int
    watch_id: int
    user_id: int
    attempts: int
    term: str
    index: str
    opened_at: datetime
    # None when Rutgers has not listed the section yet.
    course_code: str | None
    course_title: str | None
    section_number: str | None
    instructors: str | None
    # Needs a special permission number to register.
    spn: bool
    # (provider, subject) for every way to reach the user.
    identities: tuple[tuple[str, str], ...]


class Delivery(Enum):
    SENT = "sent"
    # Temporary trouble (rate limit, outage): try again later.
    RETRY = "retry"
    # This identity cannot receive alerts (closed DMs, deleted account).
    REFUSED = "refused"


class Notifier(Protocol):
    provider: str

    async def send(self, job: AlertJob, subject: str) -> Delivery: ...


def utcnow() -> datetime:
    return datetime.now(UTC)


class Dispatcher:
    def __init__(
        self,
        sessions: async_sessionmaker,
        notifiers: Sequence[Notifier],
        *,
        batch: int = 50,
        concurrency: int = 10,
        lease: timedelta = timedelta(minutes=2),
        max_attempts: int = 6,
        clock: Callable[[], datetime] = utcnow,
    ) -> None:
        self.sessions = sessions
        self.notifiers = {notifier.provider: notifier for notifier in notifiers}
        self.batch = batch
        self.lease = lease
        self.max_attempts = max_attempts
        self.clock = clock
        self._limit = asyncio.Semaphore(concurrency)
        self._wake = asyncio.Event()

    async def claim(self) -> list[AlertJob]:
        """Lease up to one batch of due alerts, oldest watches first."""
        now = self.clock()
        async with self.sessions.begin() as session:
            rows = await session.execute(
                text("""
                    WITH due AS (
                        SELECT a.id
                          FROM alerts a
                          JOIN watches w ON w.id = a.watch_id
                         WHERE a.status = 'pending' AND a.next_attempt_at <= :now
                         ORDER BY w.created_at, a.id
                         LIMIT :batch
                           FOR UPDATE OF a SKIP LOCKED
                    )
                    UPDATE alerts a
                       SET next_attempt_at = :lease_until, attempts = a.attempts + 1
                      FROM due, watches w, openings o
                      LEFT JOIN sections s ON s.term = o.term AND s.index = o.index
                     WHERE a.id = due.id AND w.id = a.watch_id AND o.id = a.opening_id
                 RETURNING a.id, a.watch_id, w.user_id, a.attempts, o.term, o.index,
                           o.opened_at, s.course_code, s.course_title, s.section_number,
                           s.instructors, coalesce(s.spn, false) AS spn, w.created_at
                """),
                {"now": now, "batch": self.batch, "lease_until": now + self.lease},
            )
            claimed = sorted(rows, key=lambda row: (row.created_at, row.id))
            identities: dict[int, list[tuple[str, str]]] = {}
            if claimed:
                found = await session.execute(
                    text(
                        "SELECT user_id, provider, subject FROM identities"
                        " WHERE user_id IN :users ORDER BY id"
                    ).bindparams(bindparam("users", expanding=True)),
                    {"users": list({row.user_id for row in claimed})},
                )
                for user_id, provider, subject in found:
                    identities.setdefault(user_id, []).append((provider, subject))
        return [
            AlertJob(*row[:12], identities=tuple(identities.get(row.user_id, ())))
            for row in claimed
        ]

    async def deliver(self, job: AlertJob) -> None:
        targets = [(p, s) for p, s in job.identities if p in self.notifiers]
        outcomes: list[tuple[str, str, Delivery]] = []
        async with self._limit:
            for provider, subject in targets:
                try:
                    outcome = await self.notifiers[provider].send(job, subject)
                except Exception:
                    log.exception("alert %d via %s crashed", job.id, provider)
                    outcome = Delivery.RETRY
                outcomes.append((provider, subject, outcome))
        await self.record(job, outcomes)

    async def record(self, job: AlertJob, outcomes: list[tuple[str, str, Delivery]]) -> None:
        now = self.clock()
        results = {outcome for _, _, outcome in outcomes}
        if Delivery.SENT in results:
            status, error, retry_at = "sent", None, None
        elif Delivery.RETRY in results and job.attempts < self.max_attempts:
            # 30 s, 1, 2, 4, 8 minutes.
            status, error = "pending", "retrying"
            retry_at = now + timedelta(seconds=15 * 2**job.attempts)
        else:
            status, retry_at = "failed", None
            error = "no reachable identity" if not outcomes else "gave up after retries"
            if results == {Delivery.REFUSED}:
                error = "refused"
        values: dict = {"status": status, "error": error}
        if status == "sent":
            values["sent_at"] = now
        if retry_at is not None:
            values["next_attempt_at"] = retry_at
        async with self.sessions.begin() as session:
            await session.execute(update(Alert).where(Alert.id == job.id).values(**values))
            for provider, subject, outcome in outcomes:
                if outcome is not Delivery.RETRY:
                    await session.execute(
                        update(Identity)
                        .where(Identity.provider == provider, Identity.subject == subject)
                        .values(delivery_failed_at=now if outcome is Delivery.REFUSED else None)
                    )

    async def run_once(self) -> int:
        """Send every alert that is due now. Returns how many were attempted."""
        total = 0
        while jobs := await self.claim():
            await asyncio.gather(*(self.deliver(job) for job in jobs))
            total += len(jobs)
        return total

    def wake(self, *_: object) -> None:
        self._wake.set()

    async def run(self, database_url: str, idle_seconds: float = 15.0) -> None:
        """Send alerts as they are queued. NOTIFY wakes it at once; the idle
        timeout picks up retries and anything queued while disconnected."""
        url = make_url(database_url).set(drivername="postgresql")
        while True:
            try:
                connection = await asyncpg.connect(url.render_as_string(hide_password=False))
                try:
                    await connection.add_listener(CHANNEL, self.wake)
                    await self._serve(idle_seconds)
                finally:
                    await connection.close()
            except Exception:
                log.exception("alert dispatcher crashed; restarting")
                await asyncio.sleep(5)

    async def _serve(self, idle_seconds: float) -> None:
        while True:
            # Cleared before sending, so a NOTIFY that arrives mid-batch is not lost.
            self._wake.clear()
            sent = await self.run_once()
            if sent:
                log.info("dispatched %d alerts", sent)
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(self._wake.wait(), idle_seconds)
