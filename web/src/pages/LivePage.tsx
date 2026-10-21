import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { useEvents, useStats } from "../api/hooks";
import { Crosshair } from "../components/Crosshair";
import { DiscordCta } from "../components/DiscordCta";
import { EventFeed } from "../components/EventFeed";
import { StatTiles } from "../components/StatTiles";
import { useNow, useTerm } from "../lib/hooks";

const SUGGESTIONS = ["Intro to computer science", "Calculus", "Expository writing", "Organic chemistry"];

const STEPS = [
  ["Watch a section", "Run /snipe with its index in Discord, or try the preview on the search page."],
  ["We keep checking", "Every Rutgers section, every 30 seconds, around the clock."],
  ["You register", "A DM arrives with a WebReg link that has the index filled in."],
] as const;

export function LivePage() {
  const { term, info, terms } = useTerm();
  const stats = useStats();
  const events = useEvents(term);
  const now = useNow(60_000);
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const termNames = terms.map((t) => t.name ?? t.code).join(" and ");

  const searchFor = (q: string) => {
    const params = new URLSearchParams({ q });
    if (term && term !== terms[0]?.code) params.set("term", term);
    return `/search?${params}`;
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    navigate(query.trim() ? searchFor(query.trim()) : "/search");
  };

  return (
    <>
      <section className="hero">
        <Crosshair className="hero-mark" />
        <span className="hero-sparkles" aria-hidden="true">
          {Array.from({ length: 6 }, (_, i) => (
            <span key={i}>+</span>
          ))}
        </span>
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
      </section>

      <StatTiles stats={stats.data} now={now} />
      {termNames && <p className="caption">Across {termNames}, all campuses.</p>}

      <section className="panel" aria-labelledby="feed-title">
        <div className="panel-head">
          <h2 id="feed-title">
            <Crosshair className="title-mark" />
            Latest changes{info?.name ? ` · ${info.name}` : ""}
          </h2>
          <span className="caption">Updates every 15 seconds</span>
          <p className="panel-note">
            The 40 most recent openings and closings in this term, newest first, across every
            campus. An opening is a section one check found open after the check 30 seconds before
            found it closed.
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
