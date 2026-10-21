import type { ReactNode } from "react";
import { useSection } from "../api/hooks";
import type { CatalogCourse, CatalogSection } from "../api/types";
import { LOCATION_NAMES, webregUrl } from "../lib/config";
import { clock, dateTime, duration, plainText } from "../lib/format";
import { HourChart } from "./HourChart";

interface Props {
  term: string;
  course: CatalogCourse;
  section: CatalogSection;
  onPreview: () => void;
}

export function SectionDetail({ term, course, section, onPreview }: Props) {
  const history = useSection(term, section.index);
  const h = history.data;
  const rows: [string, ReactNode][] = [];

  if (history.isPending) rows.push(["Seat history", <span className="muted">Loading…</span>]);
  else if (history.isError || !h) rows.push(["Seat history", <span className="muted">Unavailable right now</span>]);
  else {
    rows.push([
      "Status",
      h.openNow
        ? h.openSince
          ? `Open since ${dateTime(h.openSince)}`
          : "Open (since before tracking began)"
        : h.lastSeenOpenAt
          ? `Closed · last seen open ${dateTime(h.lastSeenOpenAt)}`
          : "Closed · not seen open since tracking began",
    ]);
    rows.push(["Openings", `${h.openings7d} in the last 7 days · ${h.openings30d} in 30 days`]);
    if (h.medianOpenSeconds !== null) {
      rows.push(["Typically open for", `${duration(h.medianOpenSeconds)} (median)`]);
    }
    rows.push(["When it opens", <HourChart counts={h.openingsByHour} />]);
  }

  rows.push([
    "Meets",
    section.meets.length ? (
      <ul className="plain-list">
        {section.meets.map((m, i) => (
          <li key={i}>
            {m.start ? `${m.days || "TBA"} ${clock(m.start)} to ${clock(m.end)}` : "No set time"}
            {m.mode && ` · ${m.mode.toLowerCase()}`}
            {m.where && ` · ${m.where}`}
            {m.campus && m.start && ` (${LOCATION_NAMES[m.campus] ?? m.campus})`}
          </li>
        ))}
      </ul>
    ) : (
      "Not listed"
    ),
  ]);
  if (section.subtitle) rows.push(["Topic", section.subtitle]);
  if (section.exam) rows.push(["Final exam", section.exam]);
  if (course.core.length) rows.push(["Core requirements", course.core.join(", ")]);
  if (course.prereqs) rows.push(["Prerequisites", plainText(course.prereqs)]);
  if (section.spn) rows.push(["Restriction", "Needs a special permission number from the department."]);
  if (section.crossListed.length) {
    rows.push(["Cross-listed", `${section.crossListed.join(", ")} (same class, separate seats)`]);
  }

  return (
    <div className="detail">
      <dl className="detail-grid">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <p className="note">
        Times come from checks every 30 seconds, so they are accurate to about half a minute. A
        seat that opens and fills between two checks is not seen.
      </p>
      <div className="detail-actions">
        <button className="button button-primary" onClick={onPreview}>
          Get alerts for this section
        </button>
        <a className="button" href={webregUrl(term, section.index)} target="_blank" rel="noreferrer">
          Open in WebReg
        </a>
        {course.synopsis && (
          <a className="button" href={course.synopsis} target="_blank" rel="noreferrer">
            Course description
          </a>
        )}
      </div>
    </div>
  );
}
