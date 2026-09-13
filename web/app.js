/**
 * RU SnipeZ, live section monitor.
 *
 * The catalogue (titles, professors, meeting times) is a static file compiled
 * daily from the Schedule of Classes API. Only open/closed status is live, and
 * it arrives through a same-origin edge proxy because the university endpoint
 * sends no cross-origin headers.
 *
 * Detection is a set difference: each cycle computes `new - previous`, so a
 * section that was already open produces no event and needs no suppression.
 */

const TERM = "92026";
const TERM_NAME = "Fall 2026";
const CAMPUS_NAMES = { NB: "New Brunswick", NK: "Newark", CM: "Camden" };

// The endpoint declares Cache-Control: max-age=30, so a faster cycle cannot
// surface anything this one would miss.
const POLL_SECONDS = 30;
const PAGE_SIZE = 40;
const MAX_EVENTS = 60;
const WEBREG = `https://sims.rutgers.edu/webreg/editSchedule.htm?login=cas&semesterSelection=${TERM}&indexList=`;
const STORAGE_KEY = "rusnipez.watch.v1";
const INTRO_KEY = "rusnipez.intro.dismissed.v1";

const LOCATION_NAMES = {
  CAC: "College Avenue",
  BUS: "Busch",
  LIV: "Livingston",
  "D/C": "Cook / Douglass",
  ONL: "Online",
  DNB: "Downtown New Brunswick",
  OFF: "Off campus",
};

const DEFAULT_FILTERS = {
  q: "",
  core: "",
  loc: "",
  days: "",
  openOnly: false,
  hideSpn: false,
  sort: "relevance",
};

const state = {
  campus: "NB",
  courses: [],
  sectionsByIndex: new Map(),
  open: new Set(),
  seenOpen: new Map(),
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

const $ = (id) => document.getElementById(id);
const el = {
  results: $("results"),
  resultsLabel: $("results-label"),
  loadMore: $("load-more"),
  copyLink: $("copy-link"),
  feed: $("feed"),
  watchlist: $("watchlist"),
  watchFoot: $("watch-foot"),
  clearWatch: $("clear-watch"),
  notifyBtn: $("notify-btn"),
  simulateBtn: $("simulate-btn"),
  pulse: $("pulse"),
  pulseText: $("pulse-text"),
  statOpen: $("stat-open"),
  statSections: $("stat-sections"),
  statWatching: $("stat-watching"),
  termLabel: $("term-label"),
  pollCount: $("poll-count"),
  q: $("q"),
  campus: $("campus"),
  core: $("core"),
  loc: $("loc"),
  sort: $("sort"),
  tOpen: $("t-open"),
  tSpn: $("t-spn"),
  reset: $("reset"),
  dlg: $("alert-dlg"),
  dlgTitle: $("dlg-title"),
  dlgBody: $("dlg-body"),
  intro: $("intro"),
  introClose: $("intro-close"),
  toast: $("toast"),
};

/* ------------------------------- helpers ------------------------------- */

const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );

const num = (n) => n.toLocaleString("en-US");
const DOT = "·";

/** "15:50" becomes "3:50 PM" */
function clock(hhmm) {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")} ${suffix}`;
}

function meetingText(meets) {
  if (!meets || meets.length === 0) return "No meeting time listed";
  return meets
    .map((m) => {
      const when = m.start ? `${m.days || "TBA"} ${clock(m.start)}-${clock(m.end)}` : "Async";
      const where = [m.where, m.campus].filter(Boolean).join(` ${DOT} `);
      return where ? `${when} ${DOT} ${where}` : when;
    })
    .join("  |  ");
}

const timeLabel = (date) => date.toLocaleTimeString("en-US", { hour12: false });

let toastTimer;
function toast(message) {
  el.toast.textContent = message;
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.toast.hidden = true;
  }, 2600);
}

/* -------------------------------- data -------------------------------- */

