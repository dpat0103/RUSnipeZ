import type { ReactNode } from "react";
import type { Stats } from "../api/types";
import { dateTime, duration, formatCount, plural } from "../lib/format";
import { STALE_AFTER_MS } from "../lib/config";

const DAY_MS = 24 * 3600_000;

function Count({ value }: { value: number }) {
  return <>{formatCount(value)}</>;
}

interface Tile {
  label: string;
  value: ReactNode;
  note: string;
  tone: "open" | "accent" | "warn" | "plain";
}

export function StatTiles({ stats, now, pollSeconds, error = false }: {
  stats: Stats | undefined; now: number; pollSeconds: number; error?: boolean;
}) {
  // Until a full day has been tracked, say what the window really is.
  const young = stats?.trackingSince && now - Date.parse(stats.trackingSince) < DAY_MS;
  const since = young ? `since ${dateTime(stats.trackingSince!)}` : "in 24 hours";
  const median = stats?.medianOpenSeconds7d;
  const age = stats?.openObservedAt ? Math.max(0, now - Date.parse(stats.openObservedAt)) : null;
  const delayed = age !== null && age > STALE_AFTER_MS;
  const tiles: Tile[] = [
    {
      label: delayed || error ? "Open at last update" : "Open right now",
      value: stats && (stats.openObservedAt ? <Count value={stats.openNow} /> : "—"),
      note: "sections Rutgers marked open",
      tone: "open",
    },
    {
      label: `Openings detected ${since}`,
      value: stats && <Count value={stats.openings24h} />,
      note: "section changes; repeats count",
      tone: "accent",
    },
    {
      label: "Median open duration",
      value: stats && (median == null ? "—" : `≈ ${duration(median)}`),
      note: median == null ? "no timed closures yet" : `${plural(stats!.medianOpenSamples7d, "completed interval")} · last 7 days`,
      tone: "warn",
    },
    {
      label: `Checks ${since}`,
      value: stats && (stats.checks24h === undefined ? "—" : <Count value={stats.checks24h} />),
      note: `target ${formatCount(Math.round(86400 / pollSeconds))}/day · every ${pollSeconds}s`,
      tone: "plain",
    },
    {
      label: "Sections tracked",
      value: stats && <Count value={stats.sectionsTracked} />,
      note: "in this term’s catalogs",
      tone: "plain",
    },
    {
      label: "Seat data age",
      value: stats && (age === null ? "—" : duration(age / 1000)),
      note: age === null ? "waiting for the first update" : delayed ? "delayed · last trusted update" : "since the last accepted check",
      tone: delayed ? "warn" : "plain",
    },
  ];
  // Alert tiles appear once the bot has delivered something.
  if (stats && stats.alertsSentTotal > 0) {
    const speed = stats.medianAlertSeconds7d;
    tiles.push(
      {
        label: "Alerts sent",
        value: <Count value={stats.alertsSentTotal} />,
        note: "Discord DMs to students",
        tone: "accent",
      },
      {
        label: "Check to DM",
        value: speed == null ? "—" : `${speed.toFixed(1)} s`,
        note: speed == null ? "no alerts this week" : "median, last 7 days",
        tone: "open",
      },
      {
        label: "Got in",
        value: <Count value={stats.gotInTotal} />,
        note: "pressed I got in on an alert",
        tone: "plain",
      },
    );
  }
  return (
    <dl className="tiles" aria-label="Selected term statistics">
      {tiles.map((tile) => (
        <div className="tile" data-tone={tile.tone} key={tile.label}>
          <dt>{tile.label}</dt>
          <dd>{tile.value ?? (error ? "—" : <span className="skeleton-text" aria-label="Loading" />)}</dd>
          <dd className="tile-note">{tile.note}</dd>
        </div>
      ))}
    </dl>
  );
}
