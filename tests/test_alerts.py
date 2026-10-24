from __future__ import annotations

import asyncio
from datetime import timedelta

from sqlalchemy import select

from rusnipez.db.models import Alert, Identity, User
from rusnipez.services import watches
from rusnipez.services.alerts import AlertJob, Delivery, Dispatcher
from rusnipez.services.poller import TermPoller
from rusnipez.settings import Settings
from rusnipez.soc.term import Term
from tests.conftest import T0, Clock, FakeSoc
from tests.test_watches import add, new_user, seed_sections

SPRING = Term.parse("12027")


class FakeNotifier:
    provider = "discord"

    def __init__(self, *outcomes: Delivery) -> None:
        self.outcomes = list(outcomes)
        self.sent: list[tuple[AlertJob, str]] = []

    async def send(self, job: AlertJob, subject: str) -> Delivery:
        self.sent.append((job, subject))
        return self.outcomes.pop(0) if self.outcomes else Delivery.SENT


async def open_after_baseline(sessions, clock: Clock, *indexes: str) -> None:
    """A first poll with everything closed, then one that opens ``indexes``."""
    poller = TermPoller(sessions, FakeSoc(set(), set(indexes)), SPRING, Settings(), clock=clock)  # type: ignore[arg-type]
    await poller.poll_once()
    clock.advance()
    await poller.poll_once()


async def alerts(sessions) -> list[Alert]:
    async with sessions() as session:
        return list(await session.scalars(select(Alert).order_by(Alert.id)))


async def test_an_opening_queues_one_alert_per_watcher(sessions) -> None:
    await seed_sections(sessions, "10001", "10002")
    first, second = await new_user(sessions, "1001"), await new_user(sessions, "1002")
    await add(sessions, first, "10001")
    await add(sessions, second, "10001")
    await add(sessions, second, "10002")
    await open_after_baseline(sessions, Clock(), "10001")
    assert [(a.watch_id, a.status) for a in await alerts(sessions)] == [
        (1, "pending"),
        (2, "pending"),
    ]


async def test_sections_open_when_tracking_starts_do_not_alert(sessions) -> None:
    await seed_sections(sessions, "10001")
    await add(sessions, await new_user(sessions), "10001")
    poller = TermPoller(sessions, FakeSoc({"10001"}), SPRING, Settings(), clock=Clock())  # type: ignore[arg-type]
    await poller.poll_once()
    assert await alerts(sessions) == []


async def test_snoozed_watches_and_banned_users_are_skipped(sessions) -> None:
    await seed_sections(sessions, "10001")
    snoozer, banned = await new_user(sessions, "1001"), await new_user(sessions, "1002")
    await add(sessions, snoozer, "10001")
    await add(sessions, banned, "10001")
    async with sessions.begin() as session:
        await watches.snooze_watch(session, snoozer.id, 1, T0 + timedelta(hours=1))
        (await session.get_one(User, banned.id)).banned_at = T0
    await open_after_baseline(sessions, Clock(), "10001")
    assert await alerts(sessions) == []


async def queued(sessions, clock: Clock) -> None:
    await seed_sections(sessions, "10001")
    await add(sessions, await new_user(sessions, "1001"), "10001")
    await open_after_baseline(sessions, clock, "10001")


async def test_dispatch_sends_with_section_details(sessions) -> None:
    clock = Clock()
    await queued(sessions, clock)
    notifier = FakeNotifier()
    assert await Dispatcher(sessions, [notifier], clock=clock).run_once() == 1
    [(job, subject)] = notifier.sent
    assert subject == "1001"
    assert (job.index, job.course_code, job.opened_at) == ("10001", "01:198:111", clock.now)
    [alert] = await alerts(sessions)
    assert (alert.status, alert.sent_at, alert.attempts) == ("sent", clock.now, 1)
    # Sent alerts are never claimed again.
    assert await Dispatcher(sessions, [notifier], clock=clock).run_once() == 0


async def test_temporary_failures_back_off_then_give_up(sessions) -> None:
    clock = Clock()
    await queued(sessions, clock)
    dispatcher = Dispatcher(
        sessions, [FakeNotifier(*[Delivery.RETRY] * 3)], max_attempts=3, clock=clock
    )
    assert await dispatcher.run_once() == 1
    [alert] = await alerts(sessions)
    assert (alert.status, alert.next_attempt_at) == ("pending", clock.now + timedelta(seconds=30))
    assert await dispatcher.run_once() == 0  # not due yet
    for _ in range(2):
        clock.advance(600)
        assert await dispatcher.run_once() == 1
    [alert] = await alerts(sessions)
    assert (alert.status, alert.attempts, alert.error) == ("failed", 3, "gave up after retries")


async def test_refused_delivery_is_remembered_and_cleared_on_success(sessions) -> None:
    clock = Clock()
    await queued(sessions, clock)
    await Dispatcher(sessions, [FakeNotifier(Delivery.REFUSED)], clock=clock).run_once()
    async with sessions() as session:
        identity = await session.scalar(select(Identity))
        assert identity.delivery_failed_at == clock.now
    [alert] = await alerts(sessions)
    assert (alert.status, alert.error) == ("failed", "refused")

    clock.advance()
    await open_after_baseline(sessions, clock, "10001")  # closes, then opens again
    await Dispatcher(sessions, [FakeNotifier()], clock=clock).run_once()
    async with sessions() as session:
        assert (await session.scalar(select(Identity))).delivery_failed_at is None


async def test_an_expired_lease_is_claimed_again(sessions) -> None:
    clock = Clock()
    await queued(sessions, clock)
    dispatcher = Dispatcher(sessions, [FakeNotifier()], clock=clock)
    assert len(await dispatcher.claim()) == 1  # claimed, then the process "dies"
    assert await dispatcher.claim() == []
    clock.advance(dispatcher.lease.total_seconds())
    assert len(await dispatcher.claim()) == 1


async def test_notify_wakes_the_running_dispatcher(sessions, database_url) -> None:
    notifier = FakeNotifier()
    dispatcher = Dispatcher(sessions, [notifier])
    task = asyncio.create_task(dispatcher.run(database_url, idle_seconds=60))
    try:
        await asyncio.sleep(0.5)  # listening
        await queued(sessions, Clock(T0 + timedelta(days=3650)))
        for _ in range(50):
            if notifier.sent:
                break
            await asyncio.sleep(0.1)
        assert len(notifier.sent) == 1
    finally:
        task.cancel()
