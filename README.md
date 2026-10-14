<div align="center">
  <img src="RU_snipeZ_logo.png" alt="RU SnipeZ" width="150" />
  <h1>RU SnipeZ</h1>
  <p><strong>Live open-seat monitor for Rutgers course registration.</strong><br>
  Search sections across all three campuses, see when a section last opened, watch the ones you need, and get a WebReg link with the index already filled in when an opening is observed.</p>
  <p>
    <a href="https://ru-snipez.vercel.app"><strong>ru-snipez.vercel.app</strong></a>
  </p>
  <p>
    <img alt="Python 3.12" src="https://img.shields.io/badge/python-3.12-3776AB?logo=python&logoColor=white">
    <img alt="tests" src="https://img.shields.io/badge/tests-43%20passing-3DD68C">
    <img alt="license" src="https://img.shields.io/badge/license-MIT-blue">
  </p>
</div>

---

## The problem

Rutgers course registration rewards whoever happens to be watching. Sections fill in the first hour of enrollment, most have no waitlist, and when a spot opens back up, it goes to whoever refreshes WebReg at exactly the right second. During registration week that means checking a five digit index number by hand, over and over, sometimes at three in the morning, for days.

I was doing that for my own schedule and it was obviously a problem a computer should solve. Rutgers already publishes which sections are open, as an unauthenticated JSON endpoint anyone can call. Nobody was watching it for me. So I built something that would.

## What I built

**RU SnipeZ started as a Discord bot that watched course sections and messaged you when a seat opened.** You gave it an index, it polled the registrar, and when your section freed up you got a direct message with a button that opened WebReg with the index already typed in. It shipped to a real Discord community and people used it to get into classes. That original implementation is now archived in `legacy/v1/`; the maintained application is the website and its background collector.

<p align="center">
  <img src="docs/screenshots/snipe_command.png" width="49%" alt="Setting a watch with the /snipe command">
  <img src="docs/screenshots/sample_noti.png" width="49%" alt="The alert that arrives when a seat opens">
</p>

`/snipe 10052` starts watching an index. `/check` lists what you're watching, `/remove` drops one, `/clear` empties the list. That's the whole interface, because the whole point is to need it as little as possible.

## Why there's also a website

A Discord bot is a bad thing to put in front of someone who isn't already in your server. So I rebuilt the monitor as a live site anyone can open and try immediately, no account, no server invite.