async function loadCatalog(campus) {
  const response = await fetch(`data/catalog-${TERM}-${campus}.json`);
  if (!response.ok) throw new Error(`catalogue returned ${response.status}`);
  const payload = await response.json();

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

function fillSelect(select, options, placeholder) {
  const current = select.value;
  select.innerHTML = `<option value="">${placeholder}</option>`;
  for (const [value, label] of options) {
    select.append(Object.assign(document.createElement("option"), { value, textContent: label }));
  }
  select.value = current;
}

async function poll() {
  setPulse("loading", "checking…");
  try {
    const response = await fetch(`/api/open?term=${TERM}&campus=${state.campus}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const indexes = await response.json();
    applyOpenSet(new Set(indexes.map(String)));
    state.polls += 1;
    state.lastPollAt = new Date();
    el.pollCount.textContent = `${state.polls} check${state.polls === 1 ? "" : "s"}`;
    tickClock();
  } catch (err) {
    setPulse("error", "cannot reach Rutgers");
    pushEvent({ kind: "error", text: `Check failed: ${esc(err.message)}. Retrying.` });
    renderFeed();
    return;
  }
  renderFeed();
}

/** Diff the new open set against the previous one and announce the difference. */
function applyOpenSet(next) {
  const previous = state.open;
  state.open = next;
  el.statOpen.textContent = num(next.size);

  const now = new Date();
  for (const index of next) state.seenOpen.set(index, now);

  if (!state.seenBaseline) {
    state.seenBaseline = true;
    pushEvent({
      kind: "baseline",
      text: `Watching <strong>${num(next.size)}</strong> open sections across ${CAMPUS_NAMES[state.campus]}`,
    });
    renderResults();
    renderWatchlist();
    return;
  }

  const opened = [...next].filter((i) => !previous.has(i) && state.sectionsByIndex.has(i));
  const closed = [...previous].filter((i) => !next.has(i) && state.sectionsByIndex.has(i));

  for (const index of opened.slice(0, 12)) {
    const { course, section } = state.sectionsByIndex.get(index);
    pushEvent({
      kind: "opened",
      text: `<strong>OPENED</strong> <code>${esc(index)}</code> ${esc(course.title)} sec ${esc(section.number)}`,
    });
    if (state.watch.has(index)) announce(index);
  }
  for (const index of closed.slice(0, 12)) {
    const { course, section } = state.sectionsByIndex.get(index);
    pushEvent({
      kind: "closed",
      text: `closed <code>${esc(index)}</code> ${esc(course.title)} sec ${esc(section.number)}`,
    });
  }
  if (opened.length === 0 && closed.length === 0) {
    pushEvent({ kind: "tick", text: `No change, ${num(next.size)} open` });
  }

  renderResults(new Set(opened));
  renderWatchlist();
}

/** Deliver an opening for a watched section through every enabled channel. */
function announce(index, { simulated = false } = {}) {
  const entry = state.sectionsByIndex.get(index);
  if (!entry) return;
  const { course, section } = entry;

  if (state.notify && "Notification" in window && Notification.permission === "granted") {
    const note = new Notification(`${course.title} is open`, {
      body: `Section ${section.number}, index ${index}${simulated ? " (test alert)" : ""}`,
      icon: "logo.png",
      tag: `rusnipez-${index}`,
    });
    note.onclick = () => {
      window.open(WEBREG + encodeURIComponent(index), "_blank", "noopener");
      note.close();
    };
  }
  showAlert(index, { auto: true, simulated });
}

function pushEvent(event) {
  state.events.unshift({ ...event, at: new Date() });
  state.events.length = Math.min(state.events.length, MAX_EVENTS);
}

/* ------------------------------- search ------------------------------- */

/**
 * Rutgers abbreviates course titles heavily ("MICROBIOL HLTH SCI",
 * "ADV ORGANIC CHEM I"), so the expanded form is added to the searchable text
 * and someone typing the full words still finds the course.
 */
const ABBREVIATIONS = {
  adv: "advanced", amer: "american", anal: "analysis", appl: "applied",
  biol: "biology", chem: "chemistry", comp: "computer computational",
  dev: "development", econ: "economics", elem: "elementary", engr: "engineering",
  environ: "environmental", hist: "history", hlth: "health", intr: "introduction",
  intro: "introduction", interm: "intermediate", lang: "language", lit: "literature",
  math: "mathematics", mgmt: "management", microbiol: "microbiology", org: "organic",
  phys: "physics", prin: "principles", prob: "probability", psych: "psychology",
  sci: "science", stat: "statistics", struct: "structures", sys: "systems",
  thry: "theory", writ: "writing",
};

function expandAbbreviations(title) {
  return title
    .toLowerCase()
    .split(/[^a-z]+/)
    .map((word) => ABBREVIATIONS[word] || "")
    .filter(Boolean)
    .join(" ");
}

// These match most of the catalogue and distort ranking if scored.
const STOPWORDS = new Set(["to", "of", "the", "and", "in", "for", "a", "an", "i", "ii"]);

function queryTerms(q) {
  const all = q.toLowerCase().split(/\s+/).filter(Boolean);
  const meaningful = all.filter((t) => !STOPWORDS.has(t));
  return meaningful.length ? meaningful : all;
}

/**
 * Tokens score independently and sum, rather than all being required, so
 * "expository writing" still finds COLLEGE WRITING. Matching every token
 * still ranks highest.
 */
function score(course, terms) {
  let total = 0;
  let matched = 0;

  for (const term of terms) {
    let best = 0;
    if (course._indexes.has(term)) best = 1000;
    else if (course._code.includes(term)) best = 60;
    else if (course._title.includes(term)) {
      best = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(course._title)
        ? 40
        : 22;
    } else if (course._who.includes(term)) best = 30;
    else if (course._subject.includes(term)) best = 12;

    if (best > 0) matched += 1;
    total += best;
  }

  if (matched === 0) return 0;
  if (matched === terms.length) total *= 2;
  // Break ties toward courses that actually offer many sections, capped so it
  // can never outweigh a real token match.
  return total + Math.min(15, Math.log2(1 + course.sections.length) * 2.2);
}

function filtered() {
  const { q, core, loc, days, openOnly, hideSpn, sort } = state.filters;
  const terms = queryTerms(q);
  const dayFilter = [...days];

  const out = [];
  for (const course of state.courses) {
    if (core && !course.core.includes(core)) continue;

    let relevance = 0;
    if (terms.length) {
      relevance = score(course, terms);
      if (relevance === 0) continue;
    }

    const sections = course.sections.filter((s) => {
      if (hideSpn && s.spn) return false;
      if (openOnly && !state.open.has(s.index)) return false;
      if (loc && !s._locs.has(loc)) return false;
      if (dayFilter.length && !dayFilter.every((d) => s._days.has(d))) return false;
      return true;
    });
    if (sections.length === 0) continue;
    out.push({ course, sections, relevance });
  }

  const openCount = (row) => row.sections.filter((s) => state.open.has(s.index)).length;
  const byCode = (a, b) => a.course.code.localeCompare(b.course.code);

  if (sort === "open") out.sort((a, b) => openCount(b) - openCount(a) || byCode(a, b));
  else if (sort === "code") out.sort(byCode);
  else if (sort === "sections") out.sort((a, b) => b.sections.length - a.sections.length || byCode(a, b));
  else if (terms.length) out.sort((a, b) => b.relevance - a.relevance || byCode(a, b));
  else out.sort(byCode);

  return out;
}

/* ------------------------------ rendering ------------------------------ */

function renderResults(justOpened = new Set()) {
  const matches = filtered();
  const shown = matches.slice(0, state.shown);
  const sectionCount = matches.reduce((n, m) => n + m.sections.length, 0);
  const openCount = matches.reduce(
    (n, m) => n + m.sections.filter((s) => state.open.has(s.index)).length,
    0
  );

  el.resultsLabel.textContent = matches.length
    ? `${num(matches.length)} courses ${DOT} ${num(sectionCount)} sections ${DOT} ${num(openCount)} open now`
    : "Nothing matches those filters.";

  el.reset.hidden = !isFiltered();

  if (matches.length === 0) {
    el.results.innerHTML =
      '<div class="panel"><div class="panel-body"><p class="empty">No sections match. Try a broader search, or reset the filters.</p></div></div>';
    el.loadMore.hidden = true;
    return;
  }

  el.results.innerHTML = shown
    .map(({ course, sections }) => renderCourse(course, sections, justOpened))
    .join("");

  const remaining = matches.length - shown.length;
  el.loadMore.hidden = remaining <= 0;
  el.loadMore.textContent = `Show ${Math.min(remaining, PAGE_SIZE)} more of ${num(remaining)} remaining`;
}

function renderCourse(course, sections, justOpened) {
  const credits = course.credits != null ? `${course.credits} cr` : course.creditsText || "";
  const chips = [
    credits && `<span class="chip">${esc(credits)}</span>`,
    ...course.core.slice(0, 3).map((c) => `<span class="chip core">${esc(c)}</span>`),
  ]
    .filter(Boolean)
    .join("");

  return `<article class="course">
    <div class="course-head">
      <span class="course-code">${esc(course.code)}</span>
      <h3 class="course-title">${esc(course.title)}</h3>
      <span class="course-meta">${chips}</span>
    </div>
    <div class="sections">
      ${sections.map((s) => renderSection(s, course, justOpened)).join("")}
    </div>
  </article>`;
}

function renderSection(section, course, justOpened) {
  const isOpen = state.open.has(section.index);
  const watched = state.watch.has(section.index);
  const expanded = state.expanded.has(section.index);
  const flash = justOpened.has(section.index) ? " just-opened" : "";

  // A section observed open and then closed during this visit is the "just
  // missed it" case, and the only history a tab-scoped page can honestly show.
  const seen =
    !isOpen && state.seenOpen.has(section.index)
      ? `<span class="seen" title="Seen open during this visit">seen ${timeLabel(
          state.seenOpen.get(section.index)
        )}</span>`
      : "";

  const badges = [
    seen,
    section.spn
      ? '<span class="badge spn" title="Requires a special permission number">SPN</span>'
      : "",
    section.crossListed.length
      ? `<span class="badge xl" title="Also listed as ${esc(section.crossListed.join(", "))}">XL</span>`
      : "",
  ].join("");

  return `<div class="section${isOpen ? " is-open" : ""}${flash}" data-section="${esc(
    section.index
  )}" aria-expanded="${expanded}">
    <span class="idx">${esc(section.index)}</span>
    <span class="secnum">${esc(section.number)}</span>
    <span class="secdetail">
      <span class="prof"><span class="caret"></span>${esc(
        section.instructors.join(", ") || "Instructor TBA"
      )}</span>
      <span class="meets">${esc(meetingText(section.meets))}</span>
    </span>
    <span class="badges">${badges}</span>
    <span class="status ${isOpen ? "open" : "closed"}">${isOpen ? "OPEN" : "CLOSED"}</span>
    <button class="watch" data-index="${esc(section.index)}" aria-pressed="${watched}">
      ${watched ? "Watching" : "Watch"}
    </button>
    ${expanded ? renderDetail(section, course) : ""}
  </div>`;
}

function renderDetail(section, course) {
  const rows = [];
  rows.push([
    "Index",
    `<code>${esc(section.index)}</code><button class="copyidx" data-copy="${esc(
      section.index
    )}">copy</button>`,
  ]);
  rows.push(["Section", `${esc(section.number)} of ${esc(course.code)}`]);
  if (section.subtitle) rows.push(["Topic", esc(section.subtitle)]);
  rows.push([
    "Meets",
    section.meets.length
      ? section.meets
          .map((m) =>
            m.start
              ? `${esc(m.days || "TBA")} ${esc(clock(m.start))} to ${esc(clock(m.end))} ${DOT} ${esc(
                  m.mode
                )}${m.where ? ` ${DOT} ${esc(m.where)}` : ""}${
                  m.campus ? ` (${esc(LOCATION_NAMES[m.campus] || m.campus)})` : ""
                }`
              : esc(m.mode || "Asynchronous")
          )
          .join("<br>")
      : "Not listed",
  ]);
  if (section.exam) rows.push(["Final exam", esc(section.exam)]);
  if (course.core.length) rows.push(["Satisfies", esc(course.core.join(", "))]);
  if (course.prereqs) rows.push(["Prerequisites", esc(course.prereqs)]);
  if (section.spn) {
    rows.push([
      "Restriction",
      "Needs a special permission number from the department before you can register.",
    ]);
  }
  if (section.crossListed.length) {
    rows.push([
      "Cross-listed",
      `<code>${esc(section.crossListed.join(", "))}</code>, same class with a separate seat pool`,
    ]);
  }
  if (course.synopsis) {
    rows.push([
      "Department page",
      `<a href="${esc(course.synopsis)}" target="_blank" rel="noopener">Course description</a>`,
    ]);
  }
  rows.push([
    "Register",
    `<a href="${WEBREG}${encodeURIComponent(
      section.index
    )}" target="_blank" rel="noopener">Open WebReg with this index</a>`,
  ]);

  return `<dl class="detail">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>`;
}

