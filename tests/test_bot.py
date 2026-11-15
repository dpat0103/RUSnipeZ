from __future__ import annotations

from datetime import timedelta
from types import SimpleNamespace
from urllib.parse import parse_qs, urlparse

import discord

from rusnipez.bot import embeds, pages
from rusnipez.bot.channels import MAX_MESSAGES, openings_messages
from rusnipez.bot.client import guilds_to_leave
from rusnipez.bot.layout import (
    BOT_PERMISSIONS,
    EVERYONE_PERMISSIONS,
    fingerprint,
    invite_url,
    layout,
    overwrites_for,
    trimmed_everyone,
)
from rusnipez.settings import Settings
from tests.conftest import T0

GUILD = 1563611067886600282
EVERYONE, MOD, ME = (discord.Object(id=n) for n in (1, 2, 3))


def test_the_bot_leaves_every_other_server() -> None:
    assert guilds_to_leave([GUILD, 111, 222], GUILD) == [111, 222]
    assert guilds_to_leave([GUILD], GUILD) == []


def test_the_invite_only_offers_the_configured_server() -> None:
    query = parse_qs(urlparse(invite_url(1563613281917210714, GUILD)).query)
    assert query["guild_id"] == [str(GUILD)]
    assert query["disable_guild_select"] == ["true"]
    assert query["scope"] == ["bot applications.commands"]
    granted = discord.Permissions(int(query["permissions"][0]))
    assert granted == BOT_PERMISSIONS
    assert not granted.administrator


def test_owner_ids_parse_from_a_comma_list() -> None:
    settings = Settings(discord_owner_ids="324357073695408148, 42")
    assert settings.discord_owner_ids == [324357073695408148, 42]


def channel(name: str):
    for category in layout(15):
        for spec in category.channels:
            if spec.name == name:
                return category, spec
    raise KeyError(name)


def test_staff_channels_are_hidden_from_everyone_but_mods_and_the_bot() -> None:
    category, spec = channel("admin-log")
    overwrites = overwrites_for(category, spec, EVERYONE, MOD, ME)
    assert overwrites[EVERYONE].view_channel is False
    assert overwrites[MOD].view_channel is True
    assert overwrites[ME].view_channel is True


def test_read_only_channels_let_only_the_bot_post() -> None:
    category, spec = channel("live-openings")
    overwrites = overwrites_for(category, spec, EVERYONE, MOD, ME)
    assert overwrites[EVERYONE].send_messages is False
    assert overwrites[ME].send_messages is True


def test_members_can_post_commands_but_not_open_threads() -> None:
    category, spec = channel("bot-commands")
    overwrites = overwrites_for(category, spec, EVERYONE, MOD, ME)
    assert EVERYONE not in overwrites or overwrites[EVERYONE].send_messages is not False
    assert overwrites[EVERYONE].create_private_threads is False
    assert overwrites[ME].create_private_threads is True
    assert spec.slowmode > 0


def test_everyone_loses_discords_risky_defaults() -> None:
    # What @everyone had on the live server before setup managed it.
    defaults = discord.Permissions(
        view_channel=True,
        send_messages=True,
        add_reactions=True,
        mention_everyone=True,
        create_instant_invite=True,
        create_expressions=True,
        create_events=True,
        use_external_apps=True,
        create_public_threads=True,
        send_polls=True,
        connect=True,
    )
    trimmed = trimmed_everyone(defaults)
    assert trimmed.view_channel and trimmed.send_messages and trimmed.add_reactions
    for risky in (
        "mention_everyone",
        "create_instant_invite",
        "create_expressions",
        "create_events",
        "use_external_apps",
        "create_public_threads",
        "send_polls",
        "connect",
    ):
        assert not getattr(trimmed, risky), risky


def test_trimming_everyone_never_adds_permissions() -> None:
    assert trimmed_everyone(discord.Permissions.none()) == discord.Permissions.none()
    assert not EVERYONE_PERMISSIONS.mention_everyone
    assert not EVERYONE_PERMISSIONS.administrator


def test_chat_channels_have_slow_mode() -> None:
    for name in ("general", "support", "feedback"):
        assert channel(name)[1].slowmode > 0


def opening(n: int) -> SimpleNamespace:
    return SimpleNamespace(
        index=f"{n:05}",
        course_code="01:640:151",
        course_title="CALCULUS I FOR THE MATHEMATICAL AND PHYSICAL SCIENCES",
        section_number="03",
    )


