# ru-snipez-api

Edge proxy for the Rutgers Schedule of Classes API. Adds CORS headers (upstream
sends none, so browsers cannot call it directly) and caches responses for 30
seconds at the edge, matching upstream's own `max-age`.

## Endpoints

| Path | Upstream | Notes |
|---|---|---|
| `/api/open?term=92026&campus=NB` | `openSections.json` | ~26 KB array of open index strings |
| `/api/courses?term=92026&campus=NB` | `courses.json` | ~930 KB full catalogue |

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

Free tier covers 100,000 requests/day. Because responses are cached for 30s at
the edge, visitor count does not translate into upstream load.
