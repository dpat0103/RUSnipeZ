import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapshotProxy } from '../lib/snapshot-proxy.js';
import { readSnapshot } from '../worker/src/snapshots.js';

test('the edge adapter streams snapshots and preserves their ETag', async (t) => {
  const original = Response.json({ schemaVersion: 2, term: '92026', sections: {} }, {
    headers: { ETag: '"fixture"' },
  });
  original.json = () => { throw new Error('Proxy must not parse or rebuild snapshot JSON'); };
  t.mock.method(globalThis, 'fetch', async (url) => {
    assert.equal(url.pathname, '/api/snapshot');
    return original;
  });
  const response = await snapshotProxy(new Request('https://site/api/snapshot?term=92026'), 'https://worker');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('etag'), '"fixture"');
  assert.match(response.headers.get('cache-control'), /stale-while-revalidate/);
  assert.equal((await response.json()).schemaVersion, 2);
});

test('invalid query parameters and missing configuration never contact storage', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Must not fetch'); });
  for (const query of ['term=bad', 'term=92026&campus=bad', 'term=92026%26other=1']) {
    const response = await snapshotProxy(new Request(`https://site/api/snapshot?${query}`), 'https://worker');
    assert.equal(response.status, 400);
  }
  assert.equal((await snapshotProxy(new Request('https://site/api/snapshot?term=92026'))).status, 503);
});

test('R2 failures never get cached and cannot start collection', async (t) => {
  globalThis.caches = { default: { match: async () => null, put() { throw new Error('No error caching'); } } };
  t.after(() => { delete globalThis.caches; });
  const response = await readSnapshot(new Request('https://worker/api/snapshot?term=92026'), {
    SNAPSHOTS: { get: async () => { throw new Error('Offline'); } },
  }, {});
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('snapshot delivery remains independent of an unavailable collector', async (t) => {
  globalThis.caches = { default: { match: async () => null, put: async () => {} } };
  t.after(() => { delete globalThis.caches; });
  let pending;
  const response = await readSnapshot(new Request('https://worker/api/snapshot?term=92026'), {
    SEAT_HISTORY: { get() { throw new Error('Collector is unavailable'); } },
    SNAPSHOTS: { get: async () => ({ body: new Response('{"schemaVersion":2}').body, httpEtag: '"saved"' }) },
  }, { waitUntil: (p) => { pending = p; } });
  await pending;
  assert.equal(response.status, 200);
  assert.equal((await response.json()).schemaVersion, 2);
});
