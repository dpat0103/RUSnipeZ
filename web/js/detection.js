import { state } from "./state.js";
import { $ } from "./dom.js";

export function updateHistoryNote() {
  const message = {
    loading: "Loading opening history…",
    starting: "Opening history is starting. The first check establishes a baseline.",
    ready: "Opening history is shared across visits. Expand a section for its last observed opening (Eastern time).",
    stale: "Updates are delayed. Displayed seat status and opening history are from the last successful check.",
    unavailable: "Seat status and opening history are temporarily unavailable. Course search is still available.",
  }[state.historyStatus];
  $("history-status").textContent = message;
}

export function openingInfo(index) {
  const shared = state.history?.sections[index];
  const local = state.lastOpened.get(index);
  // Prefer the collector once it has caught up to this observation interval;
  // two observers detecting the same opening seconds apart are one event.
  if (local && (!shared || Date.parse(shared.lastOpenedAt) < Date.parse(local.observedAfter))) {
    return { ...local, local: true };
  }
  return shared;
}

export function openingLabel(index, detailed = false) {
  const record = openingInfo(index);
  if (!record || !Number.isFinite(Date.parse(record.lastOpenedAt))) {
    if (state.historyStatus === "loading") return "Loading opening history…";
    if (state.historyStatus === "starting") return "Awaiting first history check";
    if (state.historyStatus === "ready") return "No opening recorded since tracking began";
    if (state.historyStatus === "stale") return "No opening in saved history · updates delayed";
    return "Opening history unavailable";
  }
  const date = new Date(record.lastOpenedAt);
  const stamp = date.toLocaleString("en-US", {
    timeZone: "America/New_York", month: "short", day: "numeric",
    ...(detailed ? { year: "numeric" } : {}),
    hour: "numeric", minute: "2-digit", timeZoneName: "short",
  });
  return `${detailed ? "Observed " : "Last opened · "}${stamp}${record.local ? " · this visit" : ""}`;
}

export function historyDate(value) {
  return new Date(value).toLocaleString("en-US", {
    timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", timeZoneName: "short",
  });
}

export function durationLabel(seconds) {
  if (seconds < 60) return `${seconds} seconds`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} minutes`;
  return `${(seconds / 3600).toFixed(1)} hours`;
}

/** Pure set difference, scoped to indexes in the selected catalog. */
export function openSetDiff(previous, next, known) {
  return {
    opened: [...next].filter((i) => !previous.has(i) && known.has(i)),
    closed: [...previous].filter((i) => !next.has(i) && known.has(i)),
  };
}

/** Record transitions without rendering or delivering alerts. */
export function applyOpenSet(next, { observedAt = new Date(), fresh = true } = {}) {
  const previous = state.open;
  state.open = next;
  const openHere = [...next].filter((i) => state.sectionsByIndex.has(i)).length;
  const baseline = !fresh || !state.seenBaseline ||
    Boolean(state.lastPollAt && observedAt - state.lastPollAt > 90_000);
  state.seenBaseline = true;
  const changes = baseline ? { opened: [], closed: [] } :
    openSetDiff(previous, next, state.sectionsByIndex);
  for (const index of changes.opened) {
    state.lastOpened.set(index, {
      lastOpenedAt: observedAt.toISOString(),
      observedAfter: (state.lastPollAt ?? observedAt).toISOString(),
    });
  }
  return { ...changes, baseline, openHere };
}
