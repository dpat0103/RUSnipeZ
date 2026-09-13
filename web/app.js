/**
 * RU SnipeZ — live section monitor.
 *
 * The catalogue (titles, professors, meeting times) is a static JSON file built
 * ahead of time from the Schedule of Classes API. Only the open/closed status
 * is live, and it comes from /api/open via the edge proxy — upstream sends no
 * CORS headers, so the browser cannot call Rutgers directly.
 *
 * Polling is edge-triggered: each tick diffs the new open set against the
 * previous one, so a section that stays open does not re-announce itself.
 */

const TERM = "92026";
const TERM_NAME = "Fall 2026";
const CAMPUS_NAMES = { NB: "New Brunswick", NK: "Newark", CM: "Camden" };

// Upstream advertises Cache-Control: max-age=30, so polling faster than this
// is not promised fresher data.
const POLL_SECONDS = 30;
const MAX_COURSES_RENDERED = 50;
const MAX_EVENTS = 60;
const WEBREG = `https://sims.rutgers.edu/webreg/editSchedule.htm?login=cas&semesterSelection=${TERM}&indexList=`;
const STORAGE_KEY = "rusnipez.watch.v1";

const state = {
  campus: "NB",
  courses: [],
  sectionsByIndex: new Map(),
  open: new Set(),
  // Session-local record of when we last observed each index open. Persistent
  // last-opened history needs an always-on poller and a per-term store —
  // index numbers are recycled between terms, so it cannot be a flat index->date
  // map the way V1 kept it.
  seenOpen: new Map(),
  seenBaseline: false,
  watch: new Set(),
  events: [],
  polls: 0,
  lastPollAt: null,
  filters: { q: "", core: "", openOnly: false, hideSpn: false },
};

const $ = (id) => document.getElementById(id);
const el = {
  results: $("results"),
  resultsLabel: $("results-label"),
  feed: $("feed"),
  watchlist: $("watchlist"),
  clearWatch: $("clear-watch"),
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
  tOpen: $("t-open"),
  tSpn: $("t-spn"),
  dlg: $("alert-dlg"),
  dlgBody: $("dlg-body"),
  intro: $("intro"),
  introClose: $("intro-close"),
};

const INTRO_KEY = "rusnipez.intro.dismissed.v1";

/* ------------------------------- helpers ------------------------------- */

const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );

const num = (n) => n.toLocaleString("en-US");

/** "15:50" -> "3:50 PM" */
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
      const when = m.start ? `${m.days || "—"} ${clock(m.start)}–${clock(m.end)}` : "Async";
      const where = [m.where, m.campus].filter(Boolean).join(" · ");
      return where ? `${when} · ${where}` : when;
    })
    .join("  |  ");
}

function timeLabel(date) {
  return date.toLocaleTimeString("en-US", { hour12: false });
}

/* -------------------------------- data -------------------------------- */

async function loadCatalog(campus) {
  const response = await fetch(`data/catalog-${TERM}-${campus}.json`);
  if (!response.ok) throw new Error(`catalogue ${response.status}`);
  const payload = await response.json();

  state.courses = payload.courses;
  state.sectionsByIndex = new Map();

  for (const course of state.courses) {
    // Precompute lowercase haystacks per course so filtering stays cheap
    // across ~4,400 courses on every keystroke. Titles are kept separate from
    // everything else so a title hit can outrank an instructor hit.
    course._title = `${course.title} ${expandAbbreviations(course.title)}`.toLowerCase();
    course._code = course.code.toLowerCase();
    course._who = course.sections
      .flatMap((s) => s.instructors)
      .join(" ")
      .toLowerCase();
    course._subject = course.subjectName.toLowerCase();
    course._indexes = new Set(course.sections.map((s) => s.index));

    for (const section of course.sections) {
      state.sectionsByIndex.set(section.index, { section, course });
    }
  }

  el.statSections.textContent = num(payload.meta.counts.sections);
  el.termLabel.textContent = `${payload.meta.termName} · ${CAMPUS_NAMES[campus]}`;
  populateCoreCodes(payload.meta.coreCodes);
  return payload;
}

