# Opening history and fast snapshot delivery

## Architecture

The site remains static HTML/CSS/JavaScript on Vercel. A Cloudflare Durable Object checks Rutgers approximately every 30 seconds, atomically writes an SQLite event log and summaries, and publishes `snapshots/92026.json` to a private R2 bucket. The public Worker `/api/snapshot` only streams that object; it never starts collection, reads SQLite, or calls Rutgers. The Vercel edge adapter streams the same response through Vercel's CDN. `/api/history` remains a compatibility alias.

The browser requests the catalog and snapshot concurrently. As soon as the catalog arrives it renders searchable courses; status and history fill in independently. A five-second snapshot timeout leaves the catalog usable. Before a snapshot arrives, seat status is unknown rather than falsely closed. Repeat and older cached snapshots never duplicate alerts or roll the page back.

No purchased domain is required. Vercel's existing URL and CDN handle delivery. On a CDN miss, the thin edge adapter still executes and reads a stored R2 object; this avoids Rutgers/database initialization in the visitor path, but does not guarantee zero network or runtime latency. Production first-visit timing must be measured after deployment.

## Production setup

1. Sign in to Cloudflare with `npx wrangler login` from `worker/`. Enable R2 on that account yourself. R2 requires a subscription and charges beyond its free allowances; local testing requires neither sign-in nor billing activation.
2. Create the private bucket with `npx wrangler r2 bucket create ru-snipez-snapshots`. Do not enable public bucket access. `worker/wrangler.toml` already binds it as `SNAPSHOTS`, configures SQLite storage, active terms, and a minute-level watchdog cron.
3. Run `npx wrangler deploy` from `worker/`. The cron arms the collector without any visitors; the alarm performs collection and publication. Wait for `/api/snapshot?term=92026&campus=NB` on the deployed Worker to return JSON with `schemaVersion: 2` and an advancing `checkedAt` before connecting the frontend.
4. Set `HISTORY_API_BASE` in Vercel to the Worker origin, e.g. `https://ru-snipez-api.your-subdomain.workers.dev`, and redeploy the site. The frontend uses its own `/api/snapshot` route, so no custom domain, browser CORS configuration, or CSP change is required. Cloudflare Pages uses the same environment variable and adapter.
5. Publish repository changes to GitHub so the repaired catalog/CI workflows take effect. The daily catalog workflow still uploads artifacts; it does not automatically replace the website's bundled catalog or deploy it.

Cloudflare's Worker Cache API is an additional cache when the Worker has a supported custom domain/route. Do not rely on it for a `workers.dev` deployment; Vercel's CDN is the primary cache in this setup. Successful snapshots use `max-age=5, s-maxage=15, stale-while-revalidate=60`. Errors use `no-store`. Retaining an older response keeps the UI responsive during failures; the page labels data delayed when the successful observation is over 90 seconds old.

For a purely static host, the `api-base` meta tag can point to the Worker; allow that origin in the host's CSP. That path has no Vercel CDN cache unless the host supplies one. A custom domain/CDN can be added later.

## Local development

From `worker/`:

```bash
npx wrangler dev --port 8790
```

Trigger the local watchdog (Wrangler does not automatically run cron locally):

```bash
curl http://127.0.0.1:8790/cdn-cgi/local/scheduled
```

From the repository root, in PowerShell:

```powershell
$env:HISTORY_API_BASE = "http://127.0.0.1:8790"
.venv\Scripts\python scripts/devserver.py
```

Open `http://localhost:8788`. Wrangler emulates both SQLite Durable Objects and R2 locally, with persistent state under its ignored `.wrangler/` directory. No cloud resources are created by local tests or `wrangler deploy --dry-run`. Without the Worker connection, courses remain searchable and status/history are clearly marked unavailable.

## Stored data and observation semantics

- One object per configured term. Rutgers returns university-wide indexes; each campus view intersects those indexes against its own catalog. `HISTORY_TERMS` is an explicit allowlist. Remove retired terms to stop alarms; their SQL history remains stored.
- `events` is an append-only log of `opened`, `closed`, and collection `gap` observations. Each row includes its detection time and the preceding successful check; closures include an approximate duration only when both ends were observed continuously. An index/time SQL index supports future history queries.
- `openings` stores each section's latest opening/closure, observed opening count, count of completed continuous observations, summed duration, and last duration. The snapshot exposes those summaries and the current open-index set, rather than sending the raw event log to every visitor.
- Summary JSON is stored in at most 100 indexed chunks. Publication reads these compact rows rather than scanning thousands of SQL section rows on every poll. Only changed summaries are rewritten. Existing v1 data migrates without losing timestamps or inventing old events.
- The first valid response is a baseline, not a set of opening events. Already-open seats have unknown opening times. Duplicate snapshots/retries and timestamps older than the committed snapshot are ignored.
- Failures, malformed responses and timeouts preserve the last good state. A gap longer than 90 seconds re-establishes the baseline and invalidates active duration measurements. Such durations are excluded from the average. Openings shorter than the check interval or during outages can be missed.
- All event writes, summary changes and the open-state snapshot commit atomically. R2 publication happens afterward; failed publication is retried separately, including when the next Rutgers check fails. Republishing old observations does not change `checkedAt` or pretend the data is fresh.
- Detection times and durations are observations, not exact registrar timestamps. Upstream caching and sampling introduce uncertainty. The UI uses Eastern time and shows tracking start, recorded openings, last closure, and average observed time open in expanded details. No identities or watchlists are stored in the backend.

## Verification

```bash
npm test
pytest -q
ruff check src tests scripts/devserver.py
ruff format --check src tests scripts/devserver.py
```

Node 24 tests use real SQLite with a Durable Object adapter and mocked R2/network calls. They cover migrations, atomic rollback, repeat events, closures, gaps, duration metrics, failed publication recovery, cache/CORS behavior, stored snapshot streaming without an available collector, and parallel initial rendering with a deliberately stalled snapshot.

Local Wrangler smoke tests verify actual SQLite migration, alarm execution, R2 publication and reading. Production verification should additionally check fresh/empty CDN caches, advancing timestamps with no visitors, and first-visit catalog and snapshot timings on a mobile connection.
