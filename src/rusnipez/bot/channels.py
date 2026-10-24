"""The server's live channels: #live-openings, #status and #admin-log.

#live-openings gets one message per batch of openings, only for sections
someone is watching, so it stays readable during add/drop. #status is a single
message the bot keeps editing. #admin-log receives the service's warnings and
errors, batched so a burst of failures is one message, not fifty.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from datetime import UTC, datetime
from typing import TYPE_CHECKING

import discord
from sqlalchemy import func, select, text

from rusnipez.bot import embeds
from rusnipez.db.models import Opening

if TYPE_CHECKING:
    from rusnipez.bot.client import SnipeBot

log = logging.getLogger(__name__)

MAX_LINES = 20


async def watched_openings(session, after_id: int) -> list:
    """Openings after ``after_id`` of sections someone watches, with watcher counts."""
    rows = await session.execute(
        text("""
            SELECT o.id, o.term, o.index, s.course_code, s.course_title, s.section_number,
                   count(w.id) AS watchers
              FROM openings o
              JOIN watches w ON w.term = o.term AND w.index = o.index
              LEFT JOIN sections s ON s.term = o.term AND s.index = o.index
             WHERE o.id > :after AND o.open_detected_after IS NOT NULL
             GROUP BY o.id, s.course_code, s.course_title, s.section_number
             ORDER BY o.id
        """),
        {"after": after_id},
    )
    return list(rows)


def openings_message(rows: list) -> str:
    lines = []
    for row in rows[:MAX_LINES]:
        what = (
            f"{row.course_code} {row.course_title} · Sec {row.section_number}"
            if row.course_title
            else "Not listed by Rutgers yet"
        )
        watching = f"{row.watchers} watching"
        lines.append(f"🟢 `{row.index}` {what} · {watching}")
    if len(rows) > MAX_LINES:
        lines.append(f"and {len(rows) - MAX_LINES} more")
    return "\n".join(lines)


class AdminLogHandler(logging.Handler):
    """Queues warnings and errors for #admin-log. Safe to call from any thread."""

    def __init__(self, loop: asyncio.AbstractEventLoop) -> None:
        super().__init__(level=logging.WARNING)
        self.loop = loop
        self.queue: asyncio.Queue[str] = asyncio.Queue(maxsize=200)
        self.setFormatter(logging.Formatter("%(levelname)s %(name)s: %(message)s"))

    def emit(self, record: logging.LogRecord) -> None:
        # Never forward our own failures to post, or one outage loops forever.
        if record.name == __name__ or record.name.startswith("discord"):
            return
        message = self.format(record)
        # RuntimeError: the loop is closed during shutdown.
        with contextlib.suppress(RuntimeError):
            self.loop.call_soon_threadsafe(self._put, message)

    def _put(self, message: str) -> None:
        if not self.queue.full():
            self.queue.put_nowait(message)


class LiveChannels:
    def __init__(self, bot: SnipeBot) -> None:
        self.bot = bot

    def channel(self, name: str) -> discord.TextChannel | None:
        guild = self.bot.get_guild(self.bot.guild.id)
        return guild and discord.utils.get(guild.text_channels, name=name)

    async def run(self) -> None:
        handler = AdminLogHandler(asyncio.get_running_loop())
        logging.getLogger("rusnipez").addHandler(handler)
        try:
            async with asyncio.TaskGroup() as group:
                group.create_task(self._forever(self.post_openings, self.bot.settings.poll_seconds))
                group.create_task(self._forever(self.update_status, 60))
                group.create_task(self.forward_logs(handler))
        finally:
            logging.getLogger("rusnipez").removeHandler(handler)

    async def _forever(self, job, seconds: float) -> None:
        state: dict = {}
        while True:
            try:
                await job(state)
            except Exception:
                log.exception("%s failed", job.__name__)
            await asyncio.sleep(seconds)

    async def post_openings(self, state: dict) -> None:
        async with self.bot.sessions() as session:
            if "after" not in state:
                # Start from now: no backlog of openings from before a restart.
                state["after"] = await session.scalar(select(func.max(Opening.id))) or 0
                return
            rows = await watched_openings(session, state["after"])
        if not rows:
            return
        state["after"] = rows[-1].id
        channel = self.channel("live-openings")
        if channel is not None:
            await channel.send(openings_message(rows))

    async def update_status(self, state: dict) -> None:
        channel = self.channel("status")
        if channel is None:
            return
        embed = embeds.status_embed(await self.bot.stats())
        embed.timestamp = datetime.now(UTC)
        embed.set_footer(text="Updated every minute")
        message = state.get("message")
        if message is None:
            async for found in channel.history(limit=20, oldest_first=True):
                if found.author.id == self.bot.user.id:
                    message = found
                    break
        if message is None:
            state["message"] = await channel.send(embed=embed)
        else:
            state["message"] = await message.edit(embed=embed)

    async def forward_logs(self, handler: AdminLogHandler) -> None:
        while True:
            lines = [await handler.queue.get()]
            await asyncio.sleep(5)  # gather the rest of a burst
            while not handler.queue.empty():
                lines.append(handler.queue.get_nowait())
            channel = self.channel("admin-log")
            if channel is None:
                continue
            body = "\n".join(lines)
            if len(body) > 1900:
                body = body[:1900] + f"\n… {len(lines)} entries, truncated"
            try:
                await channel.send(f"```\n{body}\n```")
            except discord.HTTPException:
                log.warning("could not post to #admin-log")
