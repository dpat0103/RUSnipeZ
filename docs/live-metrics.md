# Live page metrics

All tiles and the latest-changes feed on `/` follow the term selected in the header
(`?term=12027` for Spring 2027, `?term=02027` for Winter 2027). The page requests
`GET /api/v1/terms/{term}/stats`; its query-cache key includes the term. The existing
`GET /api/v1/stats` remains an aggregate for service-wide consumers and the bot.

## Definitions

| Metric | Calculation and limits |
| --- | --- |
| Open right now | Count current `openings` rows (`closed_at IS NULL`) for the selected term, including indexes not yet cataloged. The unique current-opening constraint prevents duplicate indexes within a term. This is the last accepted Rutgers snapshot, not a seat count or registration guarantee; special permission may still be required. |
| Openings detected in 24 hours | Count observed closed-to-open transitions detected in `(now - 24h, now]`. Baseline sections (`open_detected_after IS NULL`) are excluded. Repeat openings of one section each count. An outage can widen the observation window; the metric counts detections, not an assertion that every actual opening happened inside the last day. |
| Median open duration | Median of `closed_at - opened_at` for completed intervals closed in `(now - 7d, now]`, in this term. Both boundaries must be observed within three poll intervals of their preceding accepted check. Baselines, ongoing intervals, invalid durations and wide observation gaps are excluded. Show an approximation and sample count. |
| Checks in 24 hours | Successful Rutgers responses (`ok` and `held`) completed in `(now - 24h, now]`. Failed responses are excluded. At the default cadence, `24 × 60 × 60 ÷ 30 = 2,880` per term; two terms total 5,760. This is a target, not a fabricated count: failures, backoff, downtime and request duration may reduce it. |
| Sections tracked | Unique section rows in this term's currently synced catalogs, across NB, NK, CM and aggregated OC locations. It can differ from the open count because Rutgers sometimes opens indexes before listing them. |
| Seat data age | Time since the last **accepted** (`ok`) poll. A held response counts as a check but does not make older availability fresh. Delayed or failed refreshes label availability as the last update. |
| Alert tiles, when present | Deliveries, check-to-delivery median and self-reported “I got in” counts joined through openings for this term, never totals from the other semester. |

The seven-day median is retained because long-open outliers can overwhelm an average,
and a single day often has too few completed intervals outside registration week. It is
a description of completed history, not a prediction: excluding intervals still open
can favor shorter durations. A sample count, approximation marker and expandable
explanation make that limitation visible. A survival-analysis estimate would answer a
different question and require more evidence before presenting a prediction to students.

Public uptime was removed. The old value measures minutes with at least one response,
not server availability or the freshness of accepted seat data. Seat data age is more
useful when deciding whether to trust a displayed opening. The legacy uptime field stays
in the aggregate API for existing consumers.

## Consistency and presentation

- Stats HTTP requests use a PostgreSQL repeatable-read snapshot so an in-flight poll
  cannot change the counters between their reads and their observation timestamp.
- Term changes use separate query entries and show loading rather than the previous
  semester's numbers. Metric counts are displayed directly without intermediate animation values.
- `terms.tracking_started_at` preserves the first accepted observation after poll logs
  are pruned. Migration `0004` backfills from the earliest surviving accepted poll or
  opening evidence. A pruned empty baseline cannot be reconstructed exactly; the
  migration uses available evidence and subsequent tracking starts are retained exactly.
- Latest changes already filter and join on term and index together. Tie ordering is
  deterministic. All older dates and timestamp tooltips use America/New_York with EST/EDT.
- Feed time and index columns size to their contents on desktop; mobile uses separate
  rows. Long dates wrap instead of colliding. Example device illustrations are explicitly
  labeled when the selected term has no named openings to illustrate.
- Browser refreshes occur every 15 seconds; Rutgers checks normally occur every 30
  seconds. CDN caching and request time add delay. Times describe detections, not exact
  registration events.

## Deployment and verification

Deploy the backend with `rusnipez migrate` before deploying the frontend, because the
new term stats route and response fields must exist. The Compose image runs migrations
on startup. There is deliberately no fallback that silently substitutes aggregate data.

Regression coverage includes reused indexes across terms, independent catalog and
opening counts, rolling-window boundaries, 2,880 daily checks, held/failed responses,
completed-duration samples, legacy migration backfill, tracking after retention,
semester changes, error states and Eastern dates across daylight-saving time.

For local database tests, use a disposable PostgreSQL database: test fixtures reset its
schema. Never point them at production. Responsive review uses synthetic local fixtures
with old dated events as well as recent relative timestamps.

### Production cross-check, November 1, 2026

At approximately 12:46 PM Eastern, independent read-only requests to Rutgers'
`openSections.json` and the deployed site's open sets, catalogs and latest events found:

| Term | Open sections (Rutgers and site agree) | Unique catalog sections | Openings detected in preceding 24h |
| --- | ---: | ---: | ---: |
| Spring 2027 | 15,387 | 15,620 | 0 |
| Winter 2027 | 206 | 233 | 1 |
| Combined | 15,593 | 15,853 | 1 |

Both public event responses extended past the 24-hour cutoff, so the event counts
cover that window. There were no differing indexes between Rutgers and either stored
open set at this check. The deployed aggregate showed 5,758 successful checks across
the two terms versus a 5,760 target. These are point-in-time observations; automated
fixtures verify the calculations separately from changing production data.

Local validation: 168 Python tests and 76 frontend tests passed; Ruff, ESLint,
TypeScript, migration drift and production builds passed. A Docker image built
successfully. Browser checks found no horizontal overflow or index/time intersections
at widths 320, 375, 760 and 1280 pixels.