function renderFeed() {
  if (state.events.length === 0) {
    el.feed.innerHTML =
      '<div class="panel-body"><p class="empty">Waiting for the first check.</p></div>';
    return;
  }
  el.feed.innerHTML = state.events
    .map(
      (e) => `<div class="event ${esc(e.kind)}">
        <time datetime="${e.at.toISOString()}">${timeLabel(e.at)}</time>
        <span class="what">${e.text}</span>
      </div>`
    )
    .join("");
}

function renderWatchlist() {
  el.statWatching.textContent = String(state.watch.size);
  el.clearWatch.hidden = state.watch.size === 0;
  el.watchFoot.hidden = state.watch.size === 0;

  if (state.watch.size === 0) {
    el.watchlist.innerHTML =
      '<div class="panel-body"><p class="empty">Nothing watched yet. Find a section and press <strong>Watch</strong> to see exactly what an alert looks like.</p></div>';
    return;
  }

  // Open first: a watched section with a seat right now should never sit below
  // three closed ones.
  const rows = [...state.watch]
    .map((index) => ({ index, entry: state.sectionsByIndex.get(index) }))
    .filter((row) => row.entry)
    .sort((a, b) => Number(state.open.has(b.index)) - Number(state.open.has(a.index)));

  el.watchlist.innerHTML = rows
    .map(({ index, entry }) => {
      const { course, section } = entry;
      const isOpen = state.open.has(index);
      const first = section.meets[0];
      const when = first && first.start ? `${first.days} ${clock(first.start)}` : "Async";
      return `<div class="wl-item">
        <span>
          <span class="wl-title">${esc(course.title)}</span>
          <span class="wl-meta">${esc(index)} ${DOT} sec ${esc(section.number)} ${DOT} ${esc(when)}</span>
        </span>
        <span class="status ${isOpen ? "open" : "closed"}">${isOpen ? "OPEN" : "CLOSED"}</span>
        <span class="wl-actions">
          <button class="linkbtn" data-preview="${esc(index)}" title="Preview the alert">◉</button>
          <button class="wl-remove" data-unwatch="${esc(index)}" title="Stop watching ${esc(
            index
          )}" aria-label="Stop watching ${esc(index)}">×</button>
        </span>
      </div>`;
    })
    .join("");
}

