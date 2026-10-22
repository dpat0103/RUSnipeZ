import type { ReactNode } from "react";

/** One box in a diagram: a title, an optional tag and a few short lines. */
function Node({
  title,
  tag,
  tone = "plain",
  children,
}: {
  title: string;
  tag?: string;
  tone?: "plain" | "source" | "core" | "store" | "client" | "next";
  children?: ReactNode;
}) {
  return (
    <div className="node" data-tone={tone}>
      <div className="node-head">
        <b>{title}</b>
        {tag && <span className="node-tag">{tag}</span>}
      </div>
      {children && <div className="node-body">{children}</div>}
    </div>
  );
}

function Arrow({ label }: { label?: string }) {
  return (
    <div className="arrow" aria-hidden="true">
      {label && <span>{label}</span>}
    </div>
  );
}

/** Rutgers to service to PostgreSQL, and the two clients reading the API. */
export function ArchitectureDiagram() {
  return (
    <figure className="diagram-card" aria-label="Architecture diagram">
      <div className="arch">
        <div className="arch-col">
          <span className="arch-label">Rutgers Schedule of Classes</span>
          <Node title="openSections.json" tag="every 30 s" tone="source">
            Every open index, about 15,000
          </Node>
          <Node title="courses.json" tag="every 6 h" tone="source">
            Full catalog, per campus
          </Node>
        </div>

        <Arrow label="HTTPS" />

        <div className="arch-col arch-core">
          <span className="arch-label">rusnipez service · one asyncio process</span>
          <Node title="Poller" tone="core">
            diff → change guard → write
          </Node>
          <Node title="Catalog sync" tone="core">
            normalize → gzip → store
          </Node>
          <Node title="FastAPI" tag="read-only" tone="core">
            /api/v1/*
          </Node>
          <Node title="Discord bot" tag="next" tone="next">
            watches → alert outbox → DMs
          </Node>
          <div className="arch-db">
            <Node title="PostgreSQL 17" tone="store">
              catalogs · sections · openings · polls
            </Node>
          </div>
        </div>

        <Arrow label="JSON" />

        <div className="arch-col">
          <span className="arch-label">Clients</span>
          <Node title="Vercel CDN" tag="caches 4 s to 1 h" tone="client">
            Absorbs visitor traffic
          </Node>
          <Node title="This website" tone="client">
            React · search runs in the browser
          </Node>
          <Node title="Discord" tone="client">
            Alerts by direct message
          </Node>
        </div>
      </div>
      <figcaption>
        One process keeps one source of truth for the open set. One request per term serves every user,
        which is lighter on Rutgers than polling per user.
      </figcaption>
    </figure>
  );
}

const CYCLE = [
  ["Fetch", "openSections.json for the term: every open index"],
  ["Diff", "Against open rows in the database: opened = now − before, closed = before − now"],
  ["Guard", "A mass change is held until it lasts 120 s"],
  ["Write", "Openings, closings and the poll row, in one transaction"],
  ["Serve", "The API and the website see it on their next request"],
] as const;

/** The 30 second poll, as a pipeline. */
export function PollCycle() {
  return (
    <figure className="diagram-card" aria-label="Poll cycle">
      <ol className="pipeline">
        {CYCLE.map(([title, text]) => (
          <li key={title}>
            <b>{title}</b>
            <span>{text}</span>
          </li>
        ))}
      </ol>
      <figcaption>Every 30 seconds, for each active term. A section that stays open produces no event.</figcaption>
    </figure>
  );
}

/** How the change guard decides. */
export function ChangeGuardDiagram() {
  return (
    <figure className="diagram-card" aria-label="Change guard decision">
      <div className="guard">
        <Node title="New poll" tone="source">
          Count opened + closed
        </Node>
        <div className="guard-split">
          <div className="guard-path">
            <span className="guard-when">fewer than max(50, 2% of open)</span>
            <Node title="Apply now" tone="client">
              Ordinary polls are never delayed
            </Node>
          </div>
          <div className="guard-path">
            <span className="guard-when">at least that many</span>
            <Node title="Hold" tag="status: held" tone="next">
              Keep checking every 30 s
            </Node>
            <div className="guard-split guard-inner">
              <div className="guard-path">
                <span className="guard-when">still there after 120 s</span>
                <Node title="Apply" tone="client">
                  A real mass change
                </Node>
              </div>
              <div className="guard-path">
                <span className="guard-when">upstream recovers first</span>
                <Node title="Discard" tone="plain">
                  Remember its SHA-256 fingerprint
                </Node>
              </div>
            </div>
          </div>
        </div>
      </div>
      <figcaption>
        The stale snapshot lasted about a minute, two checks, so a rule that confirms after two matching
        checks would have accepted it. Time, not repetition, tells them apart.
      </figcaption>
    </figure>
  );
}

/** The window in which an opening happened. */
export function TimingDiagram() {
  return (
    <figure className="diagram-card" aria-label="Opening time window">
      <div className="timeline">
        <div className="tick">
          <b>Check</b>
          <span>closed</span>
          <code>open_detected_after</code>
        </div>
        <div className="span">
          <span>seat opened somewhere in here · usually 30 s</span>
        </div>
        <div className="tick tick-open">
          <b>Check</b>
          <span>open</span>
          <code>opened_at</code>
        </div>
      </div>
      <figcaption>
        After an outage the window is wider and the API marks the time as approximate (~). Sections already
        open on the very first check have no known opening time and never count as openings.
      </figcaption>
    </figure>
  );
}

/** The four tables as cards. */
export function DataModel() {
  const tables = [
    ["catalogs", "One per term and campus", "The normalized catalog, gzipped, with a content-hash ETag", "Replaced on change"],
    ["sections", "One per index", "Course, section number, instructors, campus: for joins", "Rebuilt with the catalog"],
    ["openings", "One per opening", "opened_at and closed_at, each with the check before it", "Kept for good"],
    ["polls", "One per check", "ok, held or error, with counts. Feeds uptime", "Kept 14 days"],
  ] as const;
  return (
    <div className="tables">
      {tables.map(([name, rows, holds, keep]) => (
        <div className="table-card" key={name}>
          <code>{name}</code>
          <span className="table-rows">{rows}</span>
          <p>{holds}</p>
          <span className="table-keep">{keep}</span>
        </div>
      ))}
    </div>
  );
}
