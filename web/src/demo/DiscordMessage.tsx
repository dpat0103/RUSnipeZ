import type { ReactNode } from "react";
import { useSection } from "../api/hooks";
import { HourChart } from "../components/HourChart";
import { webregUrl } from "../lib/config";
import { dateTime, duration, meetingLabels, nameCase, timeAgo } from "../lib/format";
import { useDemo } from "./context";
import { COMMANDS, WATCH_LIMIT, type Message, type Watch } from "./model";

const COLORS = { open: "#23a55a", info: "#5865f2", warn: "#f0b232", error: "#f23f43", muted: "#4e5058" };

function Embed({
  color,
  title,
  children,
  footer,
}: {
  color: string;
  title: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="embed" style={{ borderLeftColor: color }}>
      <strong className="embed-title">{title}</strong>
      {children}
      {footer && <span className="embed-footer">{footer}</span>}
    </div>
  );
}

function Fields({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="embed-fields">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

const sectionLabel = (w: Watch) => `${w.courseCode} · Sec ${w.sectionNumber}`;

function watchFields(watch: Watch): [string, ReactNode][] {
  const rows: [string, ReactNode][] = [
    ["Index", <code>{watch.index}</code>],
    ["Section", sectionLabel(watch)],
    ["Instructor", watch.instructors.map(nameCase).join(", ") || "TBA"],
  ];
  if (watch.meets.length) rows.push(["Meets", meetingLabels(watch.meets).join(", ")]);
  if (watch.spn) rows.push(["Heads up", "Needs a special permission number"]);
  return rows;
}

function Register({ watch }: { watch: Watch }) {
  return (
    <a className="dc-button dc-link" href={webregUrl(watch.term, watch.index)} target="_blank" rel="noreferrer">
      Register
    </a>
  );
}

function Dot({ open }: { open: boolean | null }) {
  return <span className="dc-dot" data-open={open === null ? undefined : String(open)} aria-hidden="true" />;
}

function Body({ message }: { message: Message }) {
  const demo = useDemo();
  const { reply } = message;

  switch (reply.type) {
    case "snipe": {
      const { watch, result } = reply;
      if (result === "duplicate") {
        return <Embed color={COLORS.warn} title={`You are already watching ${watch.index}.`} />;
      }
      if (result === "limit") {
        return (
          <Embed color={COLORS.error} title={`You can watch up to ${WATCH_LIMIT} sections.`}>
            <p>Remove one with /remove first.</p>
          </Embed>
        );
      }
      return (
        <>
          <Embed
            color={reply.openNow ? COLORS.open : COLORS.info}
            title={reply.openNow ? `${watch.courseTitle} is open right now` : `Now watching ${watch.courseTitle}`}
            footer={`${reply.openNow ? "Register now, or keep watching for the next opening" : "You will get a DM the moment it opens"} · ${reply.count}/${WATCH_LIMIT} watches`}
          >
            <Fields rows={watchFields(watch)} />
          </Embed>
          {reply.openNow && (
            <div className="dc-buttons">
              <Register watch={watch} />
            </div>
          )}
        </>
      );
    }

    case "not-found":
      return <Embed color={COLORS.error} title={`Could not find ${reply.what}.`} />;

    case "error":
      return <Embed color={COLORS.error} title={reply.text} />;

    case "check":
      return reply.rows.length ? (
        <Embed color={COLORS.info} title={`Your snipe list (${reply.rows.length}/${WATCH_LIMIT})`}>
          <ul className="dc-list">
            {reply.rows.map(({ watch, open }) => (
              <li key={`${watch.term}-${watch.index}`}>
                <Dot open={open} />
                <code>{watch.index}</code> {watch.courseTitle} · Sec {watch.sectionNumber}
                <span className="dc-muted"> {open === null ? "" : open ? "Open" : "Closed"}</span>
              </li>
            ))}
          </ul>
        </Embed>
      ) : (
        <Embed color={COLORS.muted} title="You are not watching anything.">
          <p>Add a section with /snipe.</p>
        </Embed>
      );

    case "remove":
      return reply.watch ? (
        <Embed color={COLORS.muted} title={`Stopped watching ${reply.index}`}>
          <p>{sectionLabel(reply.watch)}</p>
        </Embed>
      ) : (
        <Embed color={COLORS.warn} title={`${reply.index} is not on your list.`} />
      );

    case "clear-confirm":
      if (reply.count === 0) return <Embed color={COLORS.muted} title="Your list is already empty." />;
      if (reply.resolution === "confirmed") {
        return <Embed color={COLORS.muted} title={`Cleared ${reply.count} section${reply.count === 1 ? "" : "s"}.`} />;
      }
      if (reply.resolution === "cancelled") return <Embed color={COLORS.muted} title="Kept your list." />;
      return (
        <>
          <Embed
            color={COLORS.warn}
            title={`Stop watching ${reply.count === 1 ? "your 1 section" : `all ${reply.count} sections`}?`}
          />
          <div className="dc-buttons">
            <button className="dc-button dc-danger" onClick={() => demo.resolveClear(message.id, true)}>
              Clear all
            </button>
            <button className="dc-button" onClick={() => demo.resolveClear(message.id, false)}>
              Cancel
            </button>
          </div>
        </>
      );

    case "lastopen":
      return <LastOpen term={reply.term} index={reply.index} title={reply.title} sectionNumber={reply.sectionNumber} />;

    case "course": {
      const shown = reply.sections.slice(0, 12);
      const open = reply.sections.filter((s) => s.open).length;
      return (
        <Embed
          color={COLORS.info}
          title={`${reply.code} ${reply.title}`}
          footer={`${reply.termName} · ${reply.campus} · ${open} of ${reply.sections.length} open`}
        >
          <ul className="dc-list">
            {shown.map((s) => (
              <li key={s.index}>
                <Dot open={s.open} />
                Sec {s.number} · <code>{s.index}</code> · {s.instructors.map(nameCase).join(", ") || "TBA"}
              </li>
            ))}
          </ul>
          {reply.sections.length > shown.length && (
            <p className="dc-muted">and {reply.sections.length - shown.length} more</p>
          )}
        </Embed>
      );
    }

    case "status": {
      const s = reply.stats;
      if (!s) return <Embed color={COLORS.error} title="Status is unavailable right now." />;
      return (
        <Embed color={COLORS.open} title="RU SnipeZ is checking Rutgers every 30 seconds">
          <Fields
            rows={[
              ["Last check", s.lastPollAt ? timeAgo(s.lastPollAt, message.at) : "Not yet"],
              ["Uptime", s.uptime24h === null ? "No data yet" : `${(s.uptime24h * 100).toFixed(1)}%`],
              ["Sections tracked", s.sectionsTracked.toLocaleString("en-US")],
              ["Openings, 24 hours", s.openings24h.toLocaleString("en-US")],
            ]}
          />
        </Embed>
      );
    }

    case "help":
      return (
        <Embed color={COLORS.info} title="RU SnipeZ commands">
          <dl className="dc-help">
            {COMMANDS.map((c) => (
              <div key={c.usage}>
                <dt>
                  <code>{c.usage}</code>
                </dt>
                <dd>{c.description}</dd>
              </div>
            ))}
          </dl>
        </Embed>
      );

    case "alert": {
      const { watch, handled } = reply;
      const note = {
        snoozed: "Snoozed. No alerts for this section for 1 hour.",
        stopped: `Stopped watching ${watch.index}.`,
        "got-in": "Nice. Removed it and its cross-listed sections from your list.",
      };
      return (
        <>
          <Embed
            color={COLORS.open}
            title={`${watch.courseTitle} is open`}
            footer={`${watch.termName}${reply.preview ? " · Preview" : ""}`}
          >
            <Fields rows={watchFields(watch)} />
          </Embed>
          <div className="dc-buttons">
            <Register watch={watch} />
            {(["snoozed", "stopped", "got-in"] as const).map((action) => (
              <button
                key={action}
                className="dc-button"
                disabled={handled !== null}
                onClick={() => demo.handleAlert(message.id, watch, action)}
              >
                {{ snoozed: "Snooze 1h", stopped: "Stop watching", "got-in": "I got in" }[action]}
              </button>
            ))}
          </div>
          {handled && <p className="dc-muted">{note[handled]}</p>}
        </>
      );
    }
  }
}

function LastOpen({
  term,
  index,
  title,
  sectionNumber,
}: {
  term: string;
  index: string;
  title: string | null;
  sectionNumber: string | null;
}) {
  const { data } = useSection(term, index);
  if (!data) return <Embed color={COLORS.muted} title="Loading seat history…" />;
  const status = data.openNow
    ? data.openSince
      ? `Open since ${dateTime(data.openSince)}`
      : "Open now"
    : data.lastSeenOpenAt
      ? `Last seen open ${dateTime(data.lastSeenOpenAt)}`
      : "Not seen open since tracking began";
  return (
    <Embed color={data.openNow ? COLORS.open : COLORS.info} title={`${title ?? index} · Sec ${sectionNumber ?? "?"}`}>
      <Fields
        rows={[
          ["Status", status],
          ["Openings", `${data.openings7d} in 7 days · ${data.openings30d} in 30 days`],
          ["Typically open", data.medianOpenSeconds === null ? "Not enough data" : duration(data.medianOpenSeconds)],
          ["When it opens", <HourChart counts={data.openingsByHour} />],
        ]}
      />
    </Embed>
  );
}

const clockTime = (at: number) => new Date(at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

export function DiscordMessage({ message }: { message: Message }) {
  const isDm = message.command === null;
  return (
    <li className="dc-message">
      {isDm && (
        <div className="dc-divider">
          <span>Direct message</span>
        </div>
      )}
      {message.command && (
        <div className="dc-reply">
          <span className="dc-reply-line" aria-hidden="true" />
          <strong>You</strong> used <code>{message.command}</code>
        </div>
      )}
      <div className="dc-row">
        <img className="dc-avatar" src="/logo.png" alt="" width={36} height={36} />
        <div className="dc-content">
          <div className="dc-author">
            RU SnipeZ <span className="dc-app">APP</span>
            <time dateTime={new Date(message.at).toISOString()}>Today at {clockTime(message.at)}</time>
          </div>
          <Body message={message} />
        </div>
      </div>
    </li>
  );
}