/* -------------------------------- alert -------------------------------- */

function showAlert(index, { auto = false, simulated = false } = {}) {
  const entry = state.sectionsByIndex.get(index);
  if (!entry) return;
  const { course, section } = entry;

  const twins = section.crossListed.filter((i) => state.sectionsByIndex.has(i));
  const unwatched = twins.filter((i) => !state.watch.has(i));

  el.dlgTitle.textContent = simulated ? "Test alert" : auto ? "Section opened" : "Alert preview";

  el.dlgBody.innerHTML = `
    <div class="alert-card">
      <span class="a-title">${esc(course.title)} is now open</span>
      <dl>
        <dt>Index</dt><dd><code>${esc(section.index)}</code></dd>
        <dt>Section</dt><dd>${esc(section.number)} ${DOT} ${esc(course.code)}</dd>
        <dt>Professor</dt><dd>${esc(section.instructors.join(", ") || "TBA")}</dd>
        <dt>Meets</dt><dd>${esc(meetingText(section.meets))}</dd>
        ${
          section.crossListed.length
            ? `<dt>Also as</dt><dd><code>${esc(
                section.crossListed.join(", ")
              )}</code>, separate seat pool</dd>`
            : ""
        }
        ${
          section.spn
            ? "<dt>Heads up</dt><dd>Needs a special permission number from the department</dd>"
            : ""
        }
      </dl>
      <span class="alert-foot">${esc(timeLabel(new Date()))} ${DOT} ${esc(TERM_NAME)} ${DOT} ${esc(
        CAMPUS_NAMES[state.campus]
      )}</span>
    </div>
    <a class="reg-btn" href="${WEBREG}${encodeURIComponent(
      section.index
    )}" target="_blank" rel="noopener">
      Register on WebReg
    </a>
    ${
      unwatched.length
        ? `<button class="twin-btn" data-watch-twins="${esc(unwatched.join(","))}">
             Also watch ${
               unwatched.length === 1
                 ? `index ${esc(unwatched[0])}`
                 : `${unwatched.length} cross-listed indexes`
             }
           </button>`
        : ""
    }
    <p class="dlg-note">${
      simulated
        ? "This is a test alert you triggered, not a real opening. It travels the same path a real one does. "
        : ""
    }The button opens WebReg with the index already filled in. You sign in through CAS yourself, and RU SnipeZ never handles your NetID.</p>
  `;
  if (!el.dlg.open) el.dlg.showModal();
}

