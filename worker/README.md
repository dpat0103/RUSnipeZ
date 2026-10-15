# ru-snipez-api

> The continuous history collector is retired. Collection and cron are disabled
> in `wrangler.toml`; saved snapshots remain readable during migration. The
> maintained website now uses daily GitHub Actions history and its own live SOC
> proxy. Follow [daily history setup](../docs/seat-history.md). The implementation
> below is retained for backup, migration and shutdown verification.

Edge proxy for the Rutgers Schedule of Classes API. Adds CORS headers (upstream
sends none, so browsers cannot call it directly) and caches responses for 30
seconds at the edge, matching upstream's own `max-age`.

## Endpoints

| Path | Upstream | Notes |
|---|---|---|
| `/api/open?term=92026&campus=NB` | `openSections.json` | ~26 KB array of open index strings |
| `/api/courses?term=92026&campus=NB` | `courses.json` | ~930 KB full catalogue |
| `/api/history?term=92026&campus=NB` | Prepared R2 object | Compatibility alias of `/api/snapshot` |
| `/api/snapshot?term=92026&campus=NB` | Prepared R2 object | Current open set and historical summaries; no Rutgers request or SQL query |

`term` is a 5-digit WebReg code (season digit first): `0` winter, `1` spring,
`7` summer, `9` fall. `campus` is `NB`, `NK` or `CM`. Both are validated against
allowlists — the proxy builds the upstream URL itself and forwards nothing the
caller sent.

## Develop and deploy

```bash
npx wrangler dev
```

```bash
npx wrangler deploy
```

The Worker also collects an SQLite event log with recurring Durable Object
alarms and publishes compact snapshots to the private `SNAPSHOTS` R2 binding.
`/api/history` is a compatibility alias of `/api/snapshot`; visitor reads never
start the collector or query SQL. Configure active terms with `HISTORY_TERMS`
and connect Vercel / Pages using `HISTORY_API_BASE`. Vercel supplies CDN caching
without requiring a custom domain. See [setup and observation
semantics](../docs/seat-history.md). Collection continues without visitors;
review your account's resource limits before deployment.
