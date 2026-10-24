from __future__ import annotations

from datetime import timedelta
from urllib.parse import parse_qs, urlparse

import discord

from rusnipez.bot import embeds
from rusnipez.bot.client import guilds_to_leave
from rusnipez.bot.layout import BOT_PERMISSIONS, invite_url, layout, overwrites_for
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


def test_every_channel_message_builds() -> None:
    for category in layout(15):
        for spec in category.channels:
            if spec.message:
                assert spec.message().title


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
