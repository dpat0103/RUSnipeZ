"""The bot's connection to Discord, its commands and its one-server guard."""

from __future__ import annotations

import logging
from datetime import UTC, datetime

import discord
from discord import app_commands
from sqlalchemy.ext.asyncio import async_sessionmaker

from rusnipez.bot import embeds
from rusnipez.services import reports
from rusnipez.settings import Settings

log = logging.getLogger(__name__)


def guilds_to_leave(guild_ids: list[int], allowed: int) -> list[int]:
    return [guild_id for guild_id in guild_ids if guild_id != allowed]


class SnipeBot(discord.Client):
    def __init__(self, sessions: async_sessionmaker, settings: Settings) -> None:
        if settings.discord_guild_id is None:
            raise ValueError("RUSNIPEZ_DISCORD_GUILD_ID is required to run the bot")
        # Slash commands and DMs need no privileged intents; guilds is for the guard.
        intents = discord.Intents.none()
        intents.guilds = True
        super().__init__(
            intents=intents,
            application_id=settings.discord_application_id,
            # Alerts and replies never ping roles or everyone.
            allowed_mentions=discord.AllowedMentions.none(),
        )
        self.sessions = sessions
        self.settings = settings
        self.guild = discord.Object(id=settings.discord_guild_id)
        self.tree = app_commands.CommandTree(self)
        self.tree.interaction_check = self._in_our_server
        self._register()

    async def _in_our_server(self, interaction: discord.Interaction) -> bool:
        # None is a DM: alert buttons live there.
        return interaction.guild_id in (None, self.guild.id)

    def _register(self) -> None:
        @self.tree.command(name="help", description="Every RU SnipeZ command.", guild=self.guild)
        async def help_(interaction: discord.Interaction) -> None:
            await interaction.response.send_message(embed=embeds.help_embed(), ephemeral=True)

        @self.tree.command(
            name="status",
            description="When Rutgers was last checked, and uptime.",
            guild=self.guild,
        )
        async def status(interaction: discord.Interaction) -> None:
            await interaction.response.send_message(
                embed=embeds.status_embed(await self.stats()), ephemeral=True
            )

    async def stats(self) -> dict | None:
        try:
            async with self.sessions() as session:
                return await reports.service_stats(
                    session,
                    self.settings.active_terms,
                    datetime.now(UTC),
                    precise_window=self.settings.precise_window_seconds,
                )
        except Exception:
            log.exception("stats for Discord failed")
            return None

    async def setup_hook(self) -> None:
        # Commands exist only in our server; clearing global ones removes any
        # registered by mistake, so nothing shows up anywhere else.
        self.tree.clear_commands(guild=None)
        await self.tree.sync()
        await self._sync_commands()

    async def _sync_commands(self) -> None:
        try:
            synced = await self.tree.sync(guild=self.guild)
        except discord.Forbidden:
            log.warning(
                "the bot is not in server %d yet; add it with `rusnipez discord-invite`",
                self.guild.id,
            )
            return
        log.info("synced %d commands to server %d", len(synced), self.guild.id)

    async def on_ready(self) -> None:
        log.info("Discord connected as %s", self.user)
        for guild_id in guilds_to_leave([g.id for g in self.guilds], self.guild.id):
            await self._leave(guild_id)

    async def on_guild_join(self, guild: discord.Guild) -> None:
        if guild.id != self.guild.id:
            await self._leave(guild.id)
        else:
            await self._sync_commands()

    async def _leave(self, guild_id: int) -> None:
        guild = self.get_guild(guild_id)
        if guild is not None:
            log.warning("leaving server %s (%d): not the configured server", guild.name, guild_id)
            await guild.leave()


async def run_bot(sessions: async_sessionmaker, settings: Settings) -> None:
    bot = SnipeBot(sessions, settings)
    async with bot:
        await bot.start(settings.discord_token.get_secret_value())
