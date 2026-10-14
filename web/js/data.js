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

export async function fetchSnapshot(campus) {
  // Resolve failures as data so a fast rejection cannot go unhandled while
  // the catalog is still loading in parallel.
  try {
    const response = await fetch(`${apiBase()}/api/snapshot?term=${TERM}&campus=${campus}`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error(`Snapshot HTTP ${response.status}`);
    const payload = await response.json();
    if (payload.schemaVersion !== 2 || payload.term !== TERM ||
        !payload.sections || typeof payload.sections !== "object" || Array.isArray(payload.sections) ||
        !Array.isArray(payload.openIndexes) || payload.openIndexes.some((i) => !/^\d{5}$/.test(String(i))) ||
        !Number.isFinite(Date.parse(payload.checkedAt))) {
      throw new Error("Invalid snapshot");
    }
    return { payload };
  } catch (error) { return { error }; }
}

export async function poll({ prepared = null } = {}) {
  const campus = state.campus;
  const requestId = ++pollRequestId;
  setPulse("loading", "checking…");
  const { payload, error } = await (prepared ?? fetchSnapshot(campus));
  if (campus !== state.campus || requestId !== pollRequestId) return;
  if (error) {
    state.historyStatus = state.history ? "stale" : "unavailable";
    setPulse("error", state.history ? "updates delayed" : "status unavailable");
    updateHistoryNote();
    renderResults();
    renderWatchlist();
    return;
  }
  // Older edge responses must not roll the UI back or duplicate notifications.
  if (state.history?.checkedAt && Date.parse(payload.checkedAt) < Date.parse(state.history.checkedAt)) {
    tickClock();
    return;
  }
  const fresh = Date.now() - Date.parse(payload.checkedAt) <= 90_000;
  const changed = !state.seenBaseline || state.history?.checkedAt !== payload.checkedAt;
  state.history = payload;
  state.historyStatus = fresh ? "ready" : "stale";
  if (changed) {
    renderOpenSet(new Set(payload.openIndexes.map(String)), {
      observedAt: new Date(payload.checkedAt), fresh,
    });
    state.polls += 1;
    state.lastPollAt = new Date(payload.checkedAt);
    el.pollCount.textContent = `${state.polls} check${state.polls === 1 ? "" : "s"}`;
  }
  if (!fresh) setPulse("error", "updates delayed");
  else { el.pulse.dataset.state = "live"; tickClock(); }
  updateHistoryNote();
  renderResults();
  renderWatchlist();
  renderFeed();
}

let pollRequestId = 0;

export function apiBase() {
  return (document.querySelector('meta[name="api-base"]')?.content || "").replace(/\/$/, "");
}
