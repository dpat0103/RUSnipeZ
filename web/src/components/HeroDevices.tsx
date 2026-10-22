import type { SeatEvent } from "../api/types";
import { CAMPUS_NAMES } from "../lib/config";
import { nameCase, timeAgo } from "../lib/format";

interface Row {
  kind: "opened" | "closed";
  title: string;
  meta: string;
  index: string;
  at: string | null;
}

// Shown until the live feed loads, and when it has no named sections yet.
const EXAMPLES: Row[] = [
  { kind: "opened", title: "Intro to Computer Science", meta: "01:198:111 · Section 03", index: "25596", at: null },
  { kind: "closed", title: "Calculus I", meta: "01:640:151 · Section 12", index: "15771", at: null },
  { kind: "opened", title: "Organic Chemistry", meta: "01:160:307 · Section 05", index: "08341", at: null },
  { kind: "opened", title: "Expository Writing", meta: "01:355:101 · Section 41", index: "09217", at: null },
];

function toRow(event: SeatEvent): Row {
  return {
    kind: event.kind,
    title: nameCase(event.courseTitle!),
    meta: `${event.courseCode} · Section ${event.sectionNumber}`,
    index: event.index,
    at: event.at,
  };
}

/** The product on a laptop (live feed) and a phone (the Discord alert), built from live events. */
export function HeroDevices({ events, now }: { events: SeatEvent[] | undefined; now: number }) {
  // The newest named opening leads both screens, so the phone alerts about the laptop's top row.
  const named = (events ?? []).filter((e) => e.courseTitle).map(toRow);
  const opening = named.find((r) => r.kind === "opened");
  const rows = opening && named.length >= 3 ? [opening, ...named.filter((r) => r !== opening)].slice(0, 4) : EXAMPLES;
  const alert = rows[0]!;
  const campus = (events ?? []).find((e) => e.index === alert.index)?.campus;

  return (
    <div className="devices" role="img" aria-label="RU SnipeZ on a laptop showing live seat changes, and a phone showing a Discord alert">
      <div className="laptop" aria-hidden="true">
        <div className="laptop-screen">
          <div className="mock-bar">
            <span className="mock-dots">
              <i />
              <i />
              <i />
            </span>
            <span className="mock-url">ru-snipez.vercel.app</span>
          </div>
          <div className="mock-page">
            <div className="mock-head">
              <img src="/logo.png" alt="" width={14} height={14} />
              <b>Latest changes</b>
              <span className="mock-live">
                <span className="live-dot" /> Live
              </span>
            </div>
            {rows.map((row, i) => (
              <div className="mock-row" key={`${row.index}-${row.at ?? i}`} data-first={i === 0 || undefined}>
                <span className={`pill pill-${row.kind}`}>{row.kind === "opened" ? "Opened" : "Closed"}</span>
                <span className="mock-course">
                  <b>{row.title}</b>
                  <small>{row.meta}</small>
                </span>
                <span className="mock-time">{row.at ? timeAgo(row.at, now) : "now"}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="laptop-base" />
      </div>

      <div className="phone" aria-hidden="true">
        <div className="phone-screen">
          <div className="phone-status">
            <span>9:41</span>
            <span className="phone-island" />
          </div>
          <div className="notice" key={alert.index}>
            <div className="notice-top">
              <img src="/logo.png" alt="" width={16} height={16} />
              <span>Discord</span>
              <span className="notice-when">now</span>
            </div>
            <b>RU SnipeZ</b>
            <span>Seat open: {alert.title}</span>
          </div>
          <div className="phone-dm">
            <div className="phone-embed">
              <b>A seat just opened</b>
              <span>{alert.title}</span>
              <small>
                {alert.meta}
                {campus ? ` · ${CAMPUS_NAMES[campus]}` : ""}
              </small>
              <span className="phone-index">Index {alert.index}</span>
            </div>
            <span className="phone-button">Register on WebReg</span>
          </div>
        </div>
      </div>
    </div>
  );
}
