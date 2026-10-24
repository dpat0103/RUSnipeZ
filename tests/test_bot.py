from __future__ import annotations

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
