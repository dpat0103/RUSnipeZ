"""Command line entry point: ``rusnipez migrate | serve | sync-catalogs | discord-setup |
discord-invite``."""

from __future__ import annotations

import argparse
import asyncio
import logging

from rusnipez.settings import get_settings


def configure_logging(verbose: bool) -> None:
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
    )
    # Per-request lines drown out the poller and catalog logs.
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)


def migrate() -> None:
    from rusnipez.db.session import migrate as run

    run(get_settings().database_url)


def serve(host: str, port: int) -> None:
    import uvicorn

    from rusnipez.api.app import create_app

    uvicorn.run(create_app(), host=host, port=port, log_config=None)


def sync_catalogs() -> None:
    from rusnipez.db import create_engine, create_sessionmaker
    from rusnipez.services.catalog import ensure_terms
    from rusnipez.services.workers import refresh_catalogs
    from rusnipez.soc.term import Term

    async def run() -> None:
        settings = get_settings()
        engine = create_engine(settings.database_url)
        sessions = create_sessionmaker(engine)
        terms = [Term.parse(code) for code in settings.active_terms]
        try:
            async with sessions.begin() as session:
                await ensure_terms(session, terms)
            await refresh_catalogs(sessions, terms)
        finally:
            await engine.dispose()

    asyncio.run(run())


def discord_setup() -> None:
    import discord

    from rusnipez.bot.layout import apply_layout

    settings = get_settings()
    if settings.discord_token is None or settings.discord_guild_id is None:
        raise SystemExit("set RUSNIPEZ_DISCORD_TOKEN and RUSNIPEZ_DISCORD_GUILD_ID first")

    async def run() -> None:
        # REST only: no gateway connection, so the running service is unaffected.
        async with discord.Client(intents=discord.Intents.none()) as client:
            await client.login(settings.discord_token.get_secret_value())
            changes = await apply_layout(client, settings.discord_guild_id, settings.watch_limit)
        for change in changes:
            print(change)
        print(f"{len(changes)} changes" if changes else "the server already matches the layout")

    asyncio.run(run())


def discord_invite() -> None:
    from rusnipez.bot.layout import invite_url

    settings = get_settings()
    if settings.discord_application_id is None or settings.discord_guild_id is None:
        raise SystemExit("set RUSNIPEZ_DISCORD_APPLICATION_ID and RUSNIPEZ_DISCORD_GUILD_ID first")
    print(invite_url(settings.discord_application_id, settings.discord_guild_id))


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="rusnipez", description=__doc__.splitlines()[0])
    parser.add_argument("-v", "--verbose", action="store_true")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("migrate", help="apply database migrations")
    serve_parser = commands.add_parser("serve", help="run the API, poller and catalog jobs")
    serve_parser.add_argument("--host", default="127.0.0.1")
    serve_parser.add_argument("--port", type=int, default=8000)
    commands.add_parser("sync-catalogs", help="fetch every active term's catalogs once")
    commands.add_parser("discord-setup", help="create or repair the Discord server's layout")
    commands.add_parser("discord-invite", help="print the link that adds the bot to the server")
    args = parser.parse_args(argv)

    configure_logging(args.verbose)
    if args.command == "migrate":
        migrate()
    elif args.command == "serve":
        serve(args.host, args.port)
    elif args.command == "sync-catalogs":
        sync_catalogs()
    elif args.command == "discord-setup":
        discord_setup()
    else:
        discord_invite()
