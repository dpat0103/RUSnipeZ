"""Message builders. They mirror the website's Discord preview
(web/src/demo/DiscordMessage.tsx), so the preview shows what the bot sends."""

from __future__ import annotations

from datetime import UTC, datetime

import discord

from rusnipez.soc.term import Term

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
    if stats.get("alerts_sent_total"):
        speed = stats["median_alert_seconds_7d"]
        embed.add_field(name="Alerts sent, 24 hours", value=f"{stats['alerts_sent_24h']:,}")
        embed.add_field(name="Check to DM", value="—" if speed is None else f"{speed:.1f} s")
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


def webreg_url(term: str, index: str) -> str:
    return (
        "https://sims.rutgers.edu/webreg/editSchedule.htm"
        f"?login=cas&semesterSelection={term}&indexList={index}"
    )


def name_case(instructors: str | None) -> str:
    """Rutgers' upper-case names, such as DOE, JANE, as Doe, Jane."""
    if not instructors:
        return "TBA"
    return instructors.title()


def term_name(term: str) -> str:
    return str(Term.parse(term))


def _section_fields(
    embed: discord.Embed,
    *,
    index: str,
    course_code: str | None,
    section_number: str | None,
    instructors: str | None,
    spn: bool = False,
) -> None:
    embed.add_field(name="Index", value=f"`{index}`")
    if course_code:
        embed.add_field(name="Section", value=f"{course_code} · Sec {section_number}")
    embed.add_field(name="Instructor", value=name_case(instructors))
    if spn:
        embed.add_field(name="Heads up", value="Needs a special permission number", inline=False)


def register_button(term: str, index: str) -> discord.ui.Button:
    return discord.ui.Button(label="Register", url=webreg_url(term, index))


def snipe_embed(
    result: str,
    *,
    term: str,
    index: str,
    title: str | None,
    course_code: str | None,
    section_number: str | None,
    instructors: str | None,
    spn: bool,
    open_now: bool,
    count: int,
    limit: int,
) -> discord.Embed:
    if result == "duplicate":
        return discord.Embed(title=f"You are already watching {index}.", colour=WARN)
    if result == "limit":
        return discord.Embed(
            title=f"You can watch up to {limit} sections per term.",
            description="Remove one with /remove first.",
            colour=ERROR,
        )
    if result == "unknown":
        return discord.Embed(title=f"Could not find section {index}.", colour=ERROR)
    if result == "banned":
        return discord.Embed(title="This account cannot add watches.", colour=ERROR)
    name = title or f"Section {index}"
    embed = discord.Embed(
        title=f"{name} is open right now" if open_now else f"Now watching {name}",
        colour=OPEN if open_now else INFO,
    )
    _section_fields(
        embed,
        index=index,
        course_code=course_code,
        section_number=section_number,
        instructors=instructors,
        spn=spn,
    )
    hint = (
        "Register now, or keep watching for the next opening"
        if open_now
        else "You will get a DM the moment it opens"
    )
    embed.set_footer(text=f"{term_name(term)} · {hint} · {count}/{limit} watches")
    return embed


def check_embed(rows: list, limit: int) -> discord.Embed:
    if not rows:
        return discord.Embed(
            title="You are not watching anything.",
            description="Add a section with /snipe.",
            colour=MUTED,
        )
    embed = discord.Embed(title=f"Your snipe list ({len(rows)})", colour=INFO)
    lines = []
    for row in rows:
        dot = "🟢" if row.open else "⚪"
        what = (
            f"{row.course_title} · Sec {row.section_number}"
            if row.course_title
            else "Not listed by Rutgers yet"
        )
        state = "Open" if row.open else "Closed"
        snoozed = " · snoozed" if row.snoozed_until and row.snoozed_until > _now() else ""
        lines.append(f"{dot} `{row.index}` {what} · {state}{snoozed}")
    embed.description = "\n".join(lines)
    embed.set_footer(text=f"Up to {limit} per term")
    return embed


