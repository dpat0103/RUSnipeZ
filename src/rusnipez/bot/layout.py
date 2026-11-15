"""The community server's layout, as code. ``rusnipez discord-setup`` applies it.

Applying is idempotent: it creates what is missing and corrects topics, slow
mode and permissions on what exists, matching channels by name. It also trims
@everyone down to ``EVERYONE_PERMISSIONS``. It never deletes anything, so
channels added by hand are left alone. It works over the REST API only, so it
can run while the service's bot is connected.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass, field

import discord

from rusnipez.bot import pages
from rusnipez.bot.pages import Link, Post

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

# The most any member gets server-wide. Discord's defaults also let everyone
# ping @everyone, upload emojis, create events and invites, and run their own
# apps; setup removes anything outside this set and never adds to it, since a
# bot cannot grant permissions it lacks itself.
EVERYONE_PERMISSIONS = discord.Permissions(
    view_channel=True,
    read_message_history=True,
    send_messages=True,
    # Alerts for members with closed DMs arrive in private threads.
    send_messages_in_threads=True,
    add_reactions=True,
    embed_links=True,
    attach_files=True,  # screenshots in #support
    use_application_commands=True,
    change_nickname=True,
)

# Slow mode on channels where members talk, so one account cannot flood them.
CHAT_SLOWMODE = 5
# One story per person every 6 hours in #wins.
WINS_SLOWMODE = 6 * 60 * 60


@dataclass(frozen=True)
class Channel:
    name: str
    topic: str
    read_only: bool = False
    slowmode: int = 0
    # Builds the message the bot keeps at the top of the channel, if any.
    message: Callable[[Link], Post] | None = None


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
                    message=pages.welcome,
                ),
                Channel("rules", "The server rules.", read_only=True, message=pages.rules),
                Channel(
                    "how-to",
                    "Step by step, with pictures: from finding an index to getting the alert.",
                    read_only=True,
                    message=lambda link: pages.how_to(link, watch_limit),
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
                Channel("live-openings", "Every section as it opens.", read_only=True),
                Channel("status", "Is RU SnipeZ checking Rutgers right now?", read_only=True),
            ],
        ),
        Category(
            "Community",
            [
                Channel("general", "Anything Rutgers registration.", slowmode=CHAT_SLOWMODE),
                Channel(
                    "wins",
                    "Got into a class with RU SnipeZ? Tell us about it.",
                    slowmode=WINS_SLOWMODE,
                    message=pages.wins,
                ),
                Channel("support", "Something not working? Ask here.", slowmode=CHAT_SLOWMODE),
                Channel("feedback", "Ideas and requests for RU SnipeZ.", slowmode=CHAT_SLOWMODE),
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


def trimmed_everyone(current: discord.Permissions) -> discord.Permissions:
    """@everyone's permissions with everything outside the allowed set removed."""
    return discord.Permissions(current.value & EVERYONE_PERMISSIONS.value)


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

    everyone = guild.default_role
    trimmed = trimmed_everyone(everyone.permissions)
    if trimmed != everyone.permissions:
        removed = sorted(
            name for name, on in everyone.permissions if on and not getattr(trimmed, name)
        )
        await everyone.edit(permissions=trimmed, reason="RU SnipeZ setup")
        changes.append(f"removed from @everyone: {', '.join(removed)}")

    existing = await guild.fetch_channels()
    placed: list[tuple[Channel, discord.TextChannel]] = []
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
            placed.append((channel_spec, channel))

    if await _order(client, guild, [channel for _, channel in placed]):
        changes.append("reordered channels")

    # Messages last, once every channel they link to exists.
    ids = {spec.name: channel.id for spec, channel in placed}

    def link(name: str) -> str:
        return f"<#{ids[name]}>" if name in ids else f"#{name}"

    for spec, channel in placed:
        if spec.message is not None and await _post(channel, client.user, spec.message(link)):
            changes.append(f"posted the #{spec.name} message")
    return changes


async def _order(
    client: discord.Client, guild: discord.Guild, channels: list[discord.TextChannel]
) -> bool:
    """Put the layout's channels in layout order. Returns True if any moved."""
    moves = [
        {"id": channel.id, "position": position}
        for position, channel in enumerate(channels)
        if channel.position != position
    ]
    if moves:
        await client.http.bulk_channel_update(guild.id, moves, reason="RU SnipeZ setup")
    return bool(moves)


def fingerprint(embeds: list[discord.Embed], buttons: list[tuple[str, str]]) -> list:
    """What a post shows, ignoring what Discord adds to a sent message, such as
    image sizes and proxy URLs, so an unchanged post is never edited."""
    shown = []
    for embed in embeds:
        data = embed.to_dict()
        data.pop("type", None)
        for key in ("image", "thumbnail"):
            if key in data:
                data[key] = {"url": data[key].get("url")}
        shown.append(data)
    return [shown, [list(button) for button in buttons]]


def _buttons(message: discord.Message) -> list[tuple[str, str]]:
    return [
        (child.label, child.url)
        for row in message.components
        if isinstance(row, discord.ActionRow)
        for child in row.children
        if isinstance(child, discord.Button) and child.url
    ]


def _view(post: Post) -> discord.ui.View | None:
    if not post.buttons:
        return None
    view = discord.ui.View(timeout=None)
    for label, url in post.buttons:
        view.add_item(discord.ui.Button(label=label, url=url))
    return view


async def _post(channel: discord.TextChannel, me: discord.abc.User, post: Post) -> bool:
    """Post the bot's message once, then keep it current. Returns True if changed."""
    wanted = fingerprint(post.embeds, post.buttons)
    async for message in channel.history(limit=20, oldest_first=True):
        if message.author.id == me.id:
            if fingerprint(message.embeds, _buttons(message)) != wanted:
                await message.edit(content=None, embeds=post.embeds, view=_view(post))
                return True
            return False
    # Not pinned: it is the first message in its channel, and pinning needs a
    # permission of its own.
    kwargs = {"view": view} if (view := _view(post)) else {}
    await channel.send(embeds=post.embeds, **kwargs)
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