function populateCoreCodes(coreCodes) {
  const current = el.core.value;
  el.core.innerHTML = '<option value="">Any core code</option>';
  for (const [code, count] of Object.entries(coreCodes)) {
    const option = document.createElement("option");
    option.value = code;
    option.textContent = `${code} · ${count} courses`;
    el.core.append(option);
  }
  el.core.value = current;
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
    el.pollCount.textContent = `${state.polls} poll${state.polls === 1 ? "" : "s"}`;
  } catch (err) {
    setPulse("error", "upstream unreachable");
    pushEvent({ kind: "error", text: `Poll failed — ${esc(err.message)}` });
    return;
  }
  renderFeed();
}

/** Diff the new open set against the previous one and record what changed. */
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
      text: `Baseline — <strong>${num(next.size)}</strong> sections open across ${CAMPUS_NAMES[state.campus]}`,
    });
    renderResults();
    return;
  }

  const opened = [...next].filter((i) => !previous.has(i) && state.sectionsByIndex.has(i));
  const closed = [...previous].filter((i) => !next.has(i) && state.sectionsByIndex.has(i));

  for (const index of opened.slice(0, 12)) {
    const { course, section } = state.sectionsByIndex.get(index);
    pushEvent({
      kind: "opened",
      index,
      text: `<strong>OPENED</strong> <code>${esc(index)}</code> ${esc(course.title)} sec ${esc(section.number)}`,
    });
    if (state.watch.has(index)) showAlert(index, { auto: true });
  }
  for (const index of closed.slice(0, 12)) {
    const { course, section } = state.sectionsByIndex.get(index);
    pushEvent({
      kind: "closed",
      index,
      text: `closed <code>${esc(index)}</code> ${esc(course.title)} sec ${esc(section.number)}`,
    });
  }
  if (opened.length === 0 && closed.length === 0) {
    pushEvent({ kind: "tick", text: `No change — ${num(next.size)} open` });
  }

  renderResults(new Set(opened));
}

function pushEvent(event) {
  state.events.unshift({ ...event, at: new Date() });
  state.events.length = Math.min(state.events.length, MAX_EVENTS);
}

/* ------------------------------ rendering ------------------------------ */

/**
 * Rutgers abbreviates course titles aggressively — "MICROBIOL HLTH SCI",
 * "ADV ORGANIC CHEM I". Someone typing "microbiology health science" should
 * still find it, so both forms go into the searchable text.
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

/**
 * Score a course against the query. Returns 0 for no match.
 *
 * Tokens are scored independently and summed, rather than requiring all of
 * them — "expository writing" finds COLLEGE WRITING, which is what that course
 * is actually called. Matching every token still ranks highest.
 */
function score(course, terms) {
  let total = 0;
  let matched = 0;

  for (const term of terms) {
    let best = 0;
    if (course._indexes.has(term)) best = 1000;
    else if (course._code.includes(term)) best = 60;
    else if (course._title.includes(term)) {
      // A match at a word boundary beats one buried mid-word.
      best = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(course._title)
        ? 40
        : 22;
    } else if (course._who.includes(term)) best = 30;
    else if (course._subject.includes(term)) best = 12;

    if (best > 0) matched += 1;
    total += best;
  }

  if (matched === 0) return 0;
  // Reward queries where every token landed, so precise searches stay on top.
  if (matched === terms.length) total *= 2;

  // Break ties toward courses that actually offer a lot of sections. A search
  // for "writing" should surface COLLEGE WRITING (109 sections) above a
  // one-section seminar that happens to share the word. Capped so it can never
  // outweigh a real token match.
  return total + Math.min(15, Math.log2(1 + course.sections.length) * 2.2);
}

// Dropped from queries: they match half the catalogue and distort ranking —
// "intro to computer science" was ranking INTRODUCTION TO DATA SCIENCE above
// INTRO COMPUTER SCI purely on the "to".
const STOPWORDS = new Set(["to", "of", "the", "and", "in", "for", "a", "an", "i", "ii"]);