def removed_embed(index: str, removed: bool) -> discord.Embed:
    if not removed:
        return discord.Embed(title=f"{index} is not on your list.", colour=WARN)
    return discord.Embed(title=f"Stopped watching {index}", colour=MUTED)


def clear_prompt_embed(count: int) -> discord.Embed:
    if count == 0:
        return discord.Embed(title="Your list is already empty.", colour=MUTED)
    what = "your 1 section" if count == 1 else f"all {count} sections"
    return discord.Embed(title=f"Stop watching {what}?", colour=WARN)


def alert_embed(job) -> discord.Embed:
    name = job.course_title or f"Section {job.index}"
    embed = discord.Embed(
        title=f"{name} is open",
        colour=OPEN,
        url=webreg_url(job.term, job.index),
        timestamp=job.opened_at,
    )
    _section_fields(
        embed,
        index=job.index,
        course_code=job.course_code,
        section_number=job.section_number,
        instructors=job.instructors,
        spn=job.spn,
    )
    embed.set_footer(text=term_name(job.term))
    return embed


def _now() -> datetime:
    return datetime.now(UTC)


SPARK = "▁▂▃▄▅▆▇█"
CAMPUS_NAMES = {"NB": "New Brunswick", "NK": "Newark", "CM": "Camden", "OC": "Off-campus"}


def sparkline(counts: list[int]) -> str:
    top = max(counts)
    if top == 0:
        return ""
    return "".join(SPARK[round(c / top * (len(SPARK) - 1))] if c else " " for c in counts)


def duration(seconds: int) -> str:
    if seconds < 90:
        return f"{seconds} s"
    if seconds < 90 * 60:
        return f"{round(seconds / 60)} min"
    return f"{seconds / 3600:.1f} h"


def lastopen_embed(
    index: str, title: str | None, section_number: str | None, history: dict
) -> discord.Embed:
    if history["open_now"]:
        since = history["open_since"]
        status = f"Open since {_relative(since)}" if since else "Open now"
    elif history["last_seen_open_at"]:
        status = f"Last seen open {_relative(history['last_seen_open_at'])}"
    else:
        status = "Not seen open since tracking began"
    name = f"{title} · Sec {section_number}" if title else f"Section {index}"
    embed = discord.Embed(title=name, colour=OPEN if history["open_now"] else INFO)
    embed.add_field(name="Status", value=status, inline=False)
    embed.add_field(
        name="Openings",
        value=f"{history['openings_7d']} in 7 days · {history['openings_30d']} in 30 days",
    )
    median = history["median_open_seconds"]
    embed.add_field(
        name="Typically open", value="Not enough data" if median is None else duration(median)
    )
    line = sparkline(history["openings_by_hour"])
    if line:
        embed.add_field(
            name="When it opens (Eastern, last 30 days)",
            value=f"```\n{line}\n12a   6a    12p   6p  11p\n```",
            inline=False,
        )
    embed.set_footer(text=f"Index {index}")
    return embed


def course_embed(term: str, code: str, title: str | None, sections: list) -> discord.Embed:
    if not sections:
        return discord.Embed(title=f"Could not find {code}.", colour=ERROR)
    shown = sections[:15]
    open_count = sum(s.open for s in sections)
    embed = discord.Embed(title=f"{code} {title}", colour=INFO)
    lines = [
        f"{'🟢' if s.open else '⚪'} Sec {s.number} · `{s.index}` · {name_case(s.instructors)}"
        for s in shown
    ]
    if len(sections) > len(shown):
        lines.append(f"and {len(sections) - len(shown)} more")
    embed.description = "\n".join(lines)
    campuses = sorted({CAMPUS_NAMES.get(s.campus, s.campus) for s in sections})
    embed.set_footer(
        text=f"{term_name(term)} · {', '.join(campuses)} · {open_count} of {len(sections)} open"
    )
    return embed