def test_openings_pack_into_messages_under_discords_limit() -> None:
    messages = openings_messages([opening(n) for n in range(60)])
    assert 1 < len(messages) <= MAX_MESSAGES
    assert all(len(message) <= 2000 for message in messages)
    assert sum(message.count("🟢") for message in messages) == 60


def test_a_burst_of_openings_ends_in_a_count() -> None:
    messages = openings_messages([opening(n) for n in range(1000)])
    assert len(messages) == MAX_MESSAGES
    assert all(len(message) <= 2000 for message in messages)
    shown = sum(message.count("🟢") for message in messages)
    assert messages[-1].endswith(f"and {1000 - shown} more")


def test_no_openings_posts_nothing() -> None:
    assert openings_messages([]) == []


def all_channels() -> list[str]:
    return [spec.name for category in layout(15) for spec in category.channels]


def test_every_page_fits_discords_limits_and_links_real_channels() -> None:
    names = set(all_channels())
    for category in layout(15):
        for spec in category.channels:
            if spec.message is None:
                continue
            linked: list[str] = []
            post = spec.message(lambda name, seen=linked: seen.append(name) or f"<#{name}>")
            assert 1 <= len(post.embeds) <= 10, spec.name
            assert len(post.buttons) <= 5, spec.name
            assert sum(len(embed) for embed in post.embeds) <= 6000, spec.name
            for embed in post.embeds:
                assert embed.title and len(embed.title) <= 256
                assert len(embed.description or "") <= 4096
                assert len(embed.fields) <= 25
                assert all(len(f.name) <= 256 and len(f.value) <= 1024 for f in embed.fields)
            assert set(linked) <= names, f"#{spec.name} links a channel not in the layout"


def test_start_here_leads_with_welcome_then_rules() -> None:
    assert all_channels()[:4] == ["welcome", "rules", "how-to", "announcements"]
    category, spec = channel("rules")
    assert overwrites_for(category, spec, EVERYONE, MOD, ME)[EVERYONE].send_messages is False


def test_wins_is_open_to_members_but_slow() -> None:
    category, spec = channel("wins")
    assert EVERYONE not in overwrites_for(category, spec, EVERYONE, MOD, ME)
    assert spec.slowmode >= 60 * 60


def test_a_sent_post_matches_its_source() -> None:
    # Discord adds sizes and proxy URLs to images; that alone is not a change.
    post = pages.welcome(lambda name: f"#{name}")
    sent = discord.Embed.from_dict(
        post.embeds[0].to_dict()
        | {
            "type": "rich",
            "thumbnail": {
                "url": pages.LOGO_URL,
                "proxy_url": "https://media.discordapp.net/x.png",
                "width": 256,
                "height": 256,
            },
        }
    )
    assert fingerprint([sent], post.buttons) == fingerprint(post.embeds, post.buttons)
    changed = pages.welcome(lambda name: f"<#{name}>")
    assert fingerprint(changed.embeds, changed.buttons) != fingerprint(post.embeds, post.buttons)


def test_how_to_shows_only_screenshots_that_exist(monkeypatch) -> None:
    def link(name: str) -> str:
        return f"#{name}"

    assert not any(embed.image.url for embed in pages.how_to(link, 15).embeds)
    monkeypatch.setitem(pages.SCREENSHOTS, "snipe", "snipe.png")
    images = [embed.image.url for embed in pages.how_to(link, 15).embeds if embed.image.url]
    assert images == [f"{embeds.SITE_URL}/discord/snipe.png"]


def test_help_lists_every_command() -> None:
    text = embeds.help_embed().description
    for usage, _ in embeds.COMMANDS:
        assert usage in text


def test_status_reads_stats_or_says_it_is_unavailable() -> None:
    assert embeds.status_embed(None).colour == embeds.ERROR
    embed = embeds.status_embed(
        {"last_poll_at": T0, "uptime_24h": 0.9987, "sections_tracked": 11276, "openings_24h": 412}
    )
    values = {field.name: field.value for field in embed.fields}
    assert values["Uptime"] == "99.9%"
    assert values["Sections tracked"] == "11,276"


def test_empty_discord_settings_mean_no_bot() -> None:
    settings = Settings(
        discord_token="", discord_guild_id="", discord_application_id="", discord_owner_ids=""
    )
    assert settings.discord_token is None
    assert settings.discord_guild_id is None
    assert settings.discord_owner_ids == []