/* ------------------------------ url state ------------------------------ */

function isFiltered() {
  return Object.keys(DEFAULT_FILTERS).some((k) => state.filters[k] !== DEFAULT_FILTERS[k]);
}

/**
 * Filters live in the query string so any view can be shared or bookmarked and
 * comes back exactly as it was.
 */
function syncUrl() {
  const params = new URLSearchParams();
  if (state.campus !== "NB") params.set("campus", state.campus);
  for (const [key, fallback] of Object.entries(DEFAULT_FILTERS)) {
    const value = state.filters[key];
    if (value !== fallback) params.set(key, value === true ? "1" : value);
  }
  const query = params.toString();
  history.replaceState(null, "", `${location.pathname}${query ? `?${query}` : ""}${location.hash}`);
}

function applyFiltersToControls() {
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

function readUrl() {
  const params = new URLSearchParams(location.search);
  for (const key of Object.keys(DEFAULT_FILTERS)) {
    if (!params.has(key)) continue;
    const raw = params.get(key);
    state.filters[key] = typeof DEFAULT_FILTERS[key] === "boolean" ? raw === "1" : raw;
  }
  applyFiltersToControls();
}

function changed() {
  state.shown = PAGE_SIZE;
  syncUrl();
  renderResults();
}

/* ------------------------------- routing ------------------------------- */

const VIEWS = ["monitor", "how", "about"];

function showView(name) {
  const view = VIEWS.includes(name) ? name : "monitor";
  for (const other of VIEWS) $(`view-${other}`).hidden = other !== view;
  for (const link of document.querySelectorAll(".tabs a")) {
    if (link.dataset.view === view) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  document.title =
    view === "monitor"
      ? "RU SnipeZ — live Rutgers section monitor"
      : `RU SnipeZ — ${view === "how" ? "how it works" : "about"}`;
  if (view !== "monitor") window.scrollTo(0, 0);
}

window.addEventListener("hashchange", () => showView(location.hash.slice(1)));

/* ------------------------------- wiring -------------------------------- */

function setPulse(kind, text) {
  el.pulse.dataset.state = kind;
  el.pulseText.textContent = text;
}

function tickClock() {
  if (el.pulse.dataset.state === "error" || !state.lastPollAt) return;
  const elapsed = Math.floor((Date.now() - state.lastPollAt) / 1000);
  setPulse("live", `live ${DOT} checked ${elapsed}s ago`);
}

function loadWatch() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) state.watch = new Set(JSON.parse(raw));
  } catch {
    /* private mode or blocked storage; the page still works */
  }
}

