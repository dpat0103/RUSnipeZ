import { state } from "./state.js";
import { TERM_NAME, CAMPUS_NAMES, LOCATION_NAMES, WEBREG, MAX_EVENTS, PAGE_SIZE } from "./config.js";
import { el } from "./dom.js";
import { esc, num, clock, meetingText, timeLabel, DOT } from "./util.js";
import { applyOpenSet, openingInfo, openingLabel, historyDate } from "./detection.js";
import { filtered } from "./search.js";
import { isFiltered } from "./url.js";

/** Deliver an opening for a watched section through every enabled channel. */
export function announce(index, { simulated = false } = {}) {
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

export function pushEvent(event) {
  state.events.unshift({ ...event, at: new Date() });
  state.events.length = Math.min(state.events.length, MAX_EVENTS);
}

export function renderResults(justOpened = new Set()) {
  const matches = filtered();
  const shown = matches.slice(0, state.shown);
  const sectionCount = matches.reduce((n, m) => n + m.sections.length, 0);
  const openCount = matches.reduce(
    (n, m) => n + m.sections.filter((s) => state.open.has(s.index)).length,
    0
  );

  el.resultsLabel.textContent = matches.length
    ? `${num(matches.length)} courses ${DOT} ${num(sectionCount)} sections ${DOT} ${
        state.seenBaseline ? `${num(openCount)} open${state.liveStatus === "stale" ? " at last check" : " now"}` : "seat status pending"}`
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

export function renderCourse(course, sections, justOpened) {
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

export function renderSection(section, course, justOpened) {
  const isOpen = state.open.has(section.index);
  const watched = state.watch.has(section.index);
  const expanded = state.expanded.has(section.index);
  const flash = justOpened.has(section.index) ? " just-opened" : "";

  const badges = [
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
      <span class="opening-history">${esc(openingLabel(section.index))}</span>
    </span>
    <span class="badges">${badges}</span>
    <span class="status ${!state.seenBaseline ? "unknown" : isOpen ? "open" : "closed"}">${!state.seenBaseline ? "—" : isOpen ? "OPEN" : "CLOSED"}</span>
    <button class="watch" data-index="${esc(section.index)}" aria-pressed="${watched}">
      ${watched ? "Watching" : "Watch"}
    </button>
    ${expanded ? renderDetail(section, course) : ""}
  </div>`;
}

export function renderDetail(section, course) {
  const rows = [];
  rows.push([
    "Index",
    `<code>${esc(section.index)}</code><button class="copyidx" data-copy="${esc(
      section.index
    )}">copy</button>`,
  ]);
  rows.push(["Section", `${esc(section.number)} of ${esc(course.code)}`]);
  rows.push(["Last seen open", esc(openingLabel(section.index, true))]);
  const record = openingInfo(section.index);
  if (record && !record.local) {
    rows.push(["Observed days", `${esc(record.daysSeenOpen)} recorded day${record.daysSeenOpen === 1 ? "" : "s"} with an open seat`]);
  }
  rows.push(["Daily history", "One snapshot per day, dated in Eastern time. This is a last-seen date, not an exact opening time."]);
  if (state.history?.startedAt) {
    rows.push(["Last daily check", esc(historyDate(state.history.sampleDate))]);
  }
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

export function renderFeed() {
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

export function renderWatchlist() {
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
          <span class="opening-history">${esc(openingLabel(index))}</span>
        </span>
        <span class="status ${!state.seenBaseline ? "unknown" : isOpen ? "open" : "closed"}">${!state.seenBaseline ? "—" : isOpen ? "OPEN" : "CLOSED"}</span>
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

export function showAlert(index, { auto = false, simulated = false } = {}) {
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

export function renderOpenSet(next, options) {
  const { opened, closed, baseline, openHere } = applyOpenSet(next, options);
  el.statOpen.textContent = num(openHere);
  if (baseline) {
    pushEvent({ kind: "baseline", text: `Watching <strong>${num(openHere)}</strong> open sections in ${CAMPUS_NAMES[state.campus]}` });
    renderResults();
    renderWatchlist();
    return;
  }

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
    pushEvent({ kind: "tick", text: `No change, ${num(openHere)} open` });
  }

  renderResults(new Set(opened));
  renderWatchlist();
}
