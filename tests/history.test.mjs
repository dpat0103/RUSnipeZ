import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { SeatHistory, validateIndexes, MAX_GAP_MS } from "../worker/src/history.js";
import { historyProxy } from "../lib/history-proxy.js";
import worker from "../worker/src/index.js";

function storageContext(db = new DatabaseSync(":memory:")) {
  let alarm = null;
  const ctx = {
    storage: {
      sql: { exec(sql, ...args) {
        const rows = db.prepare(sql).all(...args);
        return { toArray: () => rows };
      } },
      async getAlarm() { return alarm; },
      async setAlarm(value) { alarm = value; },
      async deleteAlarm() { alarm = null; },
      transactionSync(fn) {
        db.exec("BEGIN");
        try { fn(); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; }
      },
    },
    blockConcurrencyWhile(fn) { ctx.ready = fn(); return ctx.ready; },
  };
  return { ctx, db };
}

const request = () => new Request("https://history.internal/?term=92026");

async function create(env = {}) {
  const objects = new Map();
  env.SNAPSHOTS ??= {
    async put(key, value, options) { objects.set(key, { value, options }); },
    async get(key) {
      const saved = objects.get(key);
      return saved ? { body: new Response(saved.value).body, httpEtag: '"snapshot"' } : null;
    },
  };
  const { ctx, db } = storageContext();
  const object = new SeatHistory(ctx, env);
  await ctx.ready;
  await object.fetch(request());
  return { object, ctx, db, env, objects };
}

test("baseline, repeated polls, closure, reopening and restart preserve real transitions", async () => {
  const { object, ctx } = await create();
  const t = Date.now();
  object.record(["10001"], t);
  let payload = await (await object.fetch(request())).json();
  assert.deepEqual(payload.sections, {});
  object.record(["10001", "10002"], t + 30_000);
  object.record(["10001", "10002"], t + 60_000);
  object.record(["10001"], t + 90_000);
  payload = await (await object.fetch(request())).json();
  assert.equal(payload.sections["10002"].lastOpenedAt, new Date(t + 30_000).toISOString());
  assert.equal(payload.sections["10002"].openingCount, 1);
  const restarted = new SeatHistory(ctx);
  await ctx.ready;
  restarted.record(["10001", "10002"], t + 120_000);
  // Retry with the same snapshot never double-counts.
  restarted.record(["10001", "10002"], t + 120_000);
  payload = await (await restarted.fetch(request())).json();
  assert.equal(payload.sections["10002"].openingCount, 2);
  assert.equal(payload.sections["10002"].observedAfter, new Date(t + 90_000).toISOString());
  assert.equal(payload.startedAt, new Date(t).toISOString());
});

test("long observation gaps re-baseline without discarding saved history", async () => {
  const { object } = await create();
  const t = Date.now();
  object.record([], t);
  object.record(["10001"], t + 30_000);
  object.record(["10001", "10002"], t + 30_001 + MAX_GAP_MS);
  const payload = await (await object.fetch(request())).json();
  assert.ok(payload.sections["10001"]);
  assert.equal(payload.sections["10002"], undefined);
});

test("a storage failure rolls back both openings and the snapshot", async () => {
  const { object, ctx } = await create();
  const time = Date.now();
  object.record([], time);
  const exec = ctx.storage.sql.exec;
  ctx.storage.sql.exec = (sql, ...args) => {
    if (sql.startsWith('UPDATE snapshot')) throw new Error('disk failure');
    return exec(sql, ...args);
  };
  assert.throws(() => object.record(['10001'], time + 30_000), /disk failure/);
  ctx.storage.sql.exec = exec;
  const payload = await (await object.fetch(request())).json();
  assert.deepEqual(payload.sections, {});
  assert.equal(payload.checkedAt, new Date(time).toISOString());
});

test("history reads share one term cache and apply CORS after reading it", async (t) => {
  const entries = new Map();
  globalThis.caches = { default: {
    match: async (key) => entries.get(key.url)?.clone(),
    put: async (key, response) => { entries.set(key.url, response); },
  } };
  t.after(() => { delete globalThis.caches; });
  let reads = 0;
  const pending = [];
  const ctx = { waitUntil: (promise) => pending.push(promise) };
  const env = {
    HISTORY_TERMS: '92026', ALLOWED_ORIGINS: '*',
    SNAPSHOTS: {
      get: async () => {
        reads++;
        return { body: Response.json({ term: '92026', sections: {} }).body, httpEtag: '"test"' };
      },
    },
    SEAT_HISTORY: { get() { throw new Error('Visitors must not query the collector'); } },
  };
  const first = await worker.fetch(new Request('https://worker/api/history?term=92026&campus=NB', {
    headers: { Origin: 'https://one.example' },
  }), env, ctx);
  await Promise.all(pending);
  const second = await worker.fetch(new Request('https://worker/api/history?term=92026&campus=NK', {
    headers: { Origin: 'https://two.example' },
  }), env, ctx);
  assert.equal(reads, 1);
  assert.equal(first.headers.get('Access-Control-Allow-Origin'), 'https://one.example');
  assert.equal(second.headers.get('Access-Control-Allow-Origin'), 'https://two.example');
});

