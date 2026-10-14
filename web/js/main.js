import { state, loadWatch, saveWatch } from "./state.js";
import { CAMPUS_NAMES, DEFAULT_FILTERS, INTRO_KEY, PAGE_SIZE, POLL_SECONDS } from "./config.js";
import { $, el } from "./dom.js";
import { esc, toast, debounce } from "./util.js";
import { loadCatalog, fetchSnapshot, poll } from "./data.js";
import { renderResults, renderWatchlist, renderFeed, showAlert, pushEvent, announce } from "./render.js";
import { syncUrl, readUrl, applyFiltersToControls } from "./url.js";
import { setPulse, tickClock } from "./status.js";

export function changed() {
  state.shown = PAGE_SIZE;
  syncUrl();
  renderResults();
}

/* ------------------------------- routing ------------------------------- */

export const VIEWS = ["monitor", "how", "about"];

export function showView(name) {
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

export function wireEvents() {
  window.addEventListener("hashchange", () => showView(location.hash.slice(1)));

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
    const campus = state.campus;
    state.seenBaseline = false;
    state.lastOpened.clear();
    state.events = [];
    state.expanded.clear();
    const prepared = fetchSnapshot(campus);
    el.results.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>';
    await loadCatalog(state.campus);
    if (campus !== state.campus) return;
    syncUrl();
    await poll({ prepared });
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

}

export async function main({
  loadCatalog: catalog = loadCatalog, renderResults: render = renderResults,
  readUrl: read = readUrl, showView: view = showView,
  setInterval: schedule = globalThis.setInterval,
} = {}) {
  view(location.hash.slice(1));
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
  const prepared = fetchSnapshot(state.campus);

  try {
    await catalog(state.campus);
  } catch (err) {
    el.resultsLabel.textContent = "Could not load the catalogue.";
    el.results.innerHTML = `<div class="panel"><div class="panel-body"><p class="empty">The catalogue failed to load: ${esc(
      err.message
    )}. Reload the page, or start the local dev server if you are running this from a checkout.</p></div></div>`;
    setPulse("error", "catalogue unavailable");
    return;
  }

  read();
  render();
  schedule(poll, POLL_SECONDS * 1000);
  schedule(tickClock, 1000);
  await poll({ prepared });
}

if (typeof document !== "undefined") {
  wireEvents();
  main();
}
