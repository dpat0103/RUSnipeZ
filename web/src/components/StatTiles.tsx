import type { Stats } from "../api/types";
import { dateTime, formatCount, formatPercent } from "../lib/format";

const DAY_MS = 24 * 3600_000;

export function StatTiles({ stats, now }: { stats: Stats | undefined; now: number }) {
  // Until a full day has been tracked, say what the window really is.
  const young = stats?.trackingSince && now - Date.parse(stats.trackingSince) < DAY_MS;
  const since = young ? `since ${dateTime(stats.trackingSince!)}` : "in 24 hours";
  const tiles = [
    { label: "Open right now", value: stats && formatCount(stats.openNow) },
    { label: `Openings ${since}`, value: stats && formatCount(stats.openings24h) },
    { label: "Sections tracked", value: stats && formatCount(stats.sectionsTracked) },
    {
      label: young ? `Uptime ${since}` : "Uptime, 24 hours",
      value: stats && (stats.uptime24h === null ? "—" : formatPercent(stats.uptime24h)),
    },
  ];
  return (
    <dl className="tiles">
      {tiles.map((tile) => (
        <div className="tile" key={tile.label}>
          <dt>{tile.label}</dt>
          <dd>{tile.value ?? <span className="skeleton-text" aria-label="Loading" />}</dd>
        </div>
      ))}
    </dl>
  );
}
