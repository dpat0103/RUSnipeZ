"""Message builders. They mirror the website's Discord preview
(web/src/demo/DiscordMessage.tsx), so the preview shows what the bot sends."""

from __future__ import annotations

from datetime import datetime

import discord

SITE_URL = "https://ru-snipez.vercel.app"

OPEN = discord.Colour(0x23A55A)
INFO = discord.Colour(0x5865F2)
WARN = discord.Colour(0xF0B232)
ERROR = discord.Colour(0xF23F43)
MUTED = discord.Colour(0x4E5058)

# Usage and description, in the order /help lists them.
COMMANDS = [
    ("/snipe <index>", "Watch a section. You get a DM the moment it opens."),
    ("/check", "List what you are watching, open sections first."),
    ("/remove <index>", "Stop watching a section."),
    ("/clear", "Stop watching everything, after a confirmation."),
    ("/lastopen <index>", "When a section was last open, and how often it opens."),
    ("/course <code>", "Every section of a course, with live status."),
    ("/status", "When Rutgers was last checked, and uptime."),
    ("/help", "This list."),
]


def _relative(at: datetime) -> str:
    return discord.utils.format_dt(at, "R")


def help_embed() -> discord.Embed:
    embed = discord.Embed(title="RU SnipeZ commands", colour=INFO)
    embed.description = "\n".join(f"`{usage}`  {text}" for usage, text in COMMANDS)
    return embed


def status_embed(stats: dict | None) -> discord.Embed:
    if stats is None:
        return discord.Embed(title="Status is unavailable right now.", colour=ERROR)
    embed = discord.Embed(title="RU SnipeZ is checking Rutgers every 30 seconds", colour=OPEN)
    last = stats["last_poll_at"]
    uptime = stats["uptime_24h"]
    embed.add_field(name="Last check", value=_relative(last) if last else "Not yet")
    embed.add_field(name="Uptime", value="No data yet" if uptime is None else f"{uptime:.1%}")
    embed.add_field(name="Sections tracked", value=f"{stats['sections_tracked']:,}")
    embed.add_field(name="Openings, 24 hours", value=f"{stats['openings_24h']:,}")
    return embed


def welcome_embed() -> discord.Embed:
    embed = discord.Embed(
        title="Welcome to RU SnipeZ",
        colour=INFO,
        description=(
            "RU SnipeZ checks Rutgers every 30 seconds and DMs you the moment a section you "
            "want opens.\n\nStudent-made. Not affiliated with Rutgers University."
        ),
        url=SITE_URL,
    )
    embed.add_field(
        name="1. Find the index",
        value=f"The 5-digit index from WebReg, or search on [the website]({SITE_URL}/search).",
        inline=False,
    )
    embed.add_field(
        name="2. Snipe it", value="Run `/snipe <index>` in #bot-commands.", inline=False
    )
    embed.add_field(
        name="3. Keep DMs on",
        value="Right-click the server › Privacy Settings › allow direct messages.",
        inline=False,
    )
    return embed


def how_to_embed(watch_limit: int) -> discord.Embed:
    embed = help_embed()
    embed.title = "How to use RU SnipeZ"
    embed.add_field(
        name="Alerts",
        value=(
            "A DM with **Register** (opens WebReg), **Snooze 1h**, **Stop watching** and "
            "**I got in**. If your DMs are closed, the alert goes to a private thread in "
            "#bot-commands instead."
        ),
        inline=False,
    )
    embed.add_field(
        name="Limits",
        value=(
            f"Up to {watch_limit} sections per term. Your list is private: command replies "
            "are only visible to you."
        ),
        inline=False,
    )
    return embed