function queryTerms(q) {
  const all = q.toLowerCase().split(/\s+/).filter(Boolean);
  const meaningful = all.filter((t) => !STOPWORDS.has(t));
  // If someone searches only stopwords, honour it rather than matching nothing.
  return meaningful.length ? meaningful : all;
}

function filtered() {
  const { q, core, openOnly, hideSpn } = state.filters;
  const terms = queryTerms(q);

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
      return true;
    });
    if (sections.length === 0) continue;
    out.push({ course, sections, relevance });
  }

  if (terms.length) out.sort((a, b) => b.relevance - a.relevance || a.course.code.localeCompare(b.course.code));
  return out;
}

function renderResults(justOpened = new Set()) {
  const matches = filtered();
  const shown = matches.slice(0, MAX_COURSES_RENDERED);
  const sectionCount = matches.reduce((n, m) => n + m.sections.length, 0);

  const openCount = matches.reduce(
    (n, m) => n + m.sections.filter((s) => state.open.has(s.index)).length,
    0
  );
  el.resultsLabel.textContent = matches.length
    ? `${num(matches.length)} courses · ${num(sectionCount)} sections · ${num(openCount)} open now` +
      (matches.length > shown.length ? ` — showing first ${shown.length}` : "")
    : "No sections match those filters.";

  if (matches.length === 0) {
    el.results.innerHTML =
      '<div class="panel"><div class="panel-body"><p class="empty">Nothing matches. Try a broader search, or turn off “Open only”.</p></div></div>';
    return;
  }

  el.results.innerHTML = shown
    .map(({ course, sections }) => renderCourse(course, sections, justOpened))
    .join("");
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
      ${sections.map((s) => renderSection(s, justOpened)).join("")}
    </div>
  </article>`;
}

function renderSection(section, justOpened) {
  const isOpen = state.open.has(section.index);
  const watched = state.watch.has(section.index);
  const flash = justOpened.has(section.index) ? " just-opened" : "";

  // A section we watched open and then close this session is the "you just
  // missed it" case, and the only last-opened signal a tab-scoped demo can
  // honestly offer.
  const seen = !isOpen && state.seenOpen.has(section.index)
    ? `<span class="seen" title="Observed open during this browser session">seen ${timeLabel(state.seenOpen.get(section.index))}</span>`
    : "";

  const badges = [
    seen,
    section.spn ? '<span class="badge spn" title="Requires a special permission number">SPN</span>' : "",
    section.crossListed.length
      ? `<span class="badge xl" title="Also listed as ${esc(section.crossListed.join(", "))}">XL</span>`
      : "",
  ].join("");

  return `<div class="section${isOpen ? " is-open" : ""}${flash}">
    <span class="idx">${esc(section.index)}</span>
    <span class="secnum">${esc(section.number)}</span>
    <span class="secdetail">
      <span class="prof">${esc(section.instructors.join(", ") || "Instructor TBA")}</span>
      <span class="meets">${esc(meetingText(section.meets))}</span>
    </span>
    <span class="badges">${badges}</span>
    <span class="status ${isOpen ? "open" : "closed"}">${isOpen ? "OPEN" : "CLOSED"}</span>
    <button class="watch" data-index="${esc(section.index)}" aria-pressed="${watched}">
      ${watched ? "Watching" : "Watch"}
    </button>
  </div>`;
}

function renderFeed() {
  if (state.events.length === 0) {
    el.feed.innerHTML =
      '<div class="panel-body"><p class="empty">Waiting for the first poll…</p></div>';
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

  if (state.watch.size === 0) {
    el.watchlist.innerHTML =
      '<div class="panel-body"><p class="empty">Nothing watched yet. Find a section and press <strong>Watch</strong> — you’ll see the exact alert the Discord bot sends.</p></div>';
    return;
  }

  // Open sections first: if something you are watching has a seat right now,
  // it should not be below three closed ones.
  const entries = [...state.watch]
    .map((index) => ({ index, entry: state.sectionsByIndex.get(index) }))
    .filter((row) => row.entry)
    .sort((a, b) => Number(state.open.has(b.index)) - Number(state.open.has(a.index)));

  el.watchlist.innerHTML = entries
    .map(({ index, entry }) => {
      const { course, section } = entry;
      const isOpen = state.open.has(index);
      const meets = section.meets[0];
      const when = meets && meets.start ? `${meets.days} ${clock(meets.start)}` : "Async";
      return `<div class="wl-item">
        <span>
          <span class="wl-title">${esc(course.title)}</span>
          <span class="wl-meta">${esc(index)} · sec ${esc(section.number)} · ${esc(when)}</span>
        </span>
        <span class="status ${isOpen ? "open" : "closed"}">${isOpen ? "OPEN" : "CLOSED"}</span>
        <span class="wl-actions">
          <button class="linkbtn" data-preview="${esc(index)}" title="Preview alert">◉</button>
          <button class="wl-remove" data-unwatch="${esc(index)}" title="Stop watching ${esc(index)}" aria-label="Stop watching ${esc(index)}">×</button>
        </span>
      </div>`;
    })
    .join("");
}

/* -------------------------------- alert -------------------------------- */

function showAlert(index, { auto = false } = {}) {
  const entry = state.sectionsByIndex.get(index);
  if (!entry) return;
  const { course, section } = entry;

  // The twin has its own seat pool and opens independently, so offer to watch
  // it rather than just mentioning it exists.
  const twins = section.crossListed.filter((i) => state.sectionsByIndex.has(i));
  const unwatched = twins.filter((i) => !state.watch.has(i));
  const crossListed = section.crossListed.length
    ? `<dt>Also as</dt><dd><code>${esc(section.crossListed.join(", "))}</code> — same class, separate seat pool</dd>`
    : "";
  const spn = section.spn
    ? `<dt>Heads up</dt><dd>Needs a special permission number from the department</dd>`
    : "";

  el.dlgBody.innerHTML = `
    <div class="alert-card">
      <span class="a-title">${esc(course.title)} is now open</span>
      <dl>
        <dt>Index</dt><dd><code>${esc(section.index)}</code></dd>
        <dt>Section</dt><dd>${esc(section.number)} · ${esc(course.code)}</dd>
        <dt>Professor</dt><dd>${esc(section.instructors.join(", ") || "TBA")}</dd>
        <dt>Meets</dt><dd>${esc(meetingText(section.meets))}</dd>
        ${crossListed}
        ${spn}
      </dl>
      <span class="alert-foot">${esc(timeLabel(new Date()))} · ${esc(TERM_NAME)} · ${esc(CAMPUS_NAMES[state.campus])}</span>
    </div>
    <a class="reg-btn" href="${WEBREG}${encodeURIComponent(section.index)}" target="_blank" rel="noopener">
      Register on WebReg →
    </a>
    ${
      unwatched.length
        ? `<button class="twin-btn" data-watch-twins="${esc(unwatched.join(","))}">
             + Also watch ${unwatched.length === 1 ? `index ${esc(unwatched[0])}` : `${unwatched.length} cross-listed indexes`}
           </button>`
        : ""
    }
    <p class="dlg-note">${auto ? "This fired automatically because the section just opened. " : ""}The button opens WebReg with the index already filled in: <code>${esc(WEBREG)}${esc(section.index)}</code>. You still sign in through CAS yourself — RU SnipeZ never handles your NetID.</p>
  `;
  if (!el.dlg.open) el.dlg.showModal();
}

/* ------------------------------- wiring -------------------------------- */

function setPulse(kind, text) {
  el.pulse.dataset.state = kind;
  el.pulseText.textContent = text;
}

function tickClock() {
  if (el.pulse.dataset.state === "error" || !state.lastPollAt) return;
  const elapsed = Math.floor((Date.now() - state.lastPollAt) / 1000);
  const next = Math.max(0, POLL_SECONDS - elapsed);
  setPulse("live", `live · ${elapsed}s ago · next in ${next}s`);
}

function loadWatch() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) state.watch = new Set(JSON.parse(raw));
  } catch {
    /* private mode or blocked storage — the demo works without it */
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
    renderResults();
  }, 130)
);

el.core.addEventListener("change", () => {
  state.filters.core = el.core.value;
  renderResults();
});

for (const [button, key] of [
  [el.tOpen, "openOnly"],
  [el.tSpn, "hideSpn"],
]) {
  button.addEventListener("click", () => {
    state.filters[key] = !state.filters[key];
    button.setAttribute("aria-pressed", String(state.filters[key]));
    renderResults();
  });
}

el.campus.addEventListener("change", async () => {
  state.campus = el.campus.value;
  state.seenBaseline = false;
  state.events = [];
  el.results.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>';
  await loadCatalog(state.campus);
  await poll();
  renderWatchlist();
});

document.addEventListener("click", (event) => {
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

  const quickBtn = event.target.closest(".quick");
  if (quickBtn) {
    el.q.value = quickBtn.dataset.q;
    state.filters.q = quickBtn.dataset.q;
    renderResults();
    el.q.focus();
    return;
  }

  const previewBtn = event.target.closest("[data-preview]");
  if (previewBtn) showAlert(previewBtn.dataset.preview);
});

// The intro strip is for first-time visitors; once dismissed it stays gone.
el.introClose.addEventListener("click", () => {
  el.intro.hidden = true;
  try {
    localStorage.setItem(INTRO_KEY, "1");
  } catch {
    /* non-fatal */
  }
});

el.clearWatch.addEventListener("click", () => {
  state.watch.clear();
  saveWatch();
  renderWatchlist();
  renderResults();
});

$("dlg-close").addEventListener("click", () => el.dlg.close());
el.dlg.addEventListener("click", (event) => {
  if (event.target === el.dlg) el.dlg.close();
});

/* ------------------------------- routing ------------------------------- */

/**
 * Hash routing between the three views. Switching is a visibility toggle
 * rather than a page load, so the 4.8 MB catalogue is parsed once and the
 * poll loop keeps running while you read the other tabs.
 */
const VIEWS = ["monitor", "how", "about"];

function showView(name) {
  const view = VIEWS.includes(name) ? name : "monitor";
  for (const other of VIEWS) {
    $(`view-${other}`).hidden = other !== view;
  }
  for (const link of document.querySelectorAll(".tabs a")) {
    if (link.dataset.view === view) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  // The live counters only describe the monitor, but keeping the pulse visible
  // everywhere is the point: the thing is still running while you read about it.
  document.title =
    view === "monitor"
      ? "RU SnipeZ — live Rutgers section monitor"
      : `RU SnipeZ — ${view === "how" ? "how it works" : "about"}`;
  if (view !== "monitor") window.scrollTo(0, 0);
}

window.addEventListener("hashchange", () => showView(location.hash.slice(1)));

/* --------------------------------- boot -------------------------------- */


async function main() {
  showView(location.hash.slice(1));
  try {
    if (localStorage.getItem(INTRO_KEY)) el.intro.hidden = true;
  } catch {
    /* storage blocked — just show the intro */
  }
  loadWatch();
  renderWatchlist();
  renderFeed();

  try {
    await loadCatalog(state.campus);
  } catch (err) {
    el.resultsLabel.textContent = "Could not load the catalogue.";
    el.results.innerHTML = `<div class="panel"><div class="panel-body"><p class="empty">Catalogue failed to load: ${esc(err.message)}. Run <code>python scripts/devserver.py</code> and reload.</p></div></div>`;
    setPulse("error", "catalogue missing");
    return;
  }

  renderResults();
  renderWatchlist();
  await poll();
  renderWatchlist();

  setInterval(poll, POLL_SECONDS * 1000);
  setInterval(tickClock, 1000);
}

main();