def test_account_age_comes_from_the_discord_id() -> None:
    from rusnipez.bot.commands import account_age

    # The owner's account dates from June 2017.
    assert account_age(324357073695408148, T0).days > 3000
    brand_new = discord.utils.time_snowflake(T0 - timedelta(hours=1))
    assert account_age(brand_new, T0) < timedelta(days=7)


def test_alert_embed_and_buttons() -> None:
    from rusnipez.bot.alerts import alert_view
    from rusnipez.services.alerts import AlertJob

    job = AlertJob(
        id=7,
        watch_id=3,
        user_id=1,
        attempts=1,
        term="12027",
        index="10001",
        opened_at=T0,
        course_code="01:198:111",
        course_title="INTRO COMPUTER SCI",
        section_number="01",
        instructors="DOE, JANE",
        spn=True,
        identities=(("discord", "1"),),
    )
    embed = embeds.alert_embed(job)
    assert embed.title == "INTRO COMPUTER SCI is open"
    fields = {field.name: field.value for field in embed.fields}
    assert fields["Instructor"] == "Doe, Jane"
    assert "Heads up" in fields
    view = alert_view(job)
    register, *actions = view.children
    assert "indexList=10001" in register.url and "semesterSelection=12027" in register.url
    assert [b.custom_id for b in actions] == [
        "alert:snoozed:3:7",
        "alert:stopped:3:7",
        "alert:got_in:3:7",
    ]


def test_snipe_replies() -> None:
    common = dict(
        term="12027",
        index="10001",
        title="INTRO COMPUTER SCI",
        course_code="01:198:111",
        section_number="01",
        instructors=None,
        spn=False,
        count=2,
        limit=15,
    )
    added = embeds.snipe_embed("added", open_now=False, **common)
    assert added.title == "Now watching INTRO COMPUTER SCI"
    assert "2/15 watches" in added.footer.text
    assert embeds.snipe_embed("added", open_now=True, **common).colour == embeds.OPEN
    assert embeds.snipe_embed("limit", open_now=False, **common).colour == embeds.ERROR
    assert "already" in embeds.snipe_embed("duplicate", open_now=False, **common).title


def test_hour_chart_and_durations() -> None:
    counts = [0] * 24
    counts[9], counts[14] = 4, 8
    line = embeds.sparkline(counts)
    assert len(line) == 24 and line[14] == "█" and line[0] == " "
    assert embeds.sparkline([0] * 24) == ""
    assert [embeds.duration(s) for s in (45, 600, 7200)] == ["45 s", "10 min", "2.0 h"]


def test_lastopen_and_course_replies() -> None:
    from rusnipez.services.watches import CourseSection

    history = {
        "open_now": False,
        "open_since": None,
        "last_seen_open_at": T0,
        "openings_7d": 3,
        "openings_30d": 9,
        "median_open_seconds": 240,
        "openings_by_hour": [1] * 24,
    }
    embed = embeds.lastopen_embed("10001", "INTRO COMPUTER SCI", "01", history)
    fields = {field.name: field.value for field in embed.fields}
    assert fields["Openings"] == "3 in 7 days · 9 in 30 days"
    assert fields["Typically open"] == "4 min"
    sections = [
        CourseSection("10001", "01", "DOE, JANE", "NB", True),
        CourseSection("10002", "02", "", "NB", False),
    ]
    course = embeds.course_embed("12027", "01:198:111", "INTRO COMPUTER SCI", sections)
    assert "🟢 Sec 01 · `10001` · Doe, Jane" in course.description
    assert course.footer.text == "Spring 2027 · New Brunswick · 1 of 2 open"
    assert embeds.course_embed("12027", "01:999:999", None, []).colour == embeds.ERROR


async def test_admin_log_forwards_warnings_but_not_its_own_failures() -> None:
    import asyncio
    import logging

    from rusnipez.bot.channels import AdminLogHandler

    handler = AdminLogHandler(asyncio.get_running_loop())
    for name, level in [
        ("rusnipez.services.alerts", logging.ERROR),
        ("rusnipez.services.alerts", logging.INFO),
        ("rusnipez.bot.channels", logging.WARNING),
        ("discord.gateway", logging.WARNING),
    ]:
        record = logging.LogRecord(name, level, __file__, 1, "boom", None, None)
        if record.levelno >= handler.level:
            handler.emit(record)
    await asyncio.sleep(0)
    assert handler.queue.qsize() == 1
    assert handler.queue.get_nowait() == "ERROR rusnipez.services.alerts: boom"
