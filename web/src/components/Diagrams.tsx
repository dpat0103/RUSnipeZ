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

/** Rutgers to service to PostgreSQL, out to the website and Discord. */
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
          <Node title="Dispatcher" tag="LISTEN alerts" tone="core">
            alert outbox → DMs, with retries
          </Node>
          <Node title="Discord bot" tone="core">
            slash commands · buttons · live channels
          </Node>
          <Node title="FastAPI" tag="read-only" tone="core">
            /api/v1/*
          </Node>
          <div className="arch-db">
            <Node title="PostgreSQL 17" tone="store">
              openings · polls · sections · catalogs · users · watches · alerts
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
            /snipe and friends · alerts by DM
          </Node>
        </div>
      </div>
      <figcaption>
        One process keeps one source of truth. One request per term serves every user and every alert,
        which is lighter on Rutgers than polling per user. The bot works in one Discord server only.
      </figcaption>
    </figure>
  );
}

const CYCLE = [
  ["Fetch", "openSections.json for the term: every open index"],
  ["Diff", "Against open rows in the database: opened = now − before, closed = before − now"],
  ["Guard", "A mass change is held until it lasts 120 s"],
  ["Write", "Openings, closings, one alert per watcher and the poll row, in one transaction"],
  ["Notify", "On commit, NOTIFY wakes the dispatcher; the website sees it on its next request"],
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

const DELIVERY = [
  ["Queue", "The poll's transaction inserts an alert per watcher; snoozed watches and banned users are skipped"],
  ["Wake", "PostgreSQL delivers NOTIFY on commit; a 15 s idle check catches retries"],
  ["Claim", "Due alerts are leased for 2 minutes, oldest watches first (FOR UPDATE SKIP LOCKED)"],
  ["Send", "A DM with Register, Snooze 1h, Stop watching and I got in; a private thread if DMs are closed"],
  ["Record", "sent_at for the speed metric, or a retry from 30 s up to 8 min, then failed"],
] as const;

/** From an opening to a direct message. */
export function AlertFlow() {
  return (
    <figure className="diagram-card" aria-label="Alert delivery">
      <ol className="pipeline">
        {DELIVERY.map(([title, text]) => (
          <li key={title}>
            <b>{title}</b>
            <span>{text}</span>
          </li>
        ))}
      </ol>
      <figcaption>
        An opening and its alerts are saved together, so a crash cannot record one and lose the other. A
        unique (watch, opening) key means a retry never alerts anyone twice.
      </figcaption>
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

/** The tables as cards: seat data first, then people and alerts. */
export function DataModel() {
  const tables = [
    ["openings", "One per opening", "opened_at and closed_at, each with the check before it", "Kept for good"],
    ["polls", "One per check", "ok, held or error, with counts. Feeds uptime", "Kept 14 days"],
    ["sections", "One per index", "Course, section number, instructors, campus: for names and joins", "Rebuilt with the catalog"],
    ["catalogs", "One per term and campus", "The normalized catalog, gzipped, with a content-hash ETag", "Replaced on change"],
    ["users · identities", "One per person · per Discord account", "Limits and bans attach to the person", "Kept while in use"],
    ["watches", "One per person and section", "Unique, 15 per term, optional snooze", "Removed with their term"],
    ["alerts", "One per watcher per opening", "The outbox: status, attempts, sent_at, and the button pressed", "Unlinked, never deleted"],
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
