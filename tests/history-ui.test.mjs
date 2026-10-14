import { test } from "node:test";
import assert from "node:assert/strict";
import { state } from "../web/js/state.js";
import { DEFAULT_FILTERS, PAGE_SIZE } from "../web/js/config.js";
import { applyOpenSet, openingInfo, openingLabel } from "../web/js/detection.js";
import { poll } from "../web/js/data.js";
import { main } from "../web/js/main.js";

function page(t) {
  Object.assign(state, {
    campus: "NB", courses: [], sectionsByIndex: new Map(), open: new Set(),
    lastOpened: new Map(), history: null, historyStatus: "loading", seenBaseline: false,
    watch: new Set(), expanded: new Set(), events: [], polls: 0, lastPollAt: null,
    shown: PAGE_SIZE, notify: false, filters: { ...DEFAULT_FILTERS },
  });
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, {
      textContent: "", innerHTML: "", dataset: {},
      addEventListener() {}, setAttribute() {}, removeAttribute() {},
    });
    return elements.get(id);
  };
  // Stub browser I/O while executing the imported production functions.
  t.mock.method(globalThis, "fetch", async () => { throw new Error("offline"); });
  for (const [key, value] of Object.entries({
    document: { getElementById: element, querySelector: () => null, querySelectorAll: () => [] },
    window: {}, localStorage: { getItem: () => null }, location: { search: "", hash: "" },
  })) {
    const original = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
    t.after(() => original ? Object.defineProperty(globalThis, key, original) : delete globalThis[key]);
  }
  state.sectionsByIndex.set("10001", {
    course: { title: "Test course" }, section: { number: "01" },
  });
  return elements;
}

test("UI records only transitions and does not update opening timestamps every poll", (t) => {
  page(t);
  applyOpenSet(new Set(['10001']));
  assert.equal(openingInfo('10001'), undefined);
  applyOpenSet(new Set()); applyOpenSet(new Set(['10001']));
  const opening = openingInfo('10001').lastOpenedAt;
  applyOpenSet(new Set(['10001']));
  assert.equal(openingInfo('10001').lastOpenedAt, opening);
  applyOpenSet(new Set());
  assert.equal(openingInfo('10001').lastOpenedAt, opening);
  assert.match(openingLabel('10001'), /Last opened.*this visit/);
});

test("shared history survives closure and labels missing, stale and unavailable states", (t) => {
  page(t);
  state.history = { sections: { '10001': {
    lastOpenedAt: '2026-10-12T18:30:00Z', observedAfter: '2026-10-12T18:29:30Z'
  } } }; state.historyStatus = 'ready';
  assert.match(openingLabel('10001', true), /Oct 12, 2026.*2:30 PM EDT/);
  assert.match(openingLabel('10002'), /No opening recorded/);
  state.historyStatus = 'stale';
  assert.match(openingLabel('10002'), /updates delayed/);
  assert.match(openingLabel('10001'), /Last opened/);
  state.historyStatus = 'unavailable';
  assert.equal(openingLabel('10002'), "Opening history unavailable");
});

test("long client polling gaps do not invent a local opening", (t) => {
  page(t);
  state.seenBaseline = true; state.lastPollAt = new Date(Date.now() - 120000);
  applyOpenSet(new Set(['10001']));
  assert.equal(openingInfo('10001'), undefined);
});

test("the shared collector replaces a local observation of the same opening", (t) => {
  page(t);
  state.lastOpened.set('10001', {
    lastOpenedAt: '2026-10-13T16:30:25Z', observedAfter: '2026-10-13T16:30:00Z'
  }); state.history = { sections: { '10001': {
    lastOpenedAt: '2026-10-13T16:30:20Z', observedAfter: '2026-10-13T16:29:50Z'
  } } };
  assert.equal(openingInfo('10001').local, undefined);
  assert.equal(openingInfo('10001').lastOpenedAt, "2026-10-13T16:30:20Z");
  state.history.sections['10001'].lastOpenedAt = '2026-10-12T16:30:20Z';
  assert.equal(openingInfo('10001').local, true);
});

test("history outages do not discard saved timestamps and do not alter live status", async (t) => {
  const elements = page(t);
  globalThis.fetch = async () => { throw new Error("offline"); };
  state.history = { sections: { '10001': { lastOpenedAt: '2026-10-12T18:30:00Z' } } };
  state.open = new Set(['10001']);
  await poll();
  assert.equal(state.historyStatus, "stale");
  assert.equal(state.open.has('10001'), true);
  assert.match(elements.get("history-status").textContent, /delayed/);
});

test("a response from the previously selected campus cannot apply to the new view", async (t) => {
  page(t);
  let resolve;
  globalThis.fetch = () => new Promise((r) => { resolve = r; });
  const pending = poll();
  state.campus = 'NK';
  resolve({ ok: true, json: async () => ({ schemaVersion: 2, term: "92026", sections: {},
    openIndexes: [], checkedAt: new Date().toISOString() }) });
  await pending;
  assert.equal(state.history, null);
});

test("initial catalog and snapshot requests run together; a slow snapshot does not block rendering", async (t) => {
  page(t);
  const calls = [];
  let finishCatalog, finishSnapshot;
  globalThis.fetch = (url) => {
    calls.push(url);
    return new Promise((resolve) => { finishSnapshot = resolve; });
  };
  const catalog = () => new Promise((resolve) => {
    calls.push('catalog'); finishCatalog = resolve;
  });
  const render = () => { calls.push('rendered'); };
  const pending = main({ loadCatalog: catalog, renderResults: render, showView() {}, readUrl() {}, setInterval() {} });
  assert.match(calls[0], /api\/snapshot/);
  assert.equal(calls[1], 'catalog');
  finishCatalog();
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(calls.includes('rendered'));
  assert.equal(state.seenBaseline, false);
  finishSnapshot({ ok: true, json: async () => ({
    schemaVersion: 2, term: '92026', checkedAt: new Date().toISOString(),
    openIndexes: ['10001'], sections: {},
  }) });
  await pending;
  assert.equal(state.open.has('10001'), true);
  assert.equal(calls.filter((s) => /api\//.test(s)).length, 1);
});

test("cached snapshots never duplicate activity; older responses cannot roll status back", async (t) => {
  page(t);
  let payload = { schemaVersion: 2, term: '92026', checkedAt: new Date().toISOString(),
    openIndexes: ['10001'], sections: {} };
  globalThis.fetch = async () => ({ ok: true, json: async () => payload });
  await poll();
  const count = state.events.length;
  await poll();
  assert.equal(state.events.length, count);
  payload = { ...payload, checkedAt: new Date(Date.now() - 30_000).toISOString(), openIndexes: [] };
  await poll();
  assert.equal(state.open.has('10001'), true);
});

test("stale snapshots are displayed with a warning and produce no opening alerts", async (t) => {
  const elements = page(t);
  globalThis.fetch = async () => ({ ok: true, json: async () => ({
    schemaVersion: 2, term: '92026', checkedAt: new Date(Date.now() - 120_000).toISOString(),
    openIndexes: ['10001'], sections: {},
  }) });
  state.seenBaseline = true;
  await poll();
  assert.equal(state.historyStatus, 'stale');
  assert.equal(state.lastOpened.has('10001'), false);
  assert.match(elements.get('history-status').textContent, /last successful check/);
});
