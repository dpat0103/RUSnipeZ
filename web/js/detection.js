import { state } from "./state.js";
import { $ } from "./dom.js";

export function updateHistoryNote() {
  const message = {
    loading: "Loading daily history…",
    ready: `Daily history checked ${historyDate(state.history?.sampleDate)} (Eastern). Brief openings between daily checks can be missed.`,
    stale: "Daily history updates are delayed. Saved dates remain visible; live seat checks run separately.",
    unavailable: "Daily history is unavailable. Live seat checks still run every 30 seconds while this tab is open.",
  }[state.historyStatus];
  $("history-status").textContent = message;
}

export function openingInfo(index) {
  const shared = state.history?.sections[index];
  const local = state.lastSeenOpen.get(index);
  if (local && (!shared || local > shared.lastSeenOpen)) {
    return { lastSeenOpen: local, local: true };
  }
  return shared;
}

export function openingLabel(index, detailed = false) {
  const record = openingInfo(index);
  if (!record || !/^\d{4}-\d{2}-\d{2}$/.test(record.lastSeenOpen ?? "")) {
    if (state.historyStatus === "loading") return "Loading daily history…";
    if (state.historyStatus === "ready") return "Not seen open in daily snapshots";
    if (state.historyStatus === "stale") return "No saved observation · daily update delayed";
    return "Daily history unavailable";
  }
  return `${detailed ? "" : "Last seen open · "}${historyDate(record.lastSeenOpen)}${record.local ? " · this visit" : ""}`;
}

export function historyDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? "")) return "unknown date";
  return new Date(`${value}T12:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC", month: "short", day: "numeric", year: "numeric",
  });
}

export function easternDay(value) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(value).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
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
  const day = easternDay(observedAt);
  for (const index of next) {
    if (state.sectionsByIndex.has(index)) state.lastSeenOpen.set(index, day);
  }
  return { ...changes, baseline, openHere };
}
