from __future__ import annotations

import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from rusnipez.db.models import Alert, Identity, Opening, User, Watch
from tests.conftest import T0


async def add_watcher(session, subject: str = "1001") -> tuple[User, Watch, Opening]:
    user = User()
    session.add(user)
    await session.flush()
    session.add(Identity(user_id=user.id, provider="discord", subject=subject))
    watch = Watch(user_id=user.id, term="12027", index="10001")
    opening = Opening(term="12027", index="10001", opened_at=T0)
    session.add_all([watch, opening])
    await session.flush()
    return user, watch, opening


async def test_an_opening_alerts_a_watch_once(sessions) -> None:
    async with sessions.begin() as session:
        _, watch, opening = await add_watcher(session)
        session.add(Alert(watch_id=watch.id, opening_id=opening.id))
    with pytest.raises(IntegrityError):
        async with sessions.begin() as session:
            session.add(Alert(watch_id=watch.id, opening_id=opening.id))


async def test_a_section_is_watched_once_per_user(sessions) -> None:
    async with sessions.begin() as session:
        user, _, _ = await add_watcher(session)
    with pytest.raises(IntegrityError):
        async with sessions.begin() as session:
            session.add(Watch(user_id=user.id, term="12027", index="10001"))


async def test_an_identity_belongs_to_one_user(sessions) -> None:
    async with sessions.begin() as session:
        await add_watcher(session, subject="1001")
    with pytest.raises(IntegrityError):
        async with sessions.begin() as session:
            user = User()
            session.add(user)
            await session.flush()
            session.add(Identity(user_id=user.id, provider="discord", subject="1001"))


async def test_deleting_a_user_deletes_their_data(sessions) -> None:
    async with sessions.begin() as session:
        user, watch, opening = await add_watcher(session)
        session.add(Alert(watch_id=watch.id, opening_id=opening.id, status="sent", sent_at=T0))
    async with sessions.begin() as session:
        await session.delete(await session.get(User, user.id))
    async with sessions() as session:
        for model in (Identity, Watch, Alert):
            assert await session.scalar(select(func.count()).select_from(model)) == 0
        # Seat history is not personal data and stays.
        assert await session.scalar(select(func.count()).select_from(Opening)) == 1
