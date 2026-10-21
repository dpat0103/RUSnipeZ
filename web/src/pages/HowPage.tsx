import { useSearchParams } from "react-router";
import { DiscordCta } from "../components/DiscordCta";
import { GITHUB_URL } from "../lib/config";

const VIEWS = [
  ["overview", "Overview"],
  ["engineering", "Engineering"],
] as const;
type View = (typeof VIEWS)[number][0];

export function HowPage() {
  const [params, setParams] = useSearchParams();
  const view: View = params.get("view") === "engineering" ? "engineering" : "overview";
  const select = (next: View) =>
    setParams(
      (current) => {
        const updated = new URLSearchParams(current);
        if (next === "overview") updated.delete("view");
        else updated.set("view", next);
        return updated;
      },
      { replace: true },
    );

  return (
    <article className="prose">
      <h1>How it works</h1>
      <div className="tabs" role="tablist" aria-label="Audience">
        {VIEWS.map(([value, label]) => (
          <button
            key={value}
            role="tab"
            id={`tab-${value}`}
            aria-selected={view === value}
            aria-controls={`panel-${value}`}
            className="tab"
            onClick={() => select(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${view}`} aria-labelledby={`tab-${view}`}>
        {view === "overview" ? <Overview /> : <Engineering />}
      </div>
    </article>
  );
}

function Overview() {
  return (
    <>
      <p className="lead">
        RU SnipeZ watches every Rutgers course section and tells students the moment a seat opens.
      </p>

      <h2>The problem</h2>
      <p>
        Popular sections fill in the first hours of registration, and most have no waitlist. When
        someone drops a class, the seat goes to whoever refreshes WebReg first. Students end up
        checking the same index number by hand, sometimes for days.
      </p>

      <h2>What RU SnipeZ does</h2>
      <ol className="steps">
        <li>
          <strong>Checks constantly.</strong> Every 30 seconds it asks Rutgers which sections are
          open, for every campus and every active term.
        </li>
        <li>
          <strong>Spots openings.</strong> A section that was full on one check and open on the next
          just opened.
        </li>
        <li>
          <strong>Alerts on Discord.</strong> Students watching that section get a direct message
          with a button that opens WebReg with the index already filled in.
        </li>
        <li>
          <strong>Keeps history.</strong> Every opening is recorded, so you can see how often a
          section opens and at what time of day.
        </li>
      </ol>

      <h2>What this website shows</h2>
      <ul>
        <li>
          <strong>Live:</strong> openings and closings as they are detected, plus totals.
        </li>
        <li>
          <strong>Search:</strong> any course or section, whether it is open right now, and its
          history.
        </li>
      </ul>
      <p>Alerts themselves happen on Discord, which students already have on their phones.</p>

      <h2>Reliable by design</h2>
      <p>
        Rutgers&apos; system sometimes returns an outdated list for about a minute, which would make
        thousands of sections look like they closed and reopened. RU SnipeZ recognizes this and
        ignores it, so students never get a false alert.
      </p>

      <h2>Privacy</h2>
      <p>
        RU SnipeZ never asks for a NetID or password and never registers for anyone. You click the
        link and sign in to WebReg yourself.
      </p>

      <DiscordCta compact />
    </>
  );
}

function Engineering() {
  return (
    <>
      <p className="lead">
        One Python service polls Rutgers, detects changes, stores them in PostgreSQL and serves a
        read-only API. This website and the Discord bot both read from it.
      </p>

      <h2>Architecture</h2>
      <pre className="diagram">{`Rutgers SOC API
  courses.json        catalog per campus     every 6 h
  openSections.json   every open index       every 30 s
          |
          v
+--------------------------------------------------------------+
| rusnipez service (one asyncio process)                       |
|                                                              |
|   catalog sync   -> catalogs, sections                       |
|   poller -> diff -> change guard -> openings, polls          |
|   FastAPI        -> /api/v1/*   read-only, CDN-cached        |
|   Discord bot    -> watches -> alert outbox -> DMs   (next)  |
+-------------------------------+------------------------------+
                                |
                          PostgreSQL 17

React website  --  GET /api/v1/*  -->  FastAPI`}</pre>
      <p>
        One process keeps a single source of truth for the open set, and one request per term
        serves every user, which is lighter on Rutgers than per-user polling.
      </p>

      <h2>Detecting an opening</h2>
      <p>
        <code>openSections.json</code> returns every open index for the university (about 15,000
        five-digit strings). Detection is a set difference against the stored open set:
      </p>
      <pre className="code">{`every 30 s, per active term:
  current  = fetch openSections.json
  previous = SELECT index FROM openings WHERE closed_at IS NULL
  opened   = current - previous
  closed   = previous - current
  if change_guard.holds(opened, closed): record poll "held"; stop
  INSERT INTO openings (index, opened_at, open_detected_after) ...  -- opened
  UPDATE openings SET closed_at, close_detected_after ...         -- closed
  INSERT INTO polls (status = 'ok', counts) ...                   -- one transaction`}</pre>
      <ul>
        <li>
          A section that stays open produces no event, so alerts need no cooldown and cannot repeat.
        </li>
        <li>
          The open set lives in the database (rows with <code>closed_at IS NULL</code>, enforced by a
          partial unique index), so a restart resumes instead of re-alerting.
        </li>
        <li>
          Rutgers caches the endpoint for 30 seconds. Polling faster cannot return newer data, so
          30 seconds is the floor for any tool.
        </li>
      </ul>

      <h2>The change guard</h2>
      <p>
        Rutgers&apos; endpoint is load-balanced, and one backend appears to serve a frozen old snapshot. In our
        first live run it appeared at 18:02, 18:17 and 18:32: every 15 minutes, for about a minute,
        4,308 sections vanished and 19 long-closed ones reappeared. A rule that confirms after two
        matching checks would have accepted it, because it lasted two checks.
      </p>
      <ul>
        <li>
          A poll whose changes reach <code>max(50, 2% of open sections)</code> is held.
        </li>
        <li>It is applied only if it persists for 120 seconds.</li>
        <li>
          If upstream recovers first, nothing is recorded, and the held snapshot&apos;s SHA-256
          fingerprint is remembered so that exact list is never applied again.
        </li>
        <li>Ordinary polls, with a handful of changes, are never delayed.</li>
      </ul>

      <h2>Timing and history</h2>
      <p>
        Each opening stores <code>opened_at</code> (the check that saw it open) and{" "}
        <code>open_detected_after</code> (the previous successful check), so the true opening time
        is known to lie in that window, usually 30 seconds. After an outage the window is wider and
        the API marks it imprecise. Sections already open on the very first check have no known
        opening time and never count as openings.
      </p>
      <table>
        <thead>
          <tr>
            <th>Metric</th>
            <th>How it is computed</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Openings, 24 hours</td>
            <td>Count of observed openings with <code>opened_at</code> in the last 24 hours</td>
          </tr>
          <tr>
            <td>Typically open for</td>
            <td>
              <code>percentile_cont(0.5)</code> of open duration over 30 days, precise rows only
            </td>
          </tr>
          <tr>
            <td>When it opens</td>
            <td>Openings grouped by hour of day in America/New_York</td>
          </tr>
          <tr>
            <td>Uptime</td>
            <td>Share of minutes with at least one successful check</td>
          </tr>
        </tbody>
      </table>

      <h2>Data model</h2>
      <table>
        <thead>
          <tr>
            <th>Table</th>
            <th>Holds</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>catalogs</code>
            </td>
            <td>Each term and campus catalog, gzipped, with a content-hash ETag</td>
          </tr>
          <tr>
            <td>
              <code>sections</code>
            </td>
            <td>One row per index for joins: course, section number, campus</td>
          </tr>
          <tr>
            <td>
              <code>openings</code>
            </td>
            <td>One row per opening, with both timing windows</td>
          </tr>
          <tr>
            <td>
              <code>polls</code>
            </td>
            <td>Every check: ok, held or error, with counts. Feeds uptime; kept 14 days</td>
          </tr>
        </tbody>
      </table>

      <h2>Search</h2>
      <p>
        Search runs in the browser. The campus catalog (11,276 sections for Spring 2027 New
        Brunswick, 293 kB gzipped) is downloaded once, cached by ETag, and indexed once: each course
        gets lowercase title, code, instructor and department strings, which takes about 12 ms.
        Every keystroke then scores all 4,546 courses in memory in 0.4 to 3 ms (measured on a
        laptop), and React renders only the current page of 20 courses.
      </p>
      <ol>
        <li>
          <strong>Tokenize</strong> the query on whitespace and drop stopwords such as
          &quot;to&quot; and &quot;the&quot;.
        </li>
        <li>
          <strong>Expand abbreviations</strong> in titles: Rutgers writes &quot;MICROBIOL HLTH
          SCI&quot;, so the indexed title also contains &quot;microbiology health science&quot;.
        </li>
        <li>
          <strong>Score each term</strong> against each field and keep the best: exact index 1000,
          course code 60, word start in the title 40, instructor 30, inside a title word 22,
          department 12. A course matching every term scores double.
        </li>
        <li>
          <strong>Order close results</strong> with small bonuses: the whole query as a phrase in
          the title (+50), undergraduate level (+8), and more sections (up to +7).
        </li>
        <li>
          <strong>Match all terms first.</strong> If any course matches every term, partial matches
          are dropped. Only when none do are partial matches shown, which is how
          &quot;expository writing&quot; still finds COLLEGE WRITING.
        </li>
      </ol>
      <p>
        It is substring matching, not regular expressions. The one regex,{" "}
        <code>\bterm</code>, only decides whether a match starts a word (&quot;chem&quot; in
        &quot;organic chemistry&quot;, 40) or sits inside one (&quot;biochemistry&quot;, 22).
        Running it client-side means no server round trip per keystroke and no search
        infrastructure to host.
      </p>

      <h2>API</h2>
      <table>
        <thead>
          <tr>
            <th>Endpoint</th>
            <th>Cache</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>GET /api/v1/meta</code>, <code>/stats</code>
            </td>
            <td>10 s</td>
          </tr>
          <tr>
            <td>
              <code>GET /api/v1/terms/:term/open</code>, <code>/events</code>
            </td>
            <td>10 s</td>
          </tr>
          <tr>
            <td>
              <code>GET /api/v1/terms/:term/history</code>, <code>/sections/:index</code>
            </td>
            <td>60 s</td>
          </tr>
          <tr>
            <td>
              <code>GET /api/v1/terms/:term/catalogs/:campus</code>
            </td>
            <td>5 min browser, 1 h CDN, ETag</td>
          </tr>
        </tbody>
      </table>
      <p>
        Responses are gzipped and validated by Pydantic models; the OpenAPI reference is at{" "}
        <a href="/api/docs">/api/docs</a>. Caching at the CDN means visitor traffic barely reaches
        the service.
      </p>

      <h2>Stack and testing</h2>
      <ul>
        <li>Python 3.12, asyncio, FastAPI, httpx, SQLAlchemy 2 (async), Alembic, PostgreSQL 17</li>
        <li>React 19, TypeScript, Vite, TanStack Query (polling and caching), React Router</li>
        <li>Docker Compose: the same stack runs locally and on a server</li>
        <li>
          pytest against a real PostgreSQL database, including replays of the stale-snapshot
          incident; Vitest and Testing Library for the website; GitHub Actions runs lint, types,
          tests, a migration drift check and a Docker build
        </li>
      </ul>
      <p>
        Source on <a href={GITHUB_URL}>GitHub</a>.
      </p>
    </>
  );
}