function saveWatch() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...state.watch]));
  } catch {
    /* non-fatal */
  }
}

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

el.q.addEventListener(
  "input",
  debounce(() => {
    state.filters.q = el.q.value.trim();
    changed();
  }, 130)
);

for (const [node, key] of [
  [el.core, "core"],
  [el.loc, "loc"],
  [el.sort, "sort"],
]) {
  node.addEventListener("change", () => {
    state.filters[key] = node.value;
    changed();
  });
}

for (const [button, key] of [
  [el.tOpen, "openOnly"],
  [el.tSpn, "hideSpn"],
]) {
  button.addEventListener("click", () => {
    state.filters[key] = !state.filters[key];
    button.setAttribute("aria-pressed", String(state.filters[key]));
    changed();
  });
}

el.reset.addEventListener("click", () => {
  state.filters = { ...DEFAULT_FILTERS };
  applyFiltersToControls();
  changed();
});

el.campus.addEventListener("change", async () => {
  state.campus = el.campus.value;
  state.seenBaseline = false;
  state.seenOpen.clear();
  state.events = [];
  state.expanded.clear();
  el.results.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>';
  await loadCatalog(state.campus);
  syncUrl();
  await poll();
});

el.loadMore.addEventListener("click", () => {
  state.shown += PAGE_SIZE;
  renderResults();
});

