import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STORAGE_KEY } from '../web/js/config.js';
import { loadWatch, saveWatch, state } from '../web/js/state.js';

test('Winter watches cannot inherit or overwrite Fall indexes', (t) => {
  const fall = '["10001"]';
  const saved = new Map([
    ['rusnipez.watch.v1', fall],
    ['rusnipez.watch.v2.92026', fall],
  ]);
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: (key) => saved.get(key), setItem: (key, value) => saved.set(key, value) },
  });
  t.after(() => {
    state.watch = new Set();
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete globalThis.localStorage;
  });
  state.watch = new Set();
  loadWatch();
  assert.equal(state.watch.size, 0);
  state.watch.add('00001');
  saveWatch();
  state.watch.clear();
  loadWatch();
  assert.deepEqual([...state.watch], ['00001']);
  assert.equal(saved.get('rusnipez.watch.v1'), fall);
  assert.equal(saved.get('rusnipez.watch.v2.92026'), fall);
  assert.equal(STORAGE_KEY, 'rusnipez.watch.v2.02027');
});
