import type { Stats } from "../api/types";
import { dateTime, formatCount, formatPercent } from "../lib/format";
import { useCountUp } from "../lib/useCountUp";

const DAY_MS = 24 * 3600_000;

function Count({ value }: { value: number }) {
  const shown = useCountUp(value) ?? value;
  return <>{formatCount(shown)}</>;
}

export function StatTiles({ stats, now }: { stats: Stats | undefined; now: number }) {
  // Until a full day has been tracked, say what the window really is.
  const young = stats?.trackingSince && now - Date.parse(stats.trackingSince) < DAY_MS;
  const since = young ? `since ${dateTime(stats.trackingSince!)}` : "in 24 hours";
  const tiles = [
    { label: "Open right now", value: stats && <Count value={stats.openNow} />, tone: "open" },
    { label: `Openings ${since}`, value: stats && <Count value={stats.openings24h} />, tone: "accent" },
    { label: "Sections tracked", value: stats && <Count value={stats.sectionsTracked} />, tone: "plain" },
    {
      label: young ? `Uptime ${since}` : "Uptime, 24 hours",
      value: stats && (stats.uptime24h === null ? "—" : formatPercent(stats.uptime24h)),
      tone: "plain",
    },
  ];
  return (
    <dl className="tiles">
      {tiles.map((tile) => (
        <div className="tile" data-tone={tile.tone} key={tile.label}>
          <dt>{tile.label}</dt>
          <dd>{tile.value ?? <span className="skeleton-text" aria-label="Loading" />}</dd>
        </div>
      ))}
    </dl>
  );
}