el.copyLink.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(location.href);
    toast("Link copied. It reproduces this exact search and filters.");
  } catch {
    toast("Could not copy. The address bar already holds this view.");
  }
});

el.clearWatch.addEventListener("click", () => {
  state.watch.clear();
  saveWatch();
  renderWatchlist();
  renderResults();
});

el.notifyBtn.addEventListener("click", async () => {
  if (!("Notification" in window)) {
    toast("This browser does not support desktop notifications.");
    return;
  }
  if (Notification.permission === "denied") {
    toast("Notifications are blocked for this site in your browser settings.");
    return;
  }
  const permission =
    Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
  state.notify = permission === "granted";
  el.notifyBtn.dataset.state = state.notify ? "on" : "";
  el.notifyBtn.textContent = state.notify ? "Desktop alerts on" : "Enable desktop alerts";
  toast(
    state.notify ? "Desktop alerts enabled for watched sections." : "Desktop alerts not enabled."
  );
});

el.simulateBtn.addEventListener("click", () => {
  const index = [...state.watch].find((i) => state.sectionsByIndex.has(i));
  if (!index) return;
  const { course, section } = state.sectionsByIndex.get(index);
  pushEvent({
    kind: "simulated",
    text: `<strong>TEST ALERT</strong> <code>${esc(index)}</code> ${esc(course.title)} sec ${esc(
      section.number
    )}`,
  });
  renderFeed();
  announce(index, { simulated: true });
});

el.introClose.addEventListener("click", () => {
  el.intro.hidden = true;
  try {
    localStorage.setItem(INTRO_KEY, "1");
  } catch {
    /* non-fatal */
  }
});

