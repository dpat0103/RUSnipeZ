import type { Stats } from "../api/types";
import { formatCount, formatPercent } from "../lib/format";

export function StatTiles({ stats }: { stats: Stats | undefined }) {
  const tiles = [
    { label: "Open right now", value: stats && formatCount(stats.openNow) },
    { label: "Openings in 24 hours", value: stats && formatCount(stats.openings24h) },
    { label: "Sections tracked", value: stats && formatCount(stats.sectionsTracked) },
    {
      label: "Uptime, 24 hours",
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
