import { Link } from "react-router";
import type { SeatEvent } from "../api/types";
import { CAMPUS_NAMES } from "../lib/config";
import { timeAgo } from "../lib/format";
import { useNow } from "../lib/hooks";

const key = (event: SeatEvent) => `${event.kind}-${event.index}-${event.at}`;

/** Search for the index on the campus it belongs to; New Brunswick is the page's default. */
function searchFor(event: SeatEvent, term: string): string {
  const params = new URLSearchParams({ q: event.index, term });
  if (event.campus && event.campus !== "NB") params.set("campus", event.campus);
  return `?${params}`;
}

export function EventFeed({ events, term }: { events: SeatEvent[]; term: string }) {
  const now = useNow();

  if (events.length === 0) {
    return (
      <p className="empty">
        No openings or closings yet. Changes appear here within 30 seconds of happening.
      </p>
    );
  }

  return (
    <ol className="feed" aria-live="polite" aria-relevant="additions">
      {events.map((event) => (
        // Rows are keyed by event, so only new arrivals mount and play the entry animation.
        <li key={key(event)} className="feed-row">
          <span className={`pill pill-${event.kind}`}>{event.kind === "opened" ? "Opened" : "Closed"}</span>
          <span className="feed-course">
            {event.courseTitle ? (
              <>
                <span className="feed-title">{event.courseTitle}</span>
                <span className="feed-meta">
                  {event.courseCode} · Section {event.sectionNumber}
                  {event.campus && ` · ${CAMPUS_NAMES[event.campus]}`}
                </span>
              </>
            ) : (
              <>
                <span className="feed-title">Not in Rutgers&apos; public schedule yet</span>
                <span className="feed-meta">Usually a new section; its details appear once Rutgers lists it</span>
              </>
            )}
          </span>
          <Link className="index" to={{ pathname: "/search", search: searchFor(event, term) }} title="Show this section">
            {event.index}
          </Link>
          <time
            dateTime={event.at}
            title={event.precise ? undefined : "Detected after a gap in checks; exact time unknown"}
          >
            {event.precise ? "" : "~"}
            {timeAgo(event.at, now)}
          </time>
        </li>
      ))}
    </ol>
  );
}