document.addEventListener("click", (event) => {
  const dayBtn = event.target.closest(".day");
  if (dayBtn) {
    const day = dayBtn.dataset.day;
    const days = new Set(state.filters.days);
    if (days.has(day)) days.delete(day);
    else days.add(day);
    state.filters.days = [..."MTWHF"].filter((d) => days.has(d)).join("");
    dayBtn.setAttribute("aria-pressed", String(days.has(day)));
    changed();
    return;
  }

  const watchBtn = event.target.closest(".watch");
  if (watchBtn) {
    const index = watchBtn.dataset.index;
    if (state.watch.has(index)) {
      state.watch.delete(index);
    } else {
      state.watch.add(index);
      showAlert(index);
    }
    saveWatch();
    watchBtn.setAttribute("aria-pressed", String(state.watch.has(index)));
    watchBtn.textContent = state.watch.has(index) ? "Watching" : "Watch";
    renderWatchlist();
    return;
  }

  const unwatchBtn = event.target.closest("[data-unwatch]");
  if (unwatchBtn) {
    state.watch.delete(unwatchBtn.dataset.unwatch);
    saveWatch();
    renderWatchlist();
    renderResults();
    return;
  }

  const twinBtn = event.target.closest("[data-watch-twins]");
  if (twinBtn) {
    for (const index of twinBtn.dataset.watchTwins.split(",")) state.watch.add(index);
    saveWatch();
    renderWatchlist();
    renderResults();
    twinBtn.replaceWith(
      Object.assign(document.createElement("p"), {
        className: "twin-done",
        textContent: "Added to your watchlist.",
      })
    );
    return;
  }

  const copyBtn = event.target.closest("[data-copy]");
  if (copyBtn) {
    navigator.clipboard
      .writeText(copyBtn.dataset.copy)
      .then(() => toast(`Index ${copyBtn.dataset.copy} copied.`))
      .catch(() => toast("Could not copy to clipboard."));
    return;
  }

  const quickBtn = event.target.closest(".quick");
  if (quickBtn) {
    el.q.value = quickBtn.dataset.q;
    state.filters.q = quickBtn.dataset.q;
    changed();
    return;
  }

  const previewBtn = event.target.closest("[data-preview]");
  if (previewBtn) {
    showAlert(previewBtn.dataset.preview);
    return;
  }

  // Anything else inside a section row toggles its detail panel.
  const row = event.target.closest(".section");
  if (row && !event.target.closest(".detail")) {
    const index = row.dataset.section;
    if (state.expanded.has(index)) state.expanded.delete(index);
    else state.expanded.add(index);
    renderResults();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "/" && document.activeElement !== el.q && !el.dlg.open) {
    event.preventDefault();
    el.q.focus();
    el.q.select();
  }
  if (event.key === "Escape" && document.activeElement === el.q && el.q.value) {
    el.q.value = "";
    state.filters.q = "";
    changed();
  }
});

$("dlg-close").addEventListener("click", () => el.dlg.close());
el.dlg.addEventListener("click", (event) => {
  if (event.target === el.dlg) el.dlg.close();
});

/* --------------------------------- boot -------------------------------- */

async function main() {
  showView(location.hash.slice(1));
  try {
    if (localStorage.getItem(INTRO_KEY)) el.intro.hidden = true;
  } catch {
    /* storage blocked, just show the intro */
  }
  loadWatch();
  renderWatchlist();
  renderFeed();

  if ("Notification" in window && Notification.permission === "granted") {
    state.notify = true;
    el.notifyBtn.dataset.state = "on";
    el.notifyBtn.textContent = "Desktop alerts on";
  }

  const params = new URLSearchParams(location.search);
  if (CAMPUS_NAMES[params.get("campus")]) state.campus = params.get("campus");

  try {
    await loadCatalog(state.campus);
  } catch (err) {
    el.resultsLabel.textContent = "Could not load the catalogue.";
    el.results.innerHTML = `<div class="panel"><div class="panel-body"><p class="empty">The catalogue failed to load: ${esc(
      err.message
    )}. Reload the page, or start the local dev server if you are running this from a checkout.</p></div></div>`;
    setPulse("error", "catalogue unavailable");
    return;
  }

  readUrl();
  renderResults();
  await poll();

  setInterval(poll, POLL_SECONDS * 1000);
  setInterval(tickClock, 1000);
}

main();
