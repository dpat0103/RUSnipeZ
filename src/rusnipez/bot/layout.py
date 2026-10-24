"""The community server's layout, as code. ``rusnipez discord-setup`` applies it.

Applying is idempotent: it creates what is missing and corrects topics, slow
mode and permissions on what exists, matching channels by name. It never
deletes anything, so channels added by hand are left alone. It works over the
REST API only, so it can run while the service's bot is connected.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass, field

import discord

from rusnipez.bot import embeds

log = logging.getLogger(__name__)

MOD_ROLE = "Mod"

# What the bot needs, and nothing more. The invite link asks for exactly this.
BOT_PERMISSIONS = discord.Permissions(
    view_channel=True,
    send_messages=True,
    send_messages_in_threads=True,
    create_private_threads=True,
    manage_threads=True,
    embed_links=True,
    attach_files=True,
    read_message_history=True,
    manage_messages=True,
    manage_channels=True,
    manage_roles=True,
)


@dataclass(frozen=True)
class Channel:
    name: str
    topic: str
    read_only: bool = False
    slowmode: int = 0
    # Builds the message the bot keeps at the top of the channel, if any.
    message: Callable[[], discord.Embed] | None = None


@dataclass(frozen=True)
class Category:
    name: str
    channels: list[Channel] = field(default_factory=list)
    staff: bool = False


def layout(watch_limit: int) -> list[Category]:
    return [
        Category(
            "Start here",
            [
                Channel(
                    "welcome",
                    "What RU SnipeZ is and how to start.",
                    read_only=True,
                    message=embeds.welcome_embed,
                ),
                Channel(
                    "how-to",
                    "Every command, and how to make sure alerts reach you.",
                    read_only=True,
                    message=lambda: embeds.how_to_embed(watch_limit),
                ),
                Channel("announcements", "Releases, outages and registration dates.", True),
            ],
        ),
        Category(
            "Sniping",
            [
                Channel(
                    "bot-commands",
                    "Run /snipe here. Replies are only visible to you.",
                    slowmode=3,
                ),
                Channel("live-openings", "Watched sections as they open.", read_only=True),
                Channel("status", "Is RU SnipeZ checking Rutgers right now?", read_only=True),
            ],
        ),
        Category(
            "Community",
            [
                Channel("general", "Anything Rutgers registration."),
                Channel("support", "Something not working? Ask here."),
                Channel("feedback", "Ideas and requests for RU SnipeZ."),
            ],
        ),
        Category(
            "Staff",
            [
                Channel("admin-log", "Bot errors and failed deliveries."),
                Channel("mod", "Moderator chat."),
            ],
            staff=True,
        ),
    ]


Overwrites = dict[discord.Role | discord.Member, discord.PermissionOverwrite]


def overwrites_for(
    category: Category,
    channel: Channel | None,
    everyone: discord.Role,
    mod: discord.Role,
    me: discord.Member,
) -> Overwrites:
    """Permission overwrites for a category (channel None) or one of its channels."""
    result: Overwrites = {}
    if category.staff:
        result[everyone] = discord.PermissionOverwrite(view_channel=False)
        result[mod] = discord.PermissionOverwrite(view_channel=True)
        result[me] = discord.PermissionOverwrite(view_channel=True, send_messages=True)
        return result
    if channel is None:
        return result
    if channel.read_only:
        result[everyone] = discord.PermissionOverwrite(
            send_messages=False, create_public_threads=False, create_private_threads=False
        )
        result[me] = discord.PermissionOverwrite(send_messages=True, embed_links=True)
    if channel.name == "bot-commands":
        # Alerts for members with closed DMs go to private threads here.
        result[everyone] = discord.PermissionOverwrite(
            create_public_threads=False, create_private_threads=False
        )
        result[me] = discord.PermissionOverwrite(
            create_private_threads=True, send_messages_in_threads=True, manage_threads=True
        )
    return result


def _same(current: dict, wanted: Overwrites) -> bool:
    by_id = {target.id: overwrite for target, overwrite in current.items()}
    return all(by_id.get(target.id) == overwrite for target, overwrite in wanted.items())


async def apply_layout(client: discord.Client, guild_id: int, watch_limit: int) -> list[str]:
    """Bring the server in line with ``layout``. Returns what changed."""
    guild = await client.fetch_guild(guild_id)
    me = await guild.fetch_member(client.user.id)
    changes: list[str] = []

    mod = discord.utils.get(guild.roles, name=MOD_ROLE)
    if mod is None:
        mod = await guild.create_role(
            name=MOD_ROLE,
            # A role can only get permissions the bot has itself.
            permissions=discord.Permissions(manage_messages=True),
            colour=discord.Colour(0x5865F2),
            hoist=True,
            reason="RU SnipeZ setup",
        )
        changes.append(f"created role @{MOD_ROLE}")

    existing = await guild.fetch_channels()
    for position, spec in enumerate(layout(watch_limit)):
        category = next(
            (
                c
                for c in existing
                if isinstance(c, discord.CategoryChannel) and c.name.lower() == spec.name.lower()
            ),
            None,
        )
        wanted = overwrites_for(spec, None, guild.default_role, mod, me)
        if category is None:
            category = await guild.create_category(
                spec.name, overwrites=wanted, position=position, reason="RU SnipeZ setup"
            )
            changes.append(f"created category {spec.name}")
        elif wanted and not _same(category.overwrites, wanted):
            await category.edit(overwrites=wanted, reason="RU SnipeZ setup")
            changes.append(f"fixed permissions on category {spec.name}")

        for channel_spec in spec.channels:
            channel = next(
                (
                    c
                    for c in existing
                    if isinstance(c, discord.TextChannel) and c.name == channel_spec.name
                ),
                None,
            )
            wanted = {
                **overwrites_for(spec, None, guild.default_role, mod, me),
                **overwrites_for(spec, channel_spec, guild.default_role, mod, me),
            }
            if channel is None:
                channel = await guild.create_text_channel(
                    channel_spec.name,
                    category=category,
                    topic=channel_spec.topic,
                    slowmode_delay=channel_spec.slowmode,
                    overwrites=wanted,
                    reason="RU SnipeZ setup",
                )
                changes.append(f"created #{channel_spec.name}")
            else:
                edits: dict = {}
                if channel.category_id != category.id:
                    edits["category"] = category
                if channel.topic != channel_spec.topic:
                    edits["topic"] = channel_spec.topic
                if channel.slowmode_delay != channel_spec.slowmode:
                    edits["slowmode_delay"] = channel_spec.slowmode
                if not _same(channel.overwrites, wanted):
                    edits["overwrites"] = wanted
                if edits:
                    await channel.edit(**edits, reason="RU SnipeZ setup")
                    changes.append(f"updated #{channel_spec.name}: {', '.join(edits)}")
            if channel_spec.message is not None and await _post(
                channel, client.user, channel_spec.message()
            ):
                changes.append(f"posted the #{channel_spec.name} message")
    return changes


async def _post(channel: discord.TextChannel, me: discord.abc.User, embed: discord.Embed) -> bool:
    """Post the bot's message once, then keep it current. Returns True if changed."""
    async for message in channel.history(limit=20, oldest_first=True):
        if message.author.id == me.id:
            if not message.embeds or message.embeds[0].to_dict() != embed.to_dict():
                await message.edit(embed=embed)
                return True
            return False
    # Not pinned: it is the only message in a read-only channel, and pinning
    # needs a permission of its own.
    await channel.send(embed=embed)
    return True


def invite_url(application_id: int, guild_id: int) -> str:
    """An invite that can only add the bot to the configured server."""
    return discord.utils.oauth_url(
        application_id,
        permissions=BOT_PERMISSIONS,
        guild=discord.Object(id=guild_id),
        scopes=("bot", "applications.commands"),
        disable_guild_select=True,
    )
