import { state } from "./state.js";
import { TERM, CAMPUS_NAMES, LOCATION_NAMES } from "./config.js";
import { el } from "./dom.js";
import { num, DOT } from "./util.js";
import { expandAbbreviations } from "./search.js";
import { updateHistoryNote } from "./detection.js";
import { renderOpenSet, renderResults, renderWatchlist, renderFeed } from "./render.js";
import { setPulse, tickClock } from "./status.js";

export async function loadCatalog(campus) {
  const response = await fetch(`data/catalog-${TERM}-${campus}.json`);
  if (!response.ok) throw new Error(`catalogue returned ${response.status}`);
  const payload = await response.json();
  if (campus !== state.campus) return null;

  state.courses = payload.courses;
  state.sectionsByIndex = new Map();
  const locations = new Set();

  for (const course of state.courses) {
    // Precomputed per course so filtering stays cheap across ~4,400 courses on
    // every keystroke. Title is kept separate so a title hit outranks a
    // professor hit.
    course._title = `${course.title} ${expandAbbreviations(course.title)}`.toLowerCase();
    course._code = course.code.toLowerCase();
    course._who = course.sections.flatMap((s) => s.instructors).join(" ").toLowerCase();
    course._subject = course.subjectName.toLowerCase();
    course._indexes = new Set(course.sections.map((s) => s.index));

    for (const section of course.sections) {
      section._days = new Set(section.meets.flatMap((m) => [...m.days]));
      section._locs = new Set(section.meets.map((m) => m.campus).filter(Boolean));
      for (const l of section._locs) locations.add(l);
      state.sectionsByIndex.set(section.index, { section, course });
    }
  }

  el.statSections.textContent = num(payload.meta.counts.sections);
  el.termLabel.textContent = `${payload.meta.termName} ${DOT} ${CAMPUS_NAMES[campus]}`;
  fillSelect(
    el.core,
    Object.entries(payload.meta.coreCodes).map(([c, n]) => [c, `${c} ${DOT} ${n} courses`]),
    "Any core code"
  );
  fillSelect(
    el.loc,
    [...locations].sort().map((l) => [l, LOCATION_NAMES[l] || l]),
    "Anywhere"
  );
  return payload;
}

export function fillSelect(select, options, placeholder) {
  const current = select.value;
  select.innerHTML = `<option value="">${placeholder}</option>`;
  for (const [value, label] of options) {
    select.append(Object.assign(document.createElement("option"), { value, textContent: label }));
  }
  select.value = current;
}

export async function fetchOpen(campus) {
  // Resolve failures as data so a fast rejection cannot go unhandled while
  // the catalog is still loading in parallel.
  try {
    const response = await fetch(`${apiBase()}/api/open?term=${TERM}&campus=${campus}`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error(`Live status HTTP ${response.status}`);
    const indexes = await response.json();
    if (!Array.isArray(indexes) || indexes.some((i) => !/^\d{5}$/.test(String(i)))) {
      throw new Error("Invalid open-section response");
    }
    return { indexes: indexes.map(String), observedAt: new Date() };
  } catch (error) { return { error }; }
}

export async function poll({ prepared = null } = {}) {
  const campus = state.campus;
  const requestId = ++pollRequestId;
  setPulse("loading", "checking…");
  const { indexes, observedAt, error } = await (prepared ?? fetchOpen(campus));
  if (campus !== state.campus || requestId !== pollRequestId) return;
  if (error) {
    state.liveStatus = state.seenBaseline ? "stale" : "unavailable";
    setPulse("error", state.seenBaseline ? "live updates delayed" : "status unavailable");
    renderResults();
    renderWatchlist();
    return;
  }
  if (state.lastPollAt && observedAt < state.lastPollAt) return;
  renderOpenSet(new Set(indexes), { observedAt });
  state.polls += 1;
  state.lastPollAt = observedAt;
  state.liveStatus = "ready";
  el.pollCount.textContent = `${state.polls} check${state.polls === 1 ? "" : "s"}`;
  el.pulse.dataset.state = "live";
  tickClock();
  renderResults();
  renderWatchlist();
  renderFeed();
}

let pollRequestId = 0;

export async function fetchDailyHistory() {
  try {
    const response = await fetch(`${apiBase()}/api/history?term=${TERM}`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error(`Daily history HTTP ${response.status}`);
    const payload = await response.json();
    if (payload.schemaVersion !== 3 || payload.term !== TERM || payload.sampling !== "daily" ||
        !Number.isFinite(Date.parse(payload.checkedAt)) ||
        !payload.sections || typeof payload.sections !== "object" || Array.isArray(payload.sections)) {
      throw new Error("Invalid daily history");
    }
    return { payload };
  } catch (error) { return { error }; }
}

export async function loadDailyHistory({ prepared = null } = {}) {
  const { payload, error } = await (prepared ?? fetchDailyHistory());
  if (error) state.historyStatus = state.history ? "stale" : "unavailable";
  else if (!state.history || Date.parse(payload.checkedAt) >= Date.parse(state.history.checkedAt)) {
    state.history = payload;
    state.historyStatus = Date.now() - Date.parse(payload.checkedAt) > 48 * 3600_000 ? "stale" : "ready";
  }
  updateHistoryNote();
  renderResults();
  renderWatchlist();
}

export function apiBase() {
  return (document.querySelector('meta[name="api-base"]')?.content || "").replace(/\/$/, "");
}
