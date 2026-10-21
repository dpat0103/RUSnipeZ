import { useEvents, useStats } from "../api/hooks";
import { DiscordCta } from "../components/DiscordCta";
import { EventFeed } from "../components/EventFeed";
import { StatTiles } from "../components/StatTiles";
import { useNow, useTerm } from "../lib/hooks";

export function LivePage() {
  const { term, info, terms } = useTerm();
  const stats = useStats();
  const events = useEvents(term);
  const now = useNow(60_000);
  const termNames = terms.map((t) => t.name ?? t.code).join(" and ");

  return (
    <>
      <section className="hero">
        <h1>Rutgers open seats, as they happen.</h1>
        <p className="lead">
          RU SnipeZ checks every course section at Rutgers every 30 seconds. When a seat opens,
          students watching it get a Discord message with a direct link to register. This page shows
          the same live feed.
        </p>
      </section>

      <StatTiles stats={stats.data} now={now} />
      {termNames && <p className="caption">Across {termNames}, all campuses.</p>}

      <section className="panel" aria-labelledby="feed-title">
        <div className="panel-head">
          <h2 id="feed-title">Latest changes{info?.name ? ` · ${info.name}` : ""}</h2>
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

      <DiscordCta />
    </>
  );
}
