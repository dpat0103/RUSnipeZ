"""Owner-only /admin commands. Hidden from members by default permissions and
checked against RUSNIPEZ_DISCORD_OWNER_IDS on every use."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING

import discord
from discord import app_commands
from sqlalchemy import func, select, text

from rusnipez.bot import embeds
from rusnipez.bot.layout import apply_layout
from rusnipez.db.models import User, Watch
from rusnipez.services import reports, watches

if TYPE_CHECKING:
    from rusnipez.bot.client import SnipeBot


def register(bot: SnipeBot) -> None:
    owners = set(bot.settings.discord_owner_ids)

    async def owner_only(interaction: discord.Interaction) -> bool:
        if interaction.user.id in owners:
            return True
        await interaction.response.send_message("Owner only.", ephemeral=True)
        return False

    group = app_commands.Group(
        name="admin",
        description="Owner tools.",
        guild_ids=[bot.guild.id],
        default_permissions=discord.Permissions(administrator=True),
    )
    group.interaction_check = owner_only

    @group.command(name="stats", description="Users, watches and alert delivery.")
    async def stats(interaction: discord.Interaction) -> None:
        now = datetime.now(UTC)
        async with bot.sessions() as session:
            alerts = await reports.alert_stats(session, bot.settings.active_terms, now)
            users = await session.scalar(select(func.count()).select_from(User))
            watching = await session.scalar(select(func.count(func.distinct(Watch.user_id))))
            watch_count = await session.scalar(select(func.count()).select_from(Watch))
            failures = (
                await session.execute(
                    text("""
                        SELECT count(*) FILTER (WHERE status = 'failed') AS failed,
                               count(*) FILTER (WHERE status = 'pending') AS pending
                          FROM alerts WHERE created_at >= :day_ago
                    """),
                    {"day_ago": now - timedelta(days=1)},
                )
            ).one()
        speed = alerts["median_alert_seconds_7d"]
        embed = discord.Embed(title="RU SnipeZ admin stats", colour=embeds.INFO)
        embed.add_field(name="Users", value=f"{users:,} ({watching:,} watching)")
        embed.add_field(name="Watches", value=f"{watch_count:,}")
        embed.add_field(
            name="Alerts sent",
            value=f"{alerts['alerts_sent_24h']:,} today · {alerts['alerts_sent_total']:,} total",
        )
        embed.add_field(name="Check to DM", value="—" if speed is None else f"{speed:.1f} s")
        embed.add_field(name="Got in", value=f"{alerts['got_in_total']:,}")
        embed.add_field(
            name="Last 24 hours", value=f"{failures.failed} failed · {failures.pending} pending"
        )
        await interaction.response.send_message(embed=embed, ephemeral=True)

    async def set_ban(interaction: discord.Interaction, member: discord.User, ban: bool) -> None:
        async with bot.sessions.begin() as session:
            user = await watches.user_for(session, "discord", str(member.id))
            user.banned_at = datetime.now(UTC) if ban else None
        verb = "Banned" if ban else "Unbanned"
        await interaction.response.send_message(
            f"{verb} {member.mention}. "
            + ("They cannot add watches or get alerts." if ban else "They can use the bot again."),
            ephemeral=True,
        )

    @group.command(name="ban", description="Stop someone from adding watches or getting alerts.")
    async def ban(interaction: discord.Interaction, member: discord.User) -> None:
        await set_ban(interaction, member, True)

    @group.command(name="unban", description="Let someone use the bot again.")
    async def unban(interaction: discord.Interaction, member: discord.User) -> None:
        await set_ban(interaction, member, False)

    @group.command(name="setup", description="Create or repair the server's channels.")
    async def setup(interaction: discord.Interaction) -> None:
        await interaction.response.defer(ephemeral=True, thinking=True)
        changes = await apply_layout(bot, bot.guild.id, bot.settings.watch_limit)
        await interaction.followup.send(
            "\n".join(changes) if changes else "The server already matches the layout.",
            ephemeral=True,
        )

    bot.tree.add_command(group)
