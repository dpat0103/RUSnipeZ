<div align="center">
  <img src="RU_snipeZ_logo.png" alt="RU SnipeZ" width="150" />
  <h1>RU SnipeZ</h1>
  <p><strong>Live open-seat monitor for Rutgers course sections.</strong><br>
  Search 16,371 sections across all three campuses, see what's open right now, and get a WebReg link with the index already filled in.</p>
  <p>
    <img alt="Python 3.12" src="https://img.shields.io/badge/python-3.12-3776AB?logo=python&logoColor=white">
    <img alt="tests" src="https://img.shields.io/badge/tests-43%20passing-3DD68C">
    <img alt="license" src="https://img.shields.io/badge/license-MIT-blue">
  </p>
</div>

---

> **Live demo:** _not deployed yet_ — `npx wrangler pages deploy web` (see [Deploy](#deploy))

## What it does

Rutgers publishes an unauthenticated list of currently-open section indexes, and WebReg accepts a registration index pre-filled in the URL. The entire value of this project is closing the gap between *"a seat opened"* and *"you have a registration form loaded."*

```
                    ┌─ courses.json (930 KB, daily) ──► CI build ──► static catalogue (CDN)
Schedule of Classes ┤
                    └─ openSections.json (26 KB, live) ──► edge proxy (30 s cache) ──► diff vs. previous set
                                                                                            │
                                                                         newly opened ──────┴──► alert + WebReg link
```

The diff is what makes it **edge-triggered**: a section that was already open doesn't re-announce itself. V1 needed a per-user ten-minute cooldown to suppress repeats; comparing against the previous set removes the need for one.

## Why the data is split

| Data | Where it lives | Refresh |
|---|---|---|
| Catalogue — titles, professors, meeting times, 4.8 MB | **Stored** as static JSON on a CDN | Rebuilt daily by CI |
| Open/closed status — 26 KB | **Polled** through the edge proxy | Every 30 s, edge-cached |

The page isn't re-downloading 4.8 MB every thirty seconds — it fetches a small array of index numbers and diffs it in memory. Measured: **27 ms** to parse the catalogue once, **2 ms** per poll diff across 11,444 indexes.

## Findings on the undocumented API

Rutgers publishes no API documentation. These were established by inspection, and each one changed a design decision.

- **`courses.json` ignores its own `subject` parameter.** One request returns the entire campus catalogue. V1 drove a headless Chrome across fifteen school pages, sleeping ten seconds each, to scrape a *subset* of the same data out of rendered HTML — data the page had itself fetched as JSON moments earlier. [That pipeline is gone.](legacy/v1/)
- **Index numbers are recycled between terms.** 3,059 Spring 2025 indexes reappear in Fall 2026 attached to different courses. Stored history must be scoped per term or it corrupts at every rollover — which is exactly what V1's `last_opened_sections.csv` did, silently.
- **Cross-listed sections open independently.** Of 970 cross-listed pairs in Fall 2026, **254 are currently split** — one index open, its twin closed. Watching one doesn't cover the other.
- **24% of sections require a special permission number** (2,902 of 12,004 in New Brunswick). An open seat there isn't registrable without departmental approval, so they're badged rather than treated as a normal opening.
- **No CORS headers**, so a browser can't call the endpoints directly — hence the proxy. **`Cache-Control: max-age=30`** sets the floor on useful polling. An `ETag` is sent but `If-None-Match` is ignored, so conditional requests buy nothing.
- **Titles are aggressively abbreviated.** Expository Writing is filed as `COLLEGE WRITING`; you'll also find `MICROBIOL HLTH SCI`. Exact matching returns nothing for the names students type, so search is relevance-ranked instead.

## Search

Tokens are scored independently across index, code, title, instructor and subject; abbreviations are expanded into the searchable text; stopwords are dropped; ties break toward courses offering more sections.

| Query | Top result |
|---|---|
| `expository writing` | `01:355:101` COLLEGE WRITING (109 sections) |
| `microbiology health science` | `01:119:131` MICROBIOL HLTH SCI |
| `intro to computer science` | `01:198:111` INTRO COMPUTER SCI (63 sections) |
| `10052` | `01:013:120` LITERARY EGYPT |

Dropping stopwords mattered more than it looks: before that, `intro to computer science` ranked *Introduction to Data Science* first, purely on the word "to".

## Run it locally

```bash
pip install -e ".[dev]"
```

```bash
python -m rusnipez.catalog.build --term 92026 --campus NB
```

```bash
python scripts/devserver.py
```

Then open <http://localhost:8788>. The dev server serves `web/` and mirrors the production `/api` routes, so no Cloudflare account is needed to develop against live Rutgers data.

## Deploy

Static files plus two Pages Functions, so one command ships everything:

```bash
npx wrangler pages deploy web --project-name ru-snipez
```

`web/functions/api/*` runs the proxy on the **same origin** as the page, so the browser never makes a cross-origin request and CORS stops being a concern. The standalone [`worker/`](worker/) is the alternative for hosting the frontend elsewhere. The free tier covers 100,000 requests/day, and because responses are cached 30 s at the edge, visitor count doesn't translate into upstream load.

## Layout

```
src/rusnipez/soc/      term encoding, async API client, payload normalizer
src/rusnipez/catalog/  catalogue builder CLI
web/                   the demo — static frontend + Pages Functions
worker/                standalone Cloudflare Worker (alternative to Pages Functions)
scripts/devserver.py   local server mirroring the production /api contract
tests/                 43 tests over the normalizer and term encoding
legacy/v1/             the original Discord bot, archived
```

## Development

```bash
pytest -q
```

```bash
ruff check src tests && ruff format --check src tests
```

CI runs ruff, pytest and `pip-audit` on every push. A second workflow rebuilds the catalogue daily across all three campuses and refuses to publish a truncated one.

## Roadmap

Built: catalogue pipeline, API client, normalizer, edge proxy, live web demo.

Next, in order:

1. **Always-on polling engine** — so alerts fire with the tab closed. Currently the browser does the polling, which means the demo only watches while it's open.
2. **Web Push** — free, no account needed, the first real notification channel.
3. **Persistent last-opened history** — needs the poller above plus a per-term store, for the reason in the findings section.
4. **Cross-listing prompt** — "you're watching 10052, its twin 10053 opens separately."
5. **Core-code watching** — *"alert me when any section satisfies my remaining HST requirement."* Inverts the product: students stop needing to know which index they want.
6. **Discord notifier** — re-pointed at the new core, so the existing bot becomes one sink among several rather than the whole application.

## Scope

RU SnipeZ **notifies**. It does not register for you, and it never asks for, stores, or transmits a NetID or password — you authenticate to WebReg through CAS yourself. That's a design constraint, not an unfinished feature.

## License

[MIT](LICENSE)
