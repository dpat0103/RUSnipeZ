import { hourLabel } from "../lib/format";

/** Observed openings by hour of day (Eastern), as a compact bar chart. */
export function HourChart({ counts }: { counts: number[] }) {
  const max = Math.max(...counts);
  if (max === 0) return <span className="muted">Not enough observations yet</span>;
  const peak = counts.indexOf(max);
  return (
    <figure className="hours">
      <div className="hours-bars" role="img" aria-label={`Most openings around ${hourLabel(peak)} Eastern`}>
        {counts.map((count, hour) => (
          <span
            key={hour}
            className="hours-bar"
            style={{ height: `${Math.max(4, (count / max) * 100)}%` }}
            data-empty={count === 0 || undefined}
            title={`${hourLabel(hour)}: ${count} opening${count === 1 ? "" : "s"}`}
          />
        ))}
      </div>
      <figcaption className="hours-axis">
        <span>12 AM</span>
        <span>6 AM</span>
        <span>12 PM</span>
        <span>6 PM</span>
        <span>12 AM</span>
      </figcaption>
    </figure>
  );
}
