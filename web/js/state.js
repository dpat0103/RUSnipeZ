import { PAGE_SIZE, DEFAULT_FILTERS, STORAGE_KEY } from "./config.js";

export const state = {
  campus: "NB",
  courses: [],
  sectionsByIndex: new Map(),
  open: new Set(),
  lastSeenOpen: new Map(),
  liveStatus: "loading",
  history: null,
  historyStatus: "loading",
  seenBaseline: false,
  watch: new Set(),
  expanded: new Set(),
  events: [],
  polls: 0,
  lastPollAt: null,
  shown: PAGE_SIZE,
  notify: false,
  filters: { ...DEFAULT_FILTERS },
};
export function loadWatch() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) state.watch = new Set(JSON.parse(raw));
  } catch {
    /* private mode or blocked storage; the page still works */
  }
}

export function saveWatch() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...state.watch]));
  } catch {
    /* non-fatal */
  }
}

