"""Watch commands: /snipe, /check, /remove and /clear. Replies are ephemeral,
so a person's list is visible only to them."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING

import discord
from discord import app_commands

from rusnipez.bot import embeds
from rusnipez.services import watches

if TYPE_CHECKING:
    from rusnipez.bot.client import SnipeBot


def account_age(user_id: int, now: datetime) -> timedelta:
    """Discord IDs encode when the account was created."""
    return now - discord.utils.snowflake_time(user_id)


def choice_label(match: watches.SectionMatch, several_terms: bool) -> str:
    label = f"{match.index} · {match.course_code} {match.course_title} · Sec {match.section_number}"
    if several_terms:
        label += f" · {embeds.term_name(match.term)}"
    return label[:100]


class ClearConfirm(discord.ui.View):
    def __init__(self, bot: SnipeBot, user_id: int) -> None:
        super().__init__(timeout=60)
        self.bot = bot
        self.user_id = user_id

    @discord.ui.button(label="Clear all", style=discord.ButtonStyle.danger)
    async def confirm(self, interaction: discord.Interaction, _: discord.ui.Button) -> None:
        async with self.bot.sessions.begin() as session:
            cleared = await watches.clear_watches(session, self.user_id)
        title = f"Cleared {cleared} section{'' if cleared == 1 else 's'}."
        await interaction.response.edit_message(
            embed=discord.Embed(title=title, colour=embeds.MUTED), view=None
        )

    @discord.ui.button(label="Cancel")
    async def cancel(self, interaction: discord.Interaction, _: discord.ui.Button) -> None:
        await interaction.response.edit_message(
            embed=discord.Embed(title="Kept your list.", colour=embeds.MUTED), view=None
        )


def register(bot: SnipeBot) -> None:
    tree, guild, settings = bot.tree, bot.guild, bot.settings
    terms = settings.active_terms

    async def section_choices(
        interaction: discord.Interaction, current: str
    ) -> list[app_commands.Choice[str]]:
        async with bot.sessions() as session:
            matches = await watches.find_sections(session, terms, current)
        return [
            app_commands.Choice(name=choice_label(m, len(terms) > 1), value=f"{m.term}:{m.index}")
            for m in matches
        ]

    async def watched_choices(
        interaction: discord.Interaction, current: str
    ) -> list[app_commands.Choice[str]]:
        async with bot.sessions.begin() as session:
            user = await watches.user_for(session, "discord", str(interaction.user.id))
            rows = await watches.list_watches(session, user.id, terms)
        return [
            app_commands.Choice(
                name=f"{r.index} · {r.course_title or 'Unlisted section'}"[:100],
                value=f"{r.term}:{r.index}",
            )
            for r in rows
            if current.lower() in f"{r.index} {r.course_title or ''}".lower()
        ][:25]

    @tree.command(
        name="snipe", description="Watch a section and get a DM when it opens.", guild=guild
    )
    @app_commands.describe(section="A 5-digit index, or start typing a course")
    @app_commands.autocomplete(section=section_choices)
    async def snipe(interaction: discord.Interaction, section: str) -> None:
        now = datetime.now(UTC)
        minimum = timedelta(days=settings.discord_min_account_age_days)
        if account_age(interaction.user.id, now) < minimum:
            await interaction.response.send_message(
                embed=discord.Embed(
                    title="This Discord account is too new to add watches.",
                    description=f"Accounts need to be at least {minimum.days} days old.",
                    colour=embeds.ERROR,
                ),
                ephemeral=True,
            )
            return
        async with bot.sessions.begin() as session:
            resolved = await watches.resolve_section(session, terms, section)
            if resolved is None:
                result, term, index = "unknown", terms[0], section.strip()[:20]
            else:
                term, index = resolved
                user = await watches.user_for(session, "discord", str(interaction.user.id))
                result = await watches.add_watch(
                    session, user, term, index, limit=settings.watch_limit
                )
            info = await bot.section_details(session, term, index)
            count = len(await watches.list_watches(session, user.id, [term])) if resolved else 0
        embed = embeds.snipe_embed(
            result, term=term, index=index, count=count, limit=settings.watch_limit, **info
        )
        view = discord.ui.View()
        if result == "added" and info["open_now"]:
            view.add_item(embeds.register_button(term, index))
        await interaction.response.send_message(embed=embed, view=view, ephemeral=True)

    @tree.command(name="check", description="List what you are watching.", guild=guild)
    async def check(interaction: discord.Interaction) -> None:
        async with bot.sessions.begin() as session:
            user = await watches.user_for(session, "discord", str(interaction.user.id))
            rows = await watches.list_watches(session, user.id, terms)
        await interaction.response.send_message(
            embed=embeds.check_embed(rows, settings.watch_limit), ephemeral=True
        )

    @tree.command(name="remove", description="Stop watching a section.", guild=guild)
    @app_commands.describe(section="One of the sections you are watching")
    @app_commands.autocomplete(section=watched_choices)
    async def remove(interaction: discord.Interaction, section: str) -> None:
        async with bot.sessions.begin() as session:
            user = await watches.user_for(session, "discord", str(interaction.user.id))
            resolved = await watches.resolve_section(session, terms, section)
            index = resolved[1] if resolved else section.strip()[:20]
            removed = bool(resolved) and await watches.remove_watch(session, user.id, *resolved)
        await interaction.response.send_message(
            embed=embeds.removed_embed(index, removed), ephemeral=True
        )

    @tree.command(name="clear", description="Stop watching everything.", guild=guild)
    async def clear(interaction: discord.Interaction) -> None:
        async with bot.sessions.begin() as session:
            user = await watches.user_for(session, "discord", str(interaction.user.id))
            count = len(await watches.list_watches(session, user.id, terms))
        embed = embeds.clear_prompt_embed(count)
        if count == 0:
            await interaction.response.send_message(embed=embed, ephemeral=True)
        else:
            await interaction.response.send_message(
                embed=embed, view=ClearConfirm(bot, user.id), ephemeral=True
            )
