import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function page() {
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, {
      textContent: "", innerHTML: "", dataset: {},
      addEventListener() {}, setAttribute() {}, removeAttribute() {},
    });
    return elements.get(id);
  };
  const context = vm.createContext({
    document: {
      getElementById: element, querySelector: () => null,
      querySelectorAll: () => [], addEventListener() {},
    },
    window: { addEventListener() {} },
    setTimeout, clearTimeout, setInterval() {}, AbortSignal, console, URLSearchParams,
    localStorage: { getItem: () => null }, location: { search: '', hash: '' },
  });
  const source = readFileSync(new URL("../web/app.js", import.meta.url), "utf8");
  vm.runInContext(source.replace(/main\(\);\s*$/, ""), context);
  vm.runInContext(`
    renderResults = () => {}; renderWatchlist = () => {}; renderFeed = () => {};
    announce = () => {};
    state.sectionsByIndex.set('10001', {
      course: { title: 'Test course' }, section: { number: '01' }
    });
  `, context);
  return { run: (code) => vm.runInContext(code, context), context, elements };
}

test("UI records only transitions and does not update opening timestamps every poll", () => {
  const { run } = page();
  run(`applyOpenSet(new Set(['10001']));`);
  assert.equal(run("openingInfo('10001')"), undefined);
  run(`applyOpenSet(new Set()); applyOpenSet(new Set(['10001']));`);
  const opening = run("openingInfo('10001').lastOpenedAt");
  run(`applyOpenSet(new Set(['10001']));`);
  assert.equal(run("openingInfo('10001').lastOpenedAt"), opening);
  run(`applyOpenSet(new Set());`);
  assert.equal(run("openingInfo('10001').lastOpenedAt"), opening);
  assert.match(run("openingLabel('10001')"), /Last opened.*this visit/);
});

test("shared history survives closure and labels missing, stale and unavailable states", () => {
  const { run } = page();
  run(`state.history = { sections: { '10001': {
    lastOpenedAt: '2026-10-12T18:30:00Z', observedAfter: '2026-10-12T18:29:30Z'
  } } }; state.historyStatus = 'ready';`);
  assert.match(run("openingLabel('10001', true)"), /Oct 12, 2026.*2:30 PM EDT/);
  assert.match(run("openingLabel('10002')"), /No opening recorded/);
  run("state.historyStatus = 'stale'");
  assert.match(run("openingLabel('10002')"), /updates delayed/);
  assert.match(run("openingLabel('10001')"), /Last opened/);
  run("state.historyStatus = 'unavailable'");
  assert.equal(run("openingLabel('10002')"), "Opening history unavailable");
});

test("long client polling gaps do not invent a local opening", () => {
  const { run } = page();
  run(`state.seenBaseline = true; state.lastPollAt = new Date(Date.now() - 120000);
    applyOpenSet(new Set(['10001']));`);
  assert.equal(run("openingInfo('10001')"), undefined);
});

test("the shared collector replaces a local observation of the same opening", () => {
  const { run } = page();
  run(`state.lastOpened.set('10001', {
    lastOpenedAt: '2026-10-13T16:30:25Z', observedAfter: '2026-10-13T16:30:00Z'
  }); state.history = { sections: { '10001': {
    lastOpenedAt: '2026-10-13T16:30:20Z', observedAfter: '2026-10-13T16:29:50Z'
  } } };`);
  assert.equal(run("openingInfo('10001').local"), undefined);
  assert.equal(run("openingInfo('10001').lastOpenedAt"), "2026-10-13T16:30:20Z");
  run(`state.history.sections['10001'].lastOpenedAt = '2026-10-12T16:30:20Z';`);
  assert.equal(run("openingInfo('10001').local"), true);
});

test("history outages do not discard saved timestamps and do not alter live status", async () => {
  const { run, context, elements } = page();
  context.fetch = async () => { throw new Error("offline"); };
  run(`state.history = { sections: { '10001': { lastOpenedAt: '2026-10-12T18:30:00Z' } } };
    state.open = new Set(['10001']);`);
  await run("poll()");
  assert.equal(run("state.historyStatus"), "stale");
  assert.equal(run("state.open.has('10001')"), true);
  assert.match(elements.get("history-status").textContent, /delayed/);
});

test("a response from the previously selected campus cannot apply to the new view", async () => {
  const { run, context } = page();
  let resolve;
  context.fetch = () => new Promise((r) => { resolve = r; });
  const pending = run("poll()");
  run("state.campus = 'NK'");
  resolve({ ok: true, json: async () => ({ schemaVersion: 2, term: "92026", sections: {},
    openIndexes: [], checkedAt: new Date().toISOString() }) });
  await pending;
  assert.equal(run("state.history"), null);
});

test("initial catalog and snapshot requests run together; a slow snapshot does not block rendering", async () => {
  const { run, context } = page();
  const calls = [];
  let finishCatalog, finishSnapshot;
  context.fetch = (url) => {
    calls.push(url);
    return new Promise((resolve) => { finishSnapshot = resolve; });
  };
  context.catalog = () => new Promise((resolve) => {
    calls.push('catalog'); finishCatalog = resolve;
  });
  context.render = () => { calls.push('rendered'); };
  run(`showView = () => {}; loadCatalog = catalog; readUrl = () => {}; renderResults = render;`);
  const pending = run('main()');
  assert.match(calls[0], /api\/snapshot/);
  assert.equal(calls[1], 'catalog');
  finishCatalog();
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(calls.includes('rendered'));
  assert.equal(run('state.seenBaseline'), false);
  finishSnapshot({ ok: true, json: async () => ({
    schemaVersion: 2, term: '92026', checkedAt: new Date().toISOString(),
    openIndexes: ['10001'], sections: {},
  }) });
  await pending;
  assert.equal(run("state.open.has('10001')"), true);
  assert.equal(calls.filter((s) => /api\//.test(s)).length, 1);
});

test("cached snapshots never duplicate activity; older responses cannot roll status back", async () => {
  const { run, context } = page();
  let payload = { schemaVersion: 2, term: '92026', checkedAt: new Date().toISOString(),
    openIndexes: ['10001'], sections: {} };
  context.fetch = async () => ({ ok: true, json: async () => payload });
  await run('poll()');
  const count = run('state.events.length');
  await run('poll()');
  assert.equal(run('state.events.length'), count);
  payload = { ...payload, checkedAt: new Date(Date.now() - 30_000).toISOString(), openIndexes: [] };
  await run('poll()');
  assert.equal(run("state.open.has('10001')"), true);
});

test("stale snapshots are displayed with a warning and produce no opening alerts", async () => {
  const { run, context, elements } = page();
  context.fetch = async () => ({ ok: true, json: async () => ({
    schemaVersion: 2, term: '92026', checkedAt: new Date(Date.now() - 120_000).toISOString(),
    openIndexes: ['10001'], sections: {},
  }) });
  run('state.seenBaseline = true');
  await run('poll()');
  assert.equal(run('state.historyStatus'), 'stale');
  assert.equal(run("state.lastOpened.has('10001')"), false);
  assert.match(elements.get('history-status').textContent, /last successful check/);
});