test("HTTP errors and malformed responses leave snapshot unchanged and reschedule", async (t) => {
  const { object, ctx } = await create();
  const start = Date.now();
  object.record(["10001"], start);
  const responses = [new Response("bad", { status: 500 }), Response.json({ error: "oops" }),
    Response.json(["abc"]), new Response("not json")];
  t.mock.method(globalThis, "fetch", async () => responses.shift());
  for (let i = 0; i < 4; i++) {
    await object.alarm();
    assert.ok(await ctx.storage.getAlarm() > start);
    assert.equal((await (await object.fetch(request())).json()).checkedAt, new Date(start).toISOString());
  }
});

test("alarms record openings and retired terms stop collection", async (t) => {
  const env = { HISTORY_TERMS: "92026" };
  const { object, ctx } = await create(env);
  object.record([], Date.now() - 30_000);
  t.mock.method(globalThis, "fetch", async (url) => {
    assert.equal(new URL(url).searchParams.get("year"), "2026");
    return Response.json([10001]);
  });
  await object.alarm();
  assert.ok((await (await object.fetch(request())).json()).sections["10001"]);
  env.HISTORY_TERMS = "12027";
  await object.alarm();
  assert.equal(await ctx.storage.getAlarm(), null);
});

test("terms are isolated; invalid requests and unconfigured terms cannot start collectors", async () => {
  const { object } = await create();
  assert.equal((await object.fetch(new Request("https://internal/?term=bad"))).status, 400);
  await assert.rejects(object.fetch(new Request("https://internal/?term=12027")), /mismatch/);
  const env = { HISTORY_TERMS: "92026", ALLOWED_ORIGINS: "*" };
  assert.equal((await worker.fetch(new Request("https://worker/api/history?term=12027"), env)).status, 404);
  assert.equal((await worker.fetch(new Request("https://worker/api/history?term=92026&campus=bad"), env)).status, 400);
});

test("watchdog starts configured collectors only", async () => {
  const names = [];
  let pending;
  await worker.scheduled({}, {
    HISTORY_TERMS: "92026,12027,bad",
    SEAT_HISTORY: {
      idFromName: (term) => term,
      get: (term) => ({ fetch: async () => { names.push(term); return Response.json({}); } }),
    },
  }, { waitUntil(p) { pending = p; } });
  await pending;
  assert.deepEqual(names, ["92026", "12027"]);
});

test("daily proxy validates, reads the public data branch and handles outages", async (t) => {
  const req = new Request("https://site/api/history?term=92026&campus=nk");
  assert.equal((await historyProxy(new Request("https://site/?term=bad"), "https://worker")).status, 400);
  const mock = t.mock.method(globalThis, "fetch", async (url) => {
    assert.equal(String(url), "https://raw.githubusercontent.com/dpat0103/RUSnipeZ/history-data/history-92026.json");
    return Response.json({ schemaVersion: 3, term: "92026", sampling: "daily", checkedAt: new Date().toISOString(), sections: {} });
  });
  const response = await historyProxy(req);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control"), /s-maxage=3600/);
  mock.mock.mockImplementation(async () => { throw new Error("offline"); });
  assert.equal((await historyProxy(req)).status, 503);
});

test("open payload validation accepts empty sets and rejects malformed snapshots", () => {
  assert.deepEqual(validateIndexes([10001, "10001"]), ["10001"]);
  assert.deepEqual(validateIndexes([]), []);
  for (const value of [null, {}, ["bad"], ["1000"], [null]]) {
    assert.throws(() => validateIndexes(value));
  }
});

