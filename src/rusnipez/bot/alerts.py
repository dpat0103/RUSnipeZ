"""Alert delivery over Discord, and the buttons on each alert.

Alerts go by DM. When someone's DMs are closed, they go to a private thread in
#bot-commands that only that person and the bot can see, created once and
reused. The buttons are ``DynamicItem``s: their custom IDs carry the watch and
alert, so they keep working after the bot restarts.
"""

from __future__ import annotations

import logging
import re
from datetime import UTC, datetime, timedelta

import discord
from sqlalchemy import select, update

from rusnipez.bot import embeds
from rusnipez.db.models import Identity
from rusnipez.services import watches
from rusnipez.services.alerts import AlertJob, Delivery

log = logging.getLogger(__name__)

SNOOZE = timedelta(hours=1)
FALLBACK_CHANNEL = "bot-commands"

NOTES = {
    "snoozed": "Snoozed. No alerts for this section for 1 hour.",
    "stopped": "Stopped watching this section.",
    "got_in": "Nice! Removed it from your list.",
    "gone": "This section is no longer on your list.",
}


class AlertButton(
    discord.ui.DynamicItem[discord.ui.Button],
    template=r"alert:(?P<action>snoozed|stopped|got_in):(?P<watch>\d+):(?P<alert>\d+)",
):
    LABELS = {"snoozed": "Snooze 1h", "stopped": "Stop watching", "got_in": "I got in"}

    def __init__(self, action: str, watch_id: int, alert_id: int) -> None:
        super().__init__(
            discord.ui.Button(
                label=self.LABELS[action],
                style=discord.ButtonStyle.success
                if action == "got_in"
                else discord.ButtonStyle.secondary,
                custom_id=f"alert:{action}:{watch_id}:{alert_id}",
            )
        )
        self.action = action
        self.watch_id = watch_id
        self.alert_id = alert_id

    @classmethod
    async def from_custom_id(
        cls, interaction: discord.Interaction, item: discord.ui.Button, match: re.Match[str]
    ) -> AlertButton:
        return cls(match["action"], int(match["watch"]), int(match["alert"]))

    async def callback(self, interaction: discord.Interaction) -> None:
        bot = interaction.client
        now = datetime.now(UTC)
        async with bot.sessions.begin() as session:
            user = await watches.user_for(session, "discord", str(interaction.user.id))
            if self.action == "snoozed":
                done = await watches.snooze_watch(session, user.id, self.watch_id, now + SNOOZE)
            else:
                done = await watches.remove_watch_by_id(session, user.id, self.watch_id)
            if done:
                await watches.record_action(session, self.alert_id, self.action, now)
        note = NOTES[self.action] if done else NOTES["gone"]
        # Keep Register; the answered actions go away.
        view = discord.ui.View.from_message(interaction.message, timeout=None)
        for item in list(view.children):
            if not (isinstance(item, discord.ui.Button) and item.url):
                view.remove_item(item)
        await interaction.response.edit_message(content=note, view=view)


def alert_view(job: AlertJob) -> discord.ui.View:
    view = discord.ui.View(timeout=None)
    view.add_item(embeds.register_button(job.term, job.index))
    for action in ("snoozed", "stopped", "got_in"):
        view.add_item(AlertButton(action, job.watch_id, job.id))
    return view


class DiscordNotifier:
    provider = "discord"

    def __init__(self, bot: discord.Client) -> None:
        self.bot = bot

    async def send(self, job: AlertJob, subject: str) -> Delivery:
        try:
            user = self.bot.get_user(int(subject)) or await self.bot.fetch_user(int(subject))
        except discord.NotFound:
            return Delivery.REFUSED
        except discord.HTTPException:
            return Delivery.RETRY
        embed, view = embeds.alert_embed(job), alert_view(job)
        try:
            await user.send(embed=embed, view=view)
            return Delivery.SENT
        except discord.Forbidden:
            pass  # DMs closed: use the private thread.
        except discord.HTTPException:
            return Delivery.RETRY
        try:
            thread = await self._fallback_thread(user)
            if thread is None:
                return Delivery.REFUSED
            await thread.send(content=user.mention, embed=embed, view=view)
            return Delivery.SENT
        except discord.Forbidden:
            return Delivery.REFUSED
        except discord.HTTPException:
            return Delivery.RETRY

    async def _fallback_thread(self, user: discord.User) -> discord.Thread | None:
        async with self.bot.sessions() as session:
            channel_id = await session.scalar(
                select(Identity.fallback_channel_id).where(
                    Identity.provider == "discord", Identity.subject == str(user.id)
                )
            )
        if channel_id is not None:
            try:
                thread = self.bot.get_channel(channel_id) or await self.bot.fetch_channel(
                    channel_id
                )
                if isinstance(thread, discord.Thread):
                    if thread.archived:
                        await thread.edit(archived=False)
                    return thread
            except discord.NotFound:
                pass
        guild = self.bot.get_guild(self.bot.guild.id)
        parent = guild and discord.utils.get(guild.text_channels, name=FALLBACK_CHANNEL)
        if parent is None:
            log.warning("no #%s channel for alert threads", FALLBACK_CHANNEL)
            return None
        thread = await parent.create_thread(
            name=f"alerts · {user.name}",
            type=discord.ChannelType.private_thread,
            invitable=False,
            auto_archive_duration=10080,
        )
        await thread.add_user(user)
        await thread.send(
            "Your DMs from this server are closed, so your alerts come here instead. "
            "Only you and the bot can see this thread."
        )
        async with self.bot.sessions.begin() as session:
            await session.execute(
                update(Identity)
                .where(Identity.provider == "discord", Identity.subject == str(user.id))
                .values(fallback_channel_id=thread.id)
            )
        return thread
