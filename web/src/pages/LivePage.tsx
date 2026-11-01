import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { useEvents, useMeta, useStats } from "../api/hooks";
import { Crosshair } from "../components/Crosshair";
import { DiscordCta } from "../components/DiscordCta";
import { EventFeed } from "../components/EventFeed";
import { HeroDevices } from "../components/HeroDevices";
import { StatTiles } from "../components/StatTiles";
import { dateTime, plural } from "../lib/format";
import { useNow, useTerm } from "../lib/hooks";

const SUGGESTIONS = ["Intro to computer science", "Calculus", "Expository writing", "Organic chemistry"];

const STEPS = [
  ["Watch a section", "Run /snipe with its index in Discord, or try the preview on the search page."],
  ["We keep checking", "Every Rutgers section, every 30 seconds, around the clock."],
  ["You register", "A DM arrives with a WebReg link that has the index filled in."],
] as const;

export function LivePage() {
  const { term, info, terms } = useTerm();
  const meta = useMeta();
  const stats = useStats(term, Boolean(term));
  const events = useEvents(term);
  const now = useNow();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");

  const searchFor = (q: string) => {
    const params = new URLSearchParams({ q });
    if (term && term !== terms[0]?.code) params.set("term", term);
    return `/search?${params}`;
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    navigate(searchFor(query.trim()));
  };

  return (
    <>
      <section className="hero">
        <div className="hero-copy">
        <p className="eyebrow">
          <span className="live-dot" aria-hidden="true" />
          Live{info?.name ? ` for ${info.name}` : ""}
        </p>
        <h1>Snipe your seat.</h1>
        <p className="hero-lead">
          RU SnipeZ checks every Rutgers course section every 30 seconds and messages you on Discord
          the moment a seat opens.
        </p>
        <form className="hero-search" role="search" onSubmit={submit}>
          <label className="visually-hidden" htmlFor="hero-q">
            Search courses
          </label>
          <input
            id="hero-q"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Course, instructor or index"
            autoComplete="off"
            spellCheck={false}
          />
          <button type="submit">Search</button>
        </form>
        <p className="hero-chips">
          <span>Try</span>
          {SUGGESTIONS.map((q) => (
            <Link key={q} to={searchFor(q)}>
              {q}
            </Link>
          ))}
        </p>
        </div>
        <HeroDevices events={events.data?.events} now={now} />
      </section>

      {stats.isError && (
        <p role="status" className="caption">
          Figures could not refresh. {stats.data ? "Last known values are shown." : "Figures are unavailable."} Retrying automatically.
        </p>
      )}
      <StatTiles key={term} stats={stats.data} now={now} pollSeconds={meta.data?.pollSeconds ?? 30} error={stats.isError} />
      {info && (
        <p className="caption">
          {info.name ?? term} only, all campuses including off-campus locations
          {stats.data?.trackingSince &&
            ` · ${plural(stats.data.openingsTotal, "opening")} recorded since ${dateTime(stats.data.trackingSince)}`}
          .
        </p>
      )}

      <details className="metric-notes">
        <summary>What these numbers mean</summary>
        <p>
          Openings count detected closed-to-open section changes, not individual seats; the same
          section can reopen more than once. Sections already open when tracking began do not count.
          Rutgers reports availability, not seat counts; some open sections require special permission.
        </p>
        <p>
          The median uses completed intervals that closed in the last 7 days, with opening and
          closing each bounded by accepted checks no more than {(meta.data?.pollSeconds ?? 30) * 3} seconds apart.
          Still-open intervals and long gaps in checks
          are excluded. This can favor shorter intervals; it is a historical summary, not a forecast
          of how long your seat will last.
        </p>
        <p>
          Check counts exclude failed responses, and include responses whose suspicious changes were
          held back. Seat data age measures the last accepted update. Open sections can include
          indexes Rutgers has not added to its catalog yet; sections tracked counts catalog entries.
        </p>
      </details>

      <section className="panel" aria-labelledby="feed-title">
        <div className="panel-head">
          <h2 id="feed-title">
            <Crosshair className="title-mark" />
            Latest changes{info?.name ? ` · ${info.name}` : ""}
          </h2>
          <span className="caption">Updates every 15 seconds</span>
          <p className="panel-note">
            The 40 most recent openings and closings in this term, newest first, across every
            campus. Times show when a change was detected, usually within {meta.data?.pollSeconds ?? 30} seconds;
            ~ marks a change detected after a gap in accepted checks.
          </p>
        </div>
        {events.isError ? (
          <p className="empty">The live feed is unavailable right now. Retrying automatically.</p>
        ) : events.data && term ? (
          <EventFeed events={events.data.events} term={term} />
        ) : (
          <div className="skeleton-list" aria-label="Loading" />
        )}
      </section>

      <section aria-labelledby="steps-title">
        <h2 id="steps-title" className="section-title">
          How a snipe works
        </h2>
        <ol className="how-steps">
          {STEPS.map(([title, text]) => (
            <li key={title}>
              <strong>{title}</strong>
              <span>{text}</span>
            </li>
          ))}
        </ol>
      </section>

      <DiscordCta />
    </>
  );
}
