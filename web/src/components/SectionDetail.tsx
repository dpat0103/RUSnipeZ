import type { ReactNode } from "react";
import { useSection } from "../api/hooks";
import type { CatalogCourse, CatalogSection } from "../api/types";
import { LOCATION_NAMES, OFF_CAMPUS_NAMES, webregUrl } from "../lib/config";
import { Link } from "react-router";
import type { SectionFormat } from "../api/types";
import { clock, dateTime, duration, examLabel, nameCase, plainText } from "../lib/format";
import { useDemo } from "../demo/context";
import { watchFrom } from "../demo/model";
import { useTerm } from "../lib/hooks";
import { HourChart } from "./HourChart";

const FORMAT_LABELS: Record<SectionFormat, string> = {
  "in-person": "In person",
  hybrid: "Hybrid: some meetings online",
  online: "Online",
};

interface Props {
  term: string;
  course: CatalogCourse;
  section: CatalogSection;
}

export function SectionDetail({ term, course, section }: Props) {
  const history = useSection(term, section.index);
  const demo = useDemo();
  const { info } = useTerm();
  const watching = demo.isWatched(section.index);
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
            {m.campus && m.start && ` (${OFF_CAMPUS_NAMES[section.campus] ?? LOCATION_NAMES[m.campus] ?? m.campus})`}
          </li>
        ))}
      </ul>
    ) : (
      "Not listed"
    ),
  ]);
  rows.push(["Format", FORMAT_LABELS[section.format]]);
  if (section.subtitle) rows.push(["Topic", section.subtitle]);
  const exam = examLabel(section.exam);
  if (exam) rows.push(["Final exam", exam]);
  if (course.core.length) rows.push(["Core requirements", course.core.join(", ")]);
  if (course.prereqs) rows.push(["Prerequisites", plainText(course.prereqs)]);
  if (section.eligibility) rows.push(["Class years", nameCase(section.eligibility)]);
  if (section.openTo) rows.push(["Open to", section.openTo]);
  if (section.spn) {
    rows.push([
      "Special permission",
      `Needed to register${section.spnFrom ? `; issued by ${section.spnFrom.toLowerCase()}` : ""}.`,
    ]);
  }
  if (section.crossListed.length) {
    rows.push([
      "Cross-listed",
      <span>
        {section.crossListed.map((index, i) => (
          <span key={index}>
            {i > 0 && ", "}
            <Link className="index" to={`/search?q=${index}${term ? `&term=${term}` : ""}`}>
              {index}
            </Link>
          </span>
        ))}{" "}
        (same class, separate seats)
      </span>,
    ]);
  }
  if (course.fee !== null) rows.push(["Course fee", `$${course.fee.toFixed(2)}`]);
  const notes = [...section.comments, section.notes, course.notes].filter((n): n is string => Boolean(n));
  if (notes.length) {
    rows.push([
      "Notes",
      <ul className="plain-list">
        {notes.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>,
    ]);
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
        <button
          className="button button-primary"
          onClick={() => demo.snipe(watchFrom(term, info?.name ?? term, course, section))}
        >
          {watching ? "Watching · run /snipe again" : "Snipe this section"}
        </button>
        <button className="button" onClick={() => void demo.course(course.code)}>
          /course {course.code}
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
