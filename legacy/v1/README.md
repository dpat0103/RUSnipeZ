# V1 archive

The original RU SnipeZ: a single-file Discord bot that polled the Schedule of
Classes API once a second and DM'd users a pre-filled WebReg link. It ran for a
student community through 2024.

Kept here for reference. **It is not maintained and should not be run** — the
token is a placeholder, the term is hardcoded to Spring 2025, and several bugs
documented below were never fixed.

## Why it was replaced

| V1 | V2 |
|---|---|
| Selenium + `chromedriver.exe` scraping 15 school pages, ~150 s per run | One `courses.json` request per campus, ~1 s |
| 7,224 sections (New Brunswick undergrad only) | 16,371 sections across all three campuses |
| `requests.get` blocking a 1-second async loop | Async client with keep-alive, polling at the 30 s the API actually promises |
| Flat JSON + CSV rewritten in full on every change | Static catalogue on a CDN, edge-cached live status |
| No tests, no CI, no error handling | 43 tests, ruff + pytest + pip-audit in CI |

## Known defects, left as they were

- `/testdm` uses a leaked loop variable and DMs an arbitrary user
- `on_message` creates watchlists as a `set`, which `/snipe` then calls `.append()` on
- `get_est_timestamp` subtracts a hardcoded 4 hours and labels the result "EST" — wrong half the year
- `utils.py` opens the log file with a trailing space in the filename; works only on Windows
- `last_opened_sections.csv` has no term column, and **index numbers are recycled between terms**, so the accumulated history silently corrupted at every rollover

That last one is why the V1 last-opened data was not carried forward: 3,059 of
its Spring 2025 indexes exist in Fall 2026 attached to completely different
courses.
