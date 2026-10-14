import { state } from "./state.js";
import { DEFAULT_FILTERS } from "./config.js";
import { el } from "./dom.js";

export function isFiltered() {
  return Object.keys(DEFAULT_FILTERS).some((k) => state.filters[k] !== DEFAULT_FILTERS[k]);
}

/**
 * Filters live in the query string so any view can be shared or bookmarked and
 * comes back exactly as it was.
 */
export function syncUrl() {
  const params = new URLSearchParams();
  if (state.campus !== "NB") params.set("campus", state.campus);
  for (const [key, fallback] of Object.entries(DEFAULT_FILTERS)) {
    const value = state.filters[key];
    if (value !== fallback) params.set(key, value === true ? "1" : value);
  }
  const query = params.toString();
  history.replaceState(null, "", `${location.pathname}${query ? `?${query}` : ""}${location.hash}`);
}

export function applyFiltersToControls() {
  el.campus.value = state.campus;
  el.q.value = state.filters.q;
  el.core.value = state.filters.core;
  el.loc.value = state.filters.loc;
  el.sort.value = state.filters.sort;
  el.tOpen.setAttribute("aria-pressed", String(state.filters.openOnly));
  el.tSpn.setAttribute("aria-pressed", String(state.filters.hideSpn));
  for (const button of document.querySelectorAll(".day")) {
    button.setAttribute("aria-pressed", String(state.filters.days.includes(button.dataset.day)));
  }
}

export function readUrl() {
  const params = new URLSearchParams(location.search);
  for (const key of Object.keys(DEFAULT_FILTERS)) {
    if (!params.has(key)) continue;
    const raw = params.get(key);
    state.filters[key] = typeof DEFAULT_FILTERS[key] === "boolean" ? raw === "1" : raw;
  }
  applyFiltersToControls();
}