**[ru-snipez.vercel.app](https://ru-snipez.vercel.app)** is that site, and it runs on real data. Search the catalogue and press **Watch** to preview an alert with the section details and a link into WebReg. The same website alert appears when a watched opening is detected while the page is running.

<p align="center">
  <img src="docs/screenshots/site-monitor.png" width="100%" alt="The live monitor, searching real Fall 2026 sections">
</p>

<p align="center">
  <img src="docs/screenshots/site-alert.png" width="49%" alt="The alert card for a section that just opened">
  <img src="docs/screenshots/site-detail.png" width="49%" alt="A section expanded for exam date, prerequisites and meeting location">
</p>

Filter by meeting day, campus location or core requirement code, sort by open seats or best match, and share any search as a URL. Click a section to expand it into exam date, prerequisites, the full meeting pattern and a copyable index.

<p align="center">
  <img src="docs/screenshots/site-about.png" width="100%" alt="The About page explaining what the site is">
</p>

## How the detection actually works

### Last-opened history

Section rows, expanded details and the watchlist show the last **observed closed-to-open transition**, in Eastern time. Expanded details also show the number of recorded openings, last closure, and average observed time open. A SQLite-backed Cloudflare Durable Object collects the university-wide open set approximately every 30 seconds, independently of visitors, and records openings, closures, and collection gaps by term and index. The campus catalog determines which indexes appear on each campus view. A minute-level cron starts the collector after deployment and restores its alarm if needed.

The collector publishes a compact status/history snapshot to private Cloudflare R2 storage. Vercel's CDN serves it through `/api/snapshot`; visitors never wait on Rutgers or query the historical database. The browser requests the catalog and snapshot together and renders courses as soon as the catalog arrives. No purchased domain is needed.

History starts at the collector's first successful check; it cannot reconstruct past openings from Rutgers. The first snapshot establishes a baseline without inventing opening times for seats already open. Failed or malformed responses leave the last good snapshot intact; after a gap longer than 90 seconds, the collector establishes a fresh baseline. Timestamps are observations between checks, not exact registration times. Missing records do not mean a section never opened. See [history setup](docs/seat-history.md) to enable shared collection on your deployment.

The endpoint Rutgers exposes, `openSections.json`, returns a flat array of every currently open index. The naive approach is to check that array on a timer and fire a notification whenever your section appears in it, which means firing again on the next check, and the one after that, for as long as the seat stays open. V1 solved that with a ten minute cooldown per user, tracked in memory, which meant a bot restart during registration week could re-notify everyone whose sections happened to be open at that moment.

The actual fix was to stop asking a yes or no question and start computing a difference instead. Every cycle keeps the previous open set, subtracts it from the new one, and only what's left over is news:

```
                    ┌─ courses.json  (daily)  ──► catalogue build ──► static file on a CDN
Schedule of Classes ┤
                    └─ openSections.json (30s) ──► background collector
                                                  │ new − previous = openings
                                                  ▼
                                             SQLite history ──► R2 snapshot ──► CDN
                                                                                │
                                         open browser: compare snapshots ◄───────┘
                                                  │ watched opening
                                                  ▼
                                         alert + pre-filled WebReg link
```

A section that was already open is not in that difference, so it produces no event and needs no cooldown to suppress. The correctness comes from the shape of the computation, not from a rule bolted on to patch a symptom.

The 30 second interval isn't arbitrary either. Rutgers' own response declares `Cache-Control: max-age=30`, meaning any cache between here and the registrar might already be serving something up to 30 seconds old. Polling faster than that can't surface anything sooner, it just makes more requests that cannot possibly contain news. Matching the interval to what the server actually promises keeps detection at its real floor.

## What building this actually surfaced

Rutgers doesn't publish documentation for these endpoints. Everything below came from reading real responses, and each one changed something in the design.

**Two endpoints ignore the parameters they accept.** `courses.json` takes a `subject` filter and returns the entire campus catalogue regardless, which is good news since it means the whole catalogue is one request instead of one per department. `openSections.json` takes a `campus` filter and does the same thing in reverse: it returns every open section university-wide no matter which campus you ask for. That one cost real correctness until I caught it, because the demo's headline "sections open" counter was reading 11,444 on the Camden page, which is New Brunswick's number, not Camden's. Fixed by intersecting the response against the catalogue actually loaded for that campus, since that's the only list that knows what belongs where.

**Index numbers get reused across terms.** 3,059 index numbers valid in one recent term are also valid in a different term entirely, attached to unrelated courses. An index by itself is not a stable identifier for history across semesters, so the shared collector isolates each term in its own Durable Object and stores history by index within that term. Campus membership comes from the catalog. Browser watchlists store only indexes locally, so they need review when changing terms.

**Cross-listed sections have separate seat pools.** A class taught once but listed under two departments gets two index numbers, and they open and close independently. In a Fall 2026 snapshot, 254 of the 970 cross-listed pairs were in a split state, one side open and the other closed. Watching only one side can miss an opening, so the alert offers to add other cross-listed indexes present in the loaded campus catalog.

**A quarter of sections aren't actually registrable when they open.** In the Fall 2026 catalog, 2,902 of 12,004 New Brunswick sections carry a special permission requirement, meaning an open seat still needs department sign-off before you can add it. The site marks these with an SPN badge, includes the restriction in details and alert cards, and offers a filter to hide them. Watched SPN sections still trigger opening alerts.

**Course titles are written in a shorthand nobody types.** Expository Writing exists in the catalogue as `COLLEGE WRITING`. Chemistry courses show up as `ADV ORGANIC CHEM I`. A search box that only does exact substring matching returns nothing for the name a student actually knows, so search here scores tokens independently across title, code, instructor and subject, expands common abbreviations before matching, and ranks by relevance instead of requiring every word to hit.

| Someone searches for | And actually finds |
|---|---|
| `expository writing` | `01:355:101` COLLEGE WRITING |
| `microbiology health science` | `01:119:131` MICROBIOL HLTH SCI |
| `intro to computer science` | `01:198:111` INTRO COMPUTER SCI |
| `10052` | `01:013:120` LITERARY EGYPT |

## Where the product stops on purpose

The obvious next feature is automatic registration: skip the alert, skip the click, just enroll the student the second the seat opens. That requires holding a Rutgers NetID and password for every user, which turns a small utility into custody of thousands of university logins. That's a liability no convenience justifies, and it's also very likely the fastest way to get a project like this shut down by the university it depends on.

So the boundary is fixed: RU SnipeZ detects the opening and delivers the alert with the index already filled in. The student clicks through and signs in to WebReg through CAS themselves, exactly as they always would. It costs a few seconds. It also means there is no credential store here to secure, to breach, or to be trusted with in the first place.

## How it's built

Static frontend, background collector, and thin delivery adapters:

```
src/rusnipez/soc/      term encoding, async API client, payload normalizer
src/rusnipez/catalog/  catalogue builder; daily CI rebuilds across all three campuses as artifacts
web/                   the site itself: static HTML/CSS/JS, no framework, no build step
lib/                   Request/Response helpers for SOC, history and snapshot delivery
api/                   Vercel edge adapters, including the site's /api/snapshot route
worker/                Cloudflare collector, SQLite event log, R2 publication and snapshot delivery
scripts/devserver.py   a local server that mirrors production so development needs no cloud account
tests/                 Python normalization/term tests; Node history, snapshot and frontend tests
legacy/v1/             the original bot, kept for reference
```

The frontend has no framework: the application renders a filtered catalog and checks prepared snapshots every 30 seconds. Course data is compiled into static files and served from a CDN. Daily CI builds upload catalog artifacts; updating the site's bundled catalogs and deploying them is still a separate step. The background Worker owns the SQLite event log and publishes R2 snapshots; thin Vercel and Pages adapters expose those stored snapshots on the site's own origin. SQL writes and live Rutgers requests stay out of the page-loading path.

Rutgers sends no CORS headers on either endpoint, so browsers cannot call them directly. The background collector fetches Rutgers server-side; the frontend reads stored snapshots through same-origin Vercel or Pages adapters. SOC proxy routes remain available for direct API access. The JavaScript HTTP handlers use the web platform's standard `Request` and `Response` types.

## Try it yourself

```bash
git clone https://github.com/dpat0103/RUSnipeZ.git
cd RUSnipeZ
pip install -e ".[dev]"
python -m rusnipez.catalog.build --term 92026 --campus NB --out web/data
python scripts/devserver.py
```

Then open `http://localhost:8788`. To enable live status/history, also run the local Worker and point `HISTORY_API_BASE` at it; [the local setup instructions](docs/seat-history.md#local-development) cover both terminals and the cron trigger. Wrangler emulates SQLite and R2 without a Vercel or Cloudflare account. The catalog remains searchable when snapshots are unavailable.

Use Node 24 for the Node tests, which exercise the built-in SQLite API.

```bash
pytest -q
ruff check src tests && ruff format --check src tests
node --test tests/*.test.mjs
```

CI runs Python and Node tests, lint and format checks on pushes to `main` and pull requests. It also runs a dependency audit, reporting findings as warnings. A second scheduled workflow rebuilds the catalogue daily, checks for truncated output, and uploads artifacts. It does not automatically update or deploy the website.

## Deploying your own copy

The catalog and frontend are static files. Live status and shared history also require the background Worker, its SQLite Durable Object and private R2 bucket, plus a snapshot route accessible to the frontend. Follow [history setup](docs/seat-history.md) to configure collection and delivery.

**Vercel:** deploy the Worker and configure `HISTORY_API_BASE` with its origin, then run `npx vercel --prod`. `vercel.json` points the static output at `web/`; `api/snapshot.js` forwards stored snapshots through Vercel's CDN. This is the architecture used by [ru-snipez.vercel.app](https://ru-snipez.vercel.app).

**Cloudflare Pages:** deploy the Worker and configure `HISTORY_API_BASE` for Pages, then run `npx wrangler pages deploy . --project-name ru-snipez` from `web/`. This makes `web/functions/` the [Pages project's Functions directory](https://developers.cloudflare.com/pages/functions/get-started/). Its API adapters provide the same-origin snapshot route; see [history setup](docs/seat-history.md) for configuration.

**A purely static host,** such as GitHub Pages, needs the deployed [`worker/`](worker/) with collection and R2 configured. Point the page at it with `<meta name="api-base" content="https://your-worker.workers.dev">`, allow the site's origin in the Worker's CORS settings, and permit the Worker origin in the host's CSP `connect-src` policy if one is set. Search and the catalogue still work without snapshots; live status and shared history do not.

## What's next

Shared history collection already runs in the background for configured terms: the Cloudflare Durable Object polls approximately every 30 seconds, and the cron watchdog keeps its alarm armed independently of visitors. Website alert delivery still requires an open, running tab. The browser compares snapshots and displays alerts for watched openings; optional desktop notifications use the page's `Notification` API. The next step is **Web Push**, with server-side watch subscriptions and a service worker, so alerts can reach students when the site is closed.

After that: a detailed opening timeline, a nudge to watch both sides of a cross-listed pair automatically, and letting a student watch a **core requirement** instead of an index, so they can ask for any open section that satisfies their remaining Historical Analysis credit without knowing in advance which course they want.

## License

[MIT](LICENSE)
