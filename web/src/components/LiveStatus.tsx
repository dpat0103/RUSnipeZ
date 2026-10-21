import { STALE_AFTER_MS } from "../lib/config";
import { timeAgo } from "../lib/format";
import { useNow } from "../lib/hooks";

/** "Live · checked 12s ago", or a delayed/offline state. */
export function LiveStatus({ lastPollAt, error }: { lastPollAt: string | null | undefined; error: boolean }) {
  const now = useNow();
  let state: "live" | "delayed" | "offline" | "loading" = "loading";
  let label = "Connecting…";
  if (error) {
    state = "offline";
    label = "Live data unavailable";
  } else if (lastPollAt === null) {
    state = "delayed";
    label = "Waiting for the first check";
  } else if (lastPollAt) {
    const stale = now - Date.parse(lastPollAt) > STALE_AFTER_MS;
    state = stale ? "delayed" : "live";
    label = `${stale ? "Delayed" : "Live"} · checked ${timeAgo(lastPollAt, now)}`;
  }
  return (
    <span className="live-status" data-state={state} role="status">
      <span className="live-dot" aria-hidden="true" />
      {label}
    </span>
  );
}
