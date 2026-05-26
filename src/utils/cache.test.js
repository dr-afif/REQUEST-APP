import assert from 'node:assert/strict';
import { hasCacheValue, readCache, writeCacheEntries } from './cache.js';

const store = new Map();

globalThis.localStorage = {
  getItem(key) {
    return store.has(key) ? store.get(key) : null;
  },
  setItem(key, value) {
    store.set(key, String(value));
  },
};

assert.deepEqual(readCache('missing', []), []);
assert.equal(hasCacheValue('missing'), false);

writeCacheEntries([
  ['requests', [{ id: 'r1', name: 'Amy' }]],
  ['settings', { monthly_request_limit: '10' }],
]);

assert.equal(hasCacheValue('requests'), true);
assert.deepEqual(readCache('requests', []), [{ id: 'r1', name: 'Amy' }]);
assert.deepEqual(readCache('settings', {}), { monthly_request_limit: '10' });

store.set('broken', '{not-json');
assert.deepEqual(readCache('broken', { fallback: true }), { fallback: true });

const originalGetItem = globalThis.localStorage.getItem;
globalThis.localStorage.getItem = () => {
  throw new Error('storage unavailable');
};

assert.deepEqual(readCache('requests', ['fallback']), ['fallback']);
assert.equal(hasCacheValue('requests'), false);

globalThis.localStorage.getItem = originalGetItem;

console.log('cache helper tests passed');
