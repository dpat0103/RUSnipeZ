<div align="center">
  <img src="RU_snipeZ_logo.png" alt="RU SnipeZ" width="150" />
  <h1>RU SnipeZ</h1>
  <p><strong>Open-seat alerts for Rutgers course registration.</strong><br>
  A Discord bot for students, and a live website that shows the same feed to everyone else.</p>
  <p>
    <a href="https://github.com/dpat0103/RUSnipeZ/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/dpat0103/RUSnipeZ/actions/workflows/ci.yml/badge.svg"></a>
    <img alt="Python 3.12" src="https://img.shields.io/badge/python-3.12-3776AB?logo=python&logoColor=white">
    <img alt="license" src="https://img.shields.io/badge/license-MIT-blue">
  </p>
</div>

---

> **v3 in progress.** This branch rebuilds RU SnipeZ around one always-on service. The
> detection engine, API and website are done; the Discord bot is next. See the
> [v3 plan](docs/v3-plan.md).

## The problem

Popular Rutgers sections fill in the first hours of registration, and most have no waitlist.
When a student drops, the seat goes to whoever refreshes WebReg first. RU SnipeZ does the
refreshing and tells you when to act.

It started as a Discord bot that shipped to a real student community: `/snipe 10052` to watch
an index, a DM with a **Register** button when it opened. The original is archived in
[`legacy/v1/`](legacy/v1/).

<p align="center">
  <img src="docs/screenshots/snipe_command.png" width="49%" alt="Setting a watch with /snipe">
  <img src="docs/screenshots/sample_noti.png" width="49%" alt="The alert when a seat opens">
</p>

## How it works

```
                ┌──────────── rusnipez service (one Python process) ─────────────┐
 courses.json ─►│ catalog sync (6h) ──► catalogs + sections                       │
 openSections ─►│ poller (30s) ─► diff ─► change guard ─► openings (PostgreSQL)   │
                │ FastAPI read API: /api/v1/...                                   │
                └─────────────────────────────────────────────────────────────────┘
                              ▲                                ▲
                  React website (live feed, search)    Discord bot (next)
```

- **One shared check.** Rutgers publishes every open section index in one response, cached for
  30 seconds. The service fetches it once per term every 30 seconds for all users, which is as
  fresh as the data gets.
- **Openings are a set difference.** A section that appears when it was missing from the
  previous check is an opening. A section that stays open is not news, so there is no cooldown
  and no duplicate alert.
- **A guard against bad upstream data.** Rutgers' endpoint is load-balanced, and one backend
  sometimes serves a frozen, out-of-date list: on 21 Oct 2026 it dropped 4,308 sections and
  added 19 stale ones, twice, 15 minutes apart. Any check that changes many sections at once is
  held until it lasts two minutes; if the list recovers first, nothing is recorded and that
  exact snapshot is remembered and never applied.
- **Honest history.** Each opening is stored with the window it happened in (previous check to
  this check), so times are accurate to about 30 seconds and the API marks anything less
  certain. Sections already open when tracking began never count as openings.
- **Restart-safe.** The open set lives in the database, so a restart resumes where it left off.

## What it never does

RU SnipeZ never asks for a NetID and never registers for anyone. Alerts link to WebReg with the
index filled in, and the student signs in through CAS themselves.

## Stack

| Layer | Choice |
|---|---|
| Service | Python 3.12, asyncio, FastAPI, httpx |
| Data | PostgreSQL 17, SQLAlchemy 2 (async), Alembic |
| Website | React 19, TypeScript, Vite, TanStack Query, React Router |
| Tests | pytest against real PostgreSQL; Vitest and Testing Library |
| Delivery | Docker Compose, GitHub Actions, Vercel for the website |

```
src/rusnipez/
  core/       pure detection logic: set difference, change guard
  soc/        Rutgers API client, payload normalizer, term codes
  catalog/    catalog payload builder
  services/   poller, catalog sync, read queries, background workers
  db/         models and migrations
  api/        FastAPI app, routes, response schemas
web/          React website
legacy/v1/    the original Discord bot, for reference
```

## Run it locally

Requires Docker, Python 3.12 and Node 22 or newer.

```bash
docker compose up -d db
python -m venv .venv
.venv/Scripts/pip install -e ".[dev]"   # .venv/bin/pip on macOS and Linux
.venv/Scripts/rusnipez migrate
.venv/Scripts/rusnipez serve
```

The service fetches catalogs and starts polling immediately. API docs are at
<http://127.0.0.1:8000/api/docs>. In a second terminal:

```bash
npm --prefix web install
npm --prefix web run dev
```

Open <http://localhost:5173>. To run the service in a container instead, use
`docker compose up -d --build`.

The active terms are one setting, `RUSNIPEZ_ACTIVE_TERMS` (default `12027,02027`: Spring and
Winter 2027). See [`.env.example`](.env.example) and
[`settings.py`](src/rusnipez/settings.py).

## Tests

```bash
.venv/Scripts/pytest -q                        # needs `docker compose up -d db`
.venv/Scripts/ruff check src tests && .venv/Scripts/ruff format --check src tests
npm --prefix web run lint && npm --prefix web run typecheck && npm --prefix web test
```

CI runs all of it, plus a migration drift check and a Docker build, on every push and pull
request.

## License

[MIT](LICENSE)
