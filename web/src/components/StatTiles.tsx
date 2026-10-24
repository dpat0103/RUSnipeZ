import type { ReactNode } from "react";
import type { Stats } from "../api/types";
import { dateTime, duration, formatCount, formatPercent } from "../lib/format";
import { useCountUp } from "../lib/useCountUp";

const DAY_MS = 24 * 3600_000;

function Count({ value }: { value: number }) {
  const shown = useCountUp(value) ?? value;
  return <>{formatCount(shown)}</>;
}

interface Tile {
  label: string;
  value: ReactNode;
  note: string;
  tone: "open" | "accent" | "warn" | "plain";
}

export function StatTiles({ stats, now }: { stats: Stats | undefined; now: number }) {
  // Until a full day has been tracked, say what the window really is.
  const young = stats?.trackingSince && now - Date.parse(stats.trackingSince) < DAY_MS;
  const since = young ? `since ${dateTime(stats.trackingSince!)}` : "in 24 hours";
  const median = stats?.medianOpenSeconds7d;
  const tiles: Tile[] = [
    {
      label: "Open right now",
      value: stats && <Count value={stats.openNow} />,
      note: "sections with a free seat",
      tone: "open",
    },
    {
      label: `Openings ${since}`,
      value: stats && <Count value={stats.openings24h} />,
      note: "seats that freed up",
      tone: "accent",
    },
    {
      label: "A freed seat lasts",
      value: stats && (median == null ? "—" : duration(median)),
      note: median == null ? "not enough openings yet" : "median, last 7 days",
      tone: "warn",
    },
    {
      label: `Checks ${since}`,
      value: stats && (stats.checks24h === undefined ? "—" : <Count value={stats.checks24h} />),
      note: "one every 30 seconds per term",
      tone: "plain",
    },
    {
      label: "Sections tracked",
      value: stats && <Count value={stats.sectionsTracked} />,
      note: "every campus",
      tone: "plain",
    },
    {
      label: young ? `Uptime ${since}` : "Uptime, 24 hours",
      value: stats && (stats.uptime24h === null ? "—" : formatPercent(stats.uptime24h)),
      note: "minutes with a successful check",
      tone: "plain",
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
    <dl className="tiles">
      {tiles.map((tile) => (
        <div className="tile" data-tone={tile.tone} key={tile.label}>
          <dt>{tile.label}</dt>
          <dd>{tile.value ?? <span className="skeleton-text" aria-label="Loading" />}</dd>
          <dd className="tile-note">{tile.note}</dd>
        </div>
      ))}
    </dl>
  );
}