test("event log records closures and summarizes fully observed opening durations", async () => {
  const { object, db } = await create();
  const start = Date.now();
  object.record(['10002'], start); // Already open at baseline: duration unknown.
  object.record(['10001'], start + 30_000);
  object.record(['10001'], start + 60_000);
  object.record([], start + 90_000);
  object.record(['10001'], start + 120_000);
  object.record([], start + 150_000);
  const payload = await (await object.fetch(request())).json();
  assert.equal(payload.sections['10001'].openingCount, 2);
  assert.equal(payload.sections['10001'].completedOpenings, 2);
  assert.equal(payload.sections['10001'].averageOpenSeconds, 45);
  assert.equal(payload.sections['10001'].lastOpenSeconds, 30);
  const events = db.prepare('SELECT * FROM events ORDER BY id').all();
  assert.equal(events.length, 5);
  assert.equal(events.find((r) => r.section_index === '10002').duration_ms, null);
  assert.deepEqual(events.filter((r) => r.section_index === '10001').map((r) => r.kind),
    ['opened', 'closed', 'opened', 'closed']);
});

test("gaps invalidate active durations and preserve genuine historical metrics", async () => {
  const { object, db } = await create();
  const start = Date.now();
  object.record([], start);
  object.record(['10001'], start + 30_000);
  object.record(['10001'], start + 150_000);
  object.record([], start + 180_000);
  const payload = await (await object.fetch(request())).json();
  assert.equal(payload.sections['10001'].openingCount, 1);
  assert.equal(payload.sections['10001'].completedOpenings, 0);
  assert.equal(payload.sections['10001'].averageOpenSeconds, null);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM events WHERE kind = 'gap'").get().n, 1);
});

test("an existing v1 database migrates without fabricating events or losing timestamps", async () => {
  const { ctx, db } = storageContext();
  db.exec(`CREATE TABLE snapshot (id INTEGER PRIMARY KEY, term TEXT, started_at INTEGER,
    checked_at INTEGER, open_indexes TEXT);
    INSERT INTO snapshot VALUES (1, '92026', 1000, 2000, '["10001"]');
    CREATE TABLE openings (section_index TEXT PRIMARY KEY, last_opened_at INTEGER NOT NULL,
      observed_after INTEGER NOT NULL, opening_count INTEGER NOT NULL);
    INSERT INTO openings VALUES ('10001', 2000, 1000, 4);`);
  const object = new SeatHistory(ctx);
  await ctx.ready;
  const payload = await (await object.fetch(request())).json();
  assert.equal(payload.sections['10001'].openingCount, 4);
  assert.equal(payload.sections['10001'].completedOpenings, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM events').get().n, 0);
  assert.equal(payload.sections['10001'].lastOpenedAt, new Date(2000).toISOString());
});

test("publication retries a committed snapshot even when the next Rutgers poll fails", async (t) => {
  const { object, env, objects } = await create();
  const start = Date.now();
  object.record([], start - 60_000);
  object.record(['10001'], start - 30_000);
  const put = env.SNAPSHOTS.put;
  env.SNAPSHOTS.put = async () => { throw new Error('R2 unavailable'); };
  await assert.rejects(object.publish(), /R2 unavailable/);
  assert.equal(objects.size, 0);
  env.SNAPSHOTS.put = put;
  t.mock.method(globalThis, 'fetch', async () => new Response('error', { status: 500 }));
  await object.alarm();
  const saved = objects.get('snapshots/92026.json');
  assert.equal(JSON.parse(saved.value).checkedAt, new Date(start - 30_000).toISOString());
  assert.equal(JSON.parse(saved.value).sections['10001'].openingCount, 1);
  assert.match(saved.options.httpMetadata.cacheControl, /stale-while-revalidate/);
});

test("missing snapshots return an uncached error without starting collection", async (t) => {
  globalThis.caches = { default: { match: async () => null, put() { throw new Error('No error caching'); } } };
  t.after(() => { delete globalThis.caches; });
  const env = {
    SNAPSHOTS: { get: async () => null }, ALLOWED_ORIGINS: '*',
    SEAT_HISTORY: { get() { throw new Error('No visitor collection'); } },
  };
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('No Rutgers request'); });
  const response = await worker.fetch(new Request('https://worker/api/snapshot?term=92026'), env, {});
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test("a full catalog of history does not require a row scan per section when publishing", async () => {
  const { object, ctx } = await create();
  const start = Date.now();
  const indexes = Array.from({ length: 16371 }, (_, i) => String(10000 + i));
  object.record([], start);
  object.record(indexes, start + 30_000);
  let rowsRead = 0;
  const exec = ctx.storage.sql.exec;
  ctx.storage.sql.exec = (sql, ...args) => {
    const result = exec(sql, ...args);
    rowsRead += result.toArray().length;
    return result;
  };
  const payload = object.store.snapshot();
  assert.equal(Object.keys(payload.sections).length, 16371);
  assert.equal(payload.openIndexes.length, 16371);
  assert.ok(rowsRead <= 101, `Snapshot publishing read ${rowsRead} rows`);
});
