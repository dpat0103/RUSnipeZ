# Daily last-seen-open history

## What is recorded

One daily GitHub Actions job fetches Rutgers' university-wide open-section list. It updates a JSON file keyed by term and section index. Each section stores `firstSeenOpen`, `lastSeenOpen`, and `daysSeenOpen`; dates use America/New_York, including daylight-saving changes. Sections missing from later snapshots retain their last positive observation. A same-day rerun can add observations but never counts the same section/day twice.

This does not establish when a seat opened or how long it stayed open. Openings entirely between samples are missed, and a missing record does not mean a section never opened. The UI says **Last seen open**, shows the last daily check, and omits the old transition counts and duration metrics. Live observations during a visit may supply a newer date with a `this visit` label; those observations are not written to shared history.

## Data and delivery

- `.github/workflows/history.yml` runs once daily at 13:43 UTC (09:43 Eastern during daylight-saving time, 08:43 during standard time), plus manual dispatches. Scheduled execution is best effort, not an exact-time guarantee.
- The workflow restores or creates the isolated `history-data` branch, takes one observation, and commits `history-TERM.json`. It never resets or force-pushes that branch. A failed fetch or invalid input leaves the prior published file intact. Workflow concurrency prevents overlapping publication.
- First publication can use `web/data/history-TERM.json` as a seed. The included Fall 2026 seed merges dated evidence from the retired collector with a real observation. Legacy opening counts are not converted into invented daily counts.
- The data branch contains an ignored-build `vercel.json` so publishing observations does not rebuild the whole app. Application code stays on its normal branch. Each successful day is a recoverable Git commit, rather than an expiring Actions artifact.
- `/api/history?term=02027` reads the public branch's JSON and caches it on Vercel for an hour, with a five-minute browser cache. It can serve saved data while refreshing after an upstream failure. The browser refreshes daily history hourly and flags observations older than 48 hours as delayed. `/api/snapshot` is a compatibility alias returning daily schema version 3.
- Live status and watched-opening alerts use `/api/open` every 30 seconds while a tab is open. History failure never suppresses live polling, and live API failure never changes the saved daily history. Catalog, live status and history requests start together; the catalog renders without waiting for either API.

This architecture needs no hosted database, R2 subscription, purchased domain or additional Cloudflare service. Standard GitHub-hosted runners are free for public repositories under GitHub's current policy; private repositories and larger runners have different allowances. Existing website-hosting limits still apply. See [Actions billing](https://docs.github.com/en/actions/concepts/billing-and-usage).

GitHub may delay/drop scheduled runs during heavy load and disables schedules in inactive public repositories after 60 days. The site retains old dates and displays a delayed-history message rather than inventing new observations. See [schedule behavior](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).

## Activate on GitHub and Vercel

1. Merge these changes into the repository's default branch. Scheduled workflows only run from that branch. The daily job uses the built-in `GITHUB_TOKEN` with `contents: write`; no personal token is needed. Repository/organization policies must permit that write permission and publication to `history-data`.
2. In GitHub, open **Actions → daily history → Run workflow**, with term `02027`. Confirm it succeeds and creates or updates `history-data/history-02027.json`.
3. Redeploy the updated website to Vercel. Remove the obsolete `HISTORY_API_BASE` environment variable. `HISTORY_REPOSITORY` defaults to `dpat0103/RUSnipeZ`; set it only for a public fork, in `owner/repo` format. This implementation reads public data without GitHub credentials.
4. Verify the site's `/api/history?term=02027` response has `schemaVersion: 3`, `sampling: daily`, and a valid `sampleDate`. Search for a section and verify **Last seen open** and the last daily check. Live status should update independently.
5. Confirm the Vercel integration skips data-branch builds. The data branch carries `ignoreCommand: exit 0`; if your project overrides that setting, configure its Ignored Build Step to skip `history-data`.

## Retiring the old Cloudflare collector

The checked-in Worker configuration now has `HISTORY_TERMS = ""` and `crons = []`. Deploying that configuration removes the watchdog; existing alarms stop on their next invocation. `SNAPSHOT_TERMS` keeps old stored snapshots readable during migration. Their `checkedAt` remains unchanged, so they cannot masquerade as fresh data.

The old published snapshot has been backed up locally at `data/cloudflare-history-92026.json` (ignored by Git), and its dated observations have been incorporated into the seed. The old SQL and R2 resources have not been deleted. They are no longer required by the new website; review the backup before deleting those resources or canceling the R2 subscription in your Cloudflare account. This migration does not automatically alter billing subscriptions.

## Local development

From the repository root in PowerShell:

```powershell
.venv\Scripts\python -m rusnipez.history.daily --term 02027 --out web/data/history-02027.json
.venv\Scripts\python scripts/devserver.py
```

Then open `http://localhost:8788`. The local server reads saved daily JSON and proxies live Rutgers status; no Cloudflare process or account is needed. An optional legacy import is supported with `--import-snapshot data/cloudflare-history-92026.json` when creating a new history file. Existing output takes precedence so a backup never overwrites newer observations.

## Verification

```bash
pytest -q
npm test
ruff check src tests scripts/devserver.py
ruff format --check src tests scripts/devserver.py
```

Tests cover same-day retries, positive observations, empty snapshots, date boundaries/DST, rejected stale or invalid writes, legacy import, independent live/history failures, parallel startup, and calendar-date rendering. An integration test executes the actual workflow's restore/publication shell steps against a disposable local Git remote, verifying first-run creation, subsequent restoration, and separation from application code. Retired collector tests remain as safeguards for its shutdown/migration code.
