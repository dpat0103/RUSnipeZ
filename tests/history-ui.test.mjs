import { test } from "node:test";
import assert from "node:assert/strict";
import { state } from "../web/js/state.js";
import { DEFAULT_FILTERS, PAGE_SIZE, TERM } from "../web/js/config.js";
import { applyOpenSet, openingInfo, openingLabel, easternDay } from "../web/js/detection.js";
import { poll, loadDailyHistory } from "../web/js/data.js";
import { main } from "../web/js/main.js";

function page(t) {
  Object.assign(state, {
    campus: "NB", courses: [], sectionsByIndex: new Map(), open: new Set(),
    lastSeenOpen: new Map(), liveStatus: "loading", history: null, historyStatus: "loading",
    seenBaseline: false, watch: new Set(), expanded: new Set(), events: [], polls: 0,
    lastPollAt: null, shown: PAGE_SIZE, notify: false, filters: { ...DEFAULT_FILTERS },
  });
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, {
      textContent: "", innerHTML: "", dataset: {},
      addEventListener() {}, setAttribute() {}, removeAttribute() {},
    });
    return elements.get(id);
  };
  t.mock.method(globalThis, "fetch", async () => { throw new Error("offline"); });
  for (const [key, value] of Object.entries({
    document: { getElementById: element, querySelector: () => null, querySelectorAll: () => [] },
    window: {}, localStorage: { getItem: () => null }, location: { search: "", hash: "" },
  })) {
    const original = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
    t.after(() => original ? Object.defineProperty(globalThis, key, original) : delete globalThis[key]);
  }
  state.sectionsByIndex.set("10001", { course: { title: "Test course" }, section: { number: "01" } });
  return elements;
}

const daily = (checkedAt = new Date().toISOString()) => ({
  schemaVersion: 3, term: TERM, sampling: 'daily', checkedAt,
  sampleDate: easternDay(new Date(checkedAt)), startedAt: checkedAt,
  sections: { '10001': { lastSeenOpen: '2026-10-13', daysSeenOpen: 2 } },
});

test('daily history displays a calendar date, preserves old observations and makes no duration claims', (t) => {
  page(t);
  state.history = daily(); state.historyStatus = 'ready';
  assert.equal(openingLabel('10001'), 'Last seen open · Oct 13, 2026');
  assert.equal(openingLabel('10001', true), 'Oct 13, 2026');
  assert.equal(openingLabel('10002'), 'Not seen open in daily snapshots');
});

test('live baseline observations count as seen open but never announce a new opening', (t) => {
  page(t);
  const change = applyOpenSet(new Set(['10001']), { observedAt: new Date('2026-10-15T02:00:00Z') });
  assert.equal(change.baseline, true);
  assert.equal(change.opened.length, 0);
  assert.equal(openingInfo('10001').lastSeenOpen, '2026-10-14');
  applyOpenSet(new Set());
  assert.match(openingLabel('10001'), /Oct 14, 2026.*this visit/);
});

test('history failure preserves saved dates without changing current live status', async (t) => {
  const elements = page(t);
  state.history = daily(); state.historyStatus = 'ready';
  state.open = new Set(['10001']); state.liveStatus = 'ready';
  await loadDailyHistory();
  assert.equal(state.historyStatus, 'stale');
  assert.equal(state.liveStatus, 'ready');
  assert.equal(state.open.has('10001'), true);
  assert.match(elements.get('history-status').textContent, /live seat checks run separately/i);
});

test('live API failure cannot change daily history', async (t) => {
  page(t);
  state.history = daily(); state.historyStatus = 'ready';
  await poll();
  assert.equal(state.historyStatus, 'ready');
  assert.equal(state.liveStatus, 'unavailable');
});

test('responses from a previously selected campus cannot alter the new view', async (t) => {
  page(t);
  let resolve;
  globalThis.fetch = () => new Promise((r) => { resolve = r; });
  const pending = poll(); state.campus = 'NK';
  resolve(Response.json(['10001'])); await pending;
  assert.equal(state.open.size, 0);
});

test('catalog, live status and daily history start together; stalled history never blocks live status', async (t) => {
  page(t);
  const calls = [];
  let finishCatalog, finishOpen, finishHistory;
  globalThis.fetch = (url) => {
    calls.push(url);
    return new Promise((resolve) => {
      if (url.includes('/api/open?')) finishOpen = resolve;
      else if (url.includes('/api/history?')) finishHistory = resolve;
      else throw new Error('Unexpected request');
    });
  };
  const pending = main({
    loadCatalog: () => new Promise((r) => { calls.push('catalog'); finishCatalog = r; }),
    renderResults: () => calls.push('rendered'), showView() {}, readUrl() {}, setInterval() {},
  });
  assert.match(calls[0], /api\/open/);
  assert.match(calls[1], /api\/history/);
  assert.equal(calls[2], 'catalog');
  finishCatalog();
  await new Promise((r) => setImmediate(r));
  assert.ok(calls.includes('rendered'));
  finishOpen(Response.json(['10001']));
  await new Promise((r) => setImmediate(r));
  assert.equal(state.open.has('10001'), true);
  assert.equal(state.history, null);
  finishHistory(Response.json(daily())); await pending;
  assert.ok(state.history);
});

test('daily history is not fetched on each 30-second live check', async (t) => {
  page(t);
  const calls = [];
  globalThis.fetch = async (url) => { calls.push(url); return Response.json(['10001']); };
  await poll(); await poll();
  assert.equal(calls.length, 2);
  assert.ok(calls.every((url) => url.includes('/api/open?')));
  assert.equal(state.events.filter((e) => e.kind === 'opened').length, 0);
});

test('an old daily sample is labeled delayed without suppressing live alerts', async (t) => {
  page(t);
  globalThis.fetch = async (url) => Response.json(url.includes('/api/history?')
    ? daily(new Date(Date.now() - 3 * 86400_000).toISOString()) : []);
  await loadDailyHistory();
  await poll();
  assert.equal(state.historyStatus, 'stale');
  assert.equal(state.liveStatus, 'ready');
});

test('live polling recovers from failure even when history remains stale', async (t) => {
  const elements = page(t);
  state.history = daily('2026-10-01T13:00:00Z');
  state.historyStatus = 'stale';
  globalThis.fetch = async (url) => {
    assert.match(url, new RegExp(`/api/open\\?term=${TERM}&campus=NB$`));
    return Response.json(['10001']);
  };
  await poll();
  assert.equal(state.liveStatus, 'ready');
  assert.equal(elements.get('pulse').dataset.state, 'live');
  globalThis.fetch = async () => { throw new Error('offline'); };
  await poll();
  assert.equal(state.liveStatus, 'stale');
  assert.equal(elements.get('pulse-text').textContent, 'live updates delayed');
  assert.ok(state.open.has('10001'));
  globalThis.fetch = async () => Response.json([]);
  await poll();
  assert.equal(state.liveStatus, 'ready');
  assert.equal(elements.get('pulse').dataset.state, 'live');
  assert.equal(state.open.size, 0);
  assert.equal(state.historyStatus, 'stale');
});
