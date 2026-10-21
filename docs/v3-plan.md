# RU SnipeZ v3 plan

Branch: `v3` (long-lived; merged into `main` at cutover). Budget: $0 now, a paid VPS later.

## Product

- **Discord is the product.** Students use the bot in one community server. It is free.
- **The website is the window into it.** A read-only live view of the same engine for anyone:
  the feed of openings, search with seat history, and how it works. No accounts, watches or
  alerts on the site.
- **One engine powers both.** The site never runs its own detection.

## Stack

| Layer | Choice | Why |
|---|---|---|
| Service | Python 3.12, FastAPI, httpx | Reuses the tested Rutgers client; async fits the poller and bot in one process |
| Database | PostgreSQL 17, SQLAlchemy 2 (async), Alembic | Industry standard; unique constraints prevent duplicate alerts; SQL percentiles for metrics |
| Website | React 19, TypeScript, Vite, TanStack Query, React Router | Widely recognized; polling queries and URL state built in |
| Bot | discord.py 2 | Mature slash commands, autocomplete and buttons; same process as the poller |
| Runtime | Docker Compose | The same file runs locally, on a free VM and on a paid VPS |
| CI | GitHub Actions | Lint, types, tests against real PostgreSQL, migration drift, Docker build |

Frontend packages are pinned one major version behind the newest (Vite 7, TypeScript 5.9,
React Router 7, ESLint 9) for API stability.

## Order of work

### 1. Core engine — done

- Settings: `RUSNIPEZ_ACTIVE_TERMS` is the only place terms are configured. Several terms are
  polled at once because registration windows overlap.
- Catalog sync every 6 hours per term and campus. Catalogs are stored gzipped for serving and as
  one row per section for joins. An unchanged catalog keeps its ETag; a rebuild with under half
  the stored sections is rejected as truncated.
- Poller: one `openSections.json` request per term every 30 seconds, exponential backoff on
  failure, every attempt logged in `polls`.
- Openings: one row per opening, with `open_detected_after` and `close_detected_after` bounding
  when each change happened. The open set is the rows with no `closed_at`, so restarts resume.
- Change guard, built from a real failure (see Findings): mass changes are held until they last
  two minutes, and reverted snapshots are fingerprinted and never applied.

### 2. Read API and website — done

API, all under `/api`, documented at `/api/docs`:

| Endpoint | Returns |
|---|---|
| `GET /health` | Database reachable |
| `GET /v1/meta` | Active terms, catalogs, last check, open counts |
| `GET /v1/stats` | Sections tracked, open now, openings (24h, total), uptime (24h) |
| `GET /v1/terms/{term}/open` | Current open set |
| `GET /v1/terms/{term}/events` | Latest openings and closings, with section details |
| `GET /v1/terms/{term}/history` | Last seen open and 7-day openings per section |
| `GET /v1/terms/{term}/sections/{index}` | Full history: medians, hour-of-day profile, recent openings |
| `GET /v1/terms/{term}/catalogs/{campus}` | Catalog, gzipped, with ETag |

Website pages: **Live** (stats, live feed, Discord call to action), **Search** (collapsible
course summaries, 20 per page, sort, filters in the URL, section history, Discord alert
preview), **How it works** (Overview and Engineering tabs). A **Discord preview** panel beside
the search results runs every planned bot command against live data and keeps a snipe list
(15 max) for the browser session only, so visitors can see the bot before it ships.

Search runs in the browser over the downloaded catalog: tokenize, expand Rutgers
abbreviations, score each term by field, keep courses matching every term when any exist,
then order by phrase, level and section count. Measured at 0.4 to 3 ms per keystroke for
4,546 courses.

### 3. Discord bot — next

- Same process and database as the poller. Guild commands in the community server.
- `/snipe <course or index>` with autocomplete, `/check`, `/remove`, `/clear`, `/lastopen`,
  `/course`, `/help`, `/status`, and owner-only `/admin` commands.
- Alerts: tables `users`, `watches` and an `alerts` outbox with a unique (watch, opening) key,
  so each opening alerts each watcher exactly once, across restarts and retries.
- DM embed with **Register**, **Snooze 1h**, **Stop watching**, **I got in**.
- Rate-limited dispatcher (oldest watches first) and a private-thread fallback when DMs are
  closed. Per-user watch limit, proposed at 15.
- Server channels: `#how-to`, `#bot-commands`, `#live-openings`, `#status`, `#support`, a
  private admin channel.
- Public stats gain alerts delivered and median open-to-DM latency.

### 4. Free public hosting

- Website: Vercel free tier (`vercel.json` is ready). Add a rewrite of `/api/(.*)` to the
  service's public URL once it exists, so the browser stays same-origin.
- Service and database: this Compose stack on an always-free VM. Oracle Cloud Always Free
  (Arm, generous) first; Google Cloud e2-micro as the fallback. Caddy in front for TLS.
- Backups: nightly `pg_dump` to S3-compatible storage (Cloudflare R2 or Backblaze B2 free tier).
- Monitoring: Sentry for errors, UptimeRobot on `/api/health`, bot errors to the admin channel.

### 5. Paid hosting, later

Copy the Compose stack to a ~$5/month VPS, restore the latest backup, switch DNS. No code
changes. Optionally buy a domain.

### 6. Cutover

Run v3 alongside the current site for at least a week, merge `v3` into `main`, point Vercel at
the new build, announce in the Discord server, archive the `history-data` branch.

## Findings

- **Rutgers serves stale snapshots.** On 21 Oct 2026, one backend twice served the same frozen
  list for about a minute, 15 minutes apart: 4,308 sections missing and 19 long-closed ones
  present (Winter: 77 missing). A guard confirming on two consecutive checks would have accepted
  it. This is why the guard waits two minutes and fingerprints reverted snapshots.
- **ETags vary per backend for identical content**, so they cannot be used to time polls.
- **No seat counts.** The public API reports open or closed only.
- **Spring 2027 (`12027`) catalogs were live by 21 Oct 2026**, alongside Winter 2027.
- **Responses are gzipped.** The full Spring New Brunswick catalog is 11,276 sections, 293 kB
  compressed.

## Later, not v3

Watching a whole course or core requirement, a paid tier (never charging for faster alerts),
signing in with Discord on the website, browser notifications.

## Open decisions

1. Is the original Discord server and bot application still available, with its token?
2. Should v1 watch data be migrated? It is likely for old terms.
3. Watch limit per user (proposed: 15).
4. Domain: free subdomains now, or buy one when moving to paid hosting?
