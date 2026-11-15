"""The messages the bot keeps at the top of #welcome, #rules, #how-to and #wins.

Each builder takes ``link``, which turns a channel name into a clickable
channel mention, so the pages can point at each other. ``discord-setup`` posts
them once and edits them when the text here changes.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field

import discord

from rusnipez.bot.embeds import COMMANDS, INFO, OPEN, SITE_URL

Link = Callable[[str], str]

LOGO_URL = f"{SITE_URL}/logo.png"
# Screenshots for #how-to, served by the website from web/public/discord/.
# A step shows its picture only once the file is listed here, so a missing
# screenshot never leaves a broken image in the channel.
SCREENSHOTS: dict[str, str] = {
    "find": "find.png",
    "snipe": "snipe.png",
    "alert": "alert.png",
    "dms": "dms.png",
    "check": "check.png",
}


@dataclass(frozen=True)
class Post:
    embeds: list[discord.Embed]
    # Link buttons under the message: (label, url).
    buttons: list[tuple[str, str]] = field(default_factory=list)


def _screenshot(embed: discord.Embed, step: str) -> discord.Embed:
    if step in SCREENSHOTS:
        embed.set_image(url=f"{SITE_URL}/discord/{SCREENSHOTS[step]}")
    return embed


def welcome(link: Link) -> Post:
    embed = discord.Embed(
        title="Welcome to RU SnipeZ 👋",
        colour=INFO,
        url=SITE_URL,
        description=(
            "Class full? RU SnipeZ checks Rutgers every 30 seconds and sends you a DM "
            "the moment a seat opens, with a button straight to WebReg."
        ),
    )
    embed.set_thumbnail(url=LOGO_URL)
    embed.add_field(
        name="Get your first alert in a minute",
        value=(
            "**1.** Copy the 5-digit index of the section from WebReg\n"
            f"**2.** Type `/snipe` and the index in {link('bot-commands')}\n"
            "**3.** Keep DMs from this server on, and wait for the ping"
        ),
        inline=False,
    )
    embed.add_field(
        name="Find your way around",
        value=(
            f"📖 {link('how-to')} step by step, with pictures\n"
            f"📜 {link('rules')} the short version\n"
            f"🟢 {link('live-openings')} seats as they open\n"
            f"🏆 {link('wins')} people who got in\n"
            f"🛟 {link('support')} stuck? Ask here"
        ),
        inline=False,
    )
    embed.set_footer(
        text="Free and student-made · Never asks for your NetID · Not affiliated with Rutgers"
    )
    return Post(
        [embed],
        buttons=[
            ("Search courses", f"{SITE_URL}/search"),
            ("How it works", f"{SITE_URL}/how-it-works"),
        ],
    )


RULES = [
    ("Be kind", "No harassment, hate speech or personal attacks. Disagree without being rude."),
    (
        "No spam or ads",
        "No self-promotion, server invites, or the same message in several channels.",
    ),
    (
        "No selling or trading seats",
        "Don't buy, sell or swap seats, accounts or registration help.",
    ),
    (
        "Keep your login private",
        "Never share your NetID, password or Duo codes. RU SnipeZ will never ask for them, "
        "and neither will staff.",
    ),
    (
        "Use the right channel",
        "Bot problems go in {support}, ideas in {feedback}, commands in {bot_commands}.",
    ),
    (
        "Follow Discord's rules",
        "Discord's Terms and Community Guidelines apply here. Mods may remove messages "
        "or members who break these rules.",
    ),
]


def rules(link: Link) -> Post:
    embed = discord.Embed(title="📜 Server rules", colour=INFO)
    channels = {
        "support": link("support"),
        "feedback": link("feedback"),
        "bot_commands": link("bot-commands"),
    }
    embed.description = "\n\n".join(
        f"**{number}. {title}**\n{text.format(**channels)}"
        for number, (title, text) in enumerate(RULES, start=1)
    )
    embed.set_footer(
        text="RU SnipeZ is run by a student and is not affiliated with Rutgers University."
    )
    return Post([embed])


def how_to(link: Link, watch_limit: int) -> Post:
    intro = discord.Embed(
        title="How to use RU SnipeZ",
        colour=INFO,
        description="Five steps, about a minute. New to Discord? Each step shows where to click.",
    )
    find = discord.Embed(
        title="1 · Find the section's index",
        colour=INFO,
        description=(
            "Every section has a 5-digit **index**, shown next to it in WebReg and the "
            "Schedule of Classes. You can also search any course on "
            f"[the website]({SITE_URL}/search)."
        ),
    )
    snipe = discord.Embed(
        title="2 · Snipe it",
        colour=INFO,
        description=(
            f"In {link('bot-commands')}, type `/snipe`, pick the command, paste the index and "
            "press Enter. You can also type a course code or name and pick from the list. "
            "Only you can see the reply."
        ),
    )
    alert = discord.Embed(
        title="3 · Get the alert",
        colour=OPEN,
        description=(
            "When a seat opens you get a DM within seconds:\n"
            "**Register** opens WebReg with the index filled in\n"
            "**Snooze 1h** pauses alerts for that section for an hour\n"
            "**Stop watching** removes it from your list\n"
            "**I got in** stops alerts and counts toward the success stats"
        ),
    )
    dms = discord.Embed(
        title="4 · Make sure the DM reaches you",
        colour=INFO,
        description=(
            "**Computer:** right-click the RU SnipeZ server icon › **Privacy Settings** › "
            "turn on **Direct Messages**.\n"
            "**Phone:** tap the server name at the top › **Privacy Settings** › turn on "
            "**Direct Messages**, and allow notifications for Discord.\n"
            f"If DMs stay off, alerts go to a private thread in {link('bot-commands')} instead."
        ),
    )
    manage = discord.Embed(
        title="5 · Manage your list",
        colour=INFO,
        description=(
            f"`/check` shows what you're watching, open sections first. `/remove` drops one, "
            f"`/clear` drops all. You can watch up to {watch_limit} sections per term."
        ),
    )
    for embed, step in (
        (find, "find"),
        (snipe, "snipe"),
        (alert, "alert"),
        (dms, "dms"),
        (manage, "check"),
    ):
        _screenshot(embed, step)
    commands = discord.Embed(
        title="All commands",
        colour=INFO,
        description="\n".join(f"`{usage}`  {text}" for usage, text in COMMANDS),
    )
    commands.set_footer(text="Still stuck? Ask in #support.")
    return Post([intro, find, snipe, alert, dms, manage, commands])


def wins(link: Link) -> Post:
    embed = discord.Embed(
        title="🏆 Wins",
        colour=OPEN,
        description=(
            "Got into a class with RU SnipeZ? Tell everyone: which class, how long you "
            "waited, how fast you got the seat. Screenshots welcome.\n\n"
            f"One post every 6 hours. Questions go in {link('support')}."
        ),
    )
    return Post([embed])
