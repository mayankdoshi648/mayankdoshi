'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  createMarketDataStore,
  classifyFreshness,
  ageSecondsFrom,
  attachFreshness,
  validateMarketRow,
  assertFieldParity,
  buildDataHealth,
} = require('./index');

describe('marketData store', () => {
  let store;
  beforeEach(() => {
    store = createMarketDataStore();
  });

  it('dedupes concurrent getOrFetch for the same key', async () => {
    let calls = 0;
    const fetcher = async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 20));
      return { data: { v: calls }, meta: { source: 'DHAN', asOf: new Date().toISOString() } };
    };
    const [a, b, c] = await Promise.all([
      store.getOrFetch('k1', 5000, fetcher),
      store.getOrFetch('k1', 5000, fetcher),
      store.getOrFetch('k1', 5000, fetcher),
    ]);
    assert.equal(calls, 1);
    assert.equal(a.data.v, 1);
    assert.equal(b.data.v, 1);
    assert.equal(c.data.v, 1);
    assert.ok(store.metrics.dedupedWaits >= 2);
  });

  it('serves cache hit within TTL', async () => {
    await store.getOrFetch('k2', 10_000, async () => ({
      data: 42,
      meta: { source: 'NSE', asOf: new Date().toISOString() },
    }));
    const hit = await store.getOrFetch('k2', 10_000, async () => {
      throw new Error('should not fetch');
    });
    assert.equal(hit.data, 42);
    assert.ok(store.metrics.cacheHits >= 1);
  });

  it('records dhan metrics without leaking tokens', () => {
    store.recordDhan({ ok: false, error: 'access_token=eyJhbGciOi.secret.payload failed' });
    assert.equal(store.metrics.dhanFailed, 1);
    assert.ok(!String(store.metrics.lastError).includes('eyJ'));
    assert.match(String(store.metrics.lastError), /redacted|token/i);
  });
});

describe('freshness + validation', () => {
  it('classifies LIVE/RECENT/STALE/UNAVAILABLE', () => {
    assert.equal(classifyFreshness(5, { marketOpen: true, hasData: true }), 'LIVE');
    assert.equal(classifyFreshness(60, { marketOpen: true, hasData: true }), 'RECENT');
    assert.equal(classifyFreshness(300, { marketOpen: true, hasData: true }), 'STALE');
    assert.equal(classifyFreshness(null, { hasData: false }), 'UNAVAILABLE');
  });

  it('attachFreshness stamps meta', () => {
    const env = attachFreshness({
      data: { ltp: 100 },
      meta: { source: 'DHAN', asOf: new Date().toISOString() },
    });
    assert.ok(env.meta.freshness);
    assert.ok(env.meta.fetchedAt);
    assert.equal(typeof env.meta.ageSeconds, 'number');
  });

  it('rejects invalid market rows', () => {
    const bad = validateMarketRow({ symbol: 'X', ltp: -1, oi: -5 });
    assert.equal(bad.ok, false);
    const good = validateMarketRow({
      symbol: 'NIFTY',
      ltp: 22000,
      oi: 100,
      asOf: new Date().toISOString(),
    });
    assert.equal(good.ok, true);
  });

  it('assertFieldParity catches LTP drift', () => {
    const r = assertFieldParity({ ltp: 100.5 }, { ltp: 100.5 }, ['ltp']);
    assert.equal(r.ok, true);
    const bad = assertFieldParity({ ltp: 100 }, { ltp: 101 }, ['ltp']);
    assert.equal(bad.ok, false);
  });
});

describe('data health', () => {
  it('builds compact health without secrets', () => {
    const store = createMarketDataStore();
    // use singleton? buildDataHealth uses getMarketDataStore singleton —
    // seed via getMarketDataStore from module
    const { getMarketDataStore } = require('./store');
    const g = getMarketDataStore();
    g._resetAll();
    g.recordDhan({ ok: true });
    g.set('probe', { data: 1, meta: { source: 'DHAN', asOf: new Date().toISOString() } }, 5000, 'DHAN');
    const health = buildDataHealth({ hasDhan: true, runtime: 'test' });
    assert.equal(health.dhan.status, 'CONNECTED');
    assert.ok(['LIVE', 'RECENT', 'STALE', 'UNAVAILABLE'].includes(health.overall));
    assert.equal(health.runtime, 'test');
    assert.ok(!JSON.stringify(health).includes('eyJ'));
  });
});

describe('load simulation', () => {
  it('20 concurrent consumers of 5 keys cause only 5 fetches', async () => {
    const store = createMarketDataStore();
    const fetches = { a: 0, b: 0, c: 0, d: 0, e: 0 };
    const keys = Object.keys(fetches);
    const jobs = [];
    for (let i = 0; i < 20; i += 1) {
      const key = keys[i % keys.length];
      jobs.push(store.getOrFetch(`sim:${key}`, 30_000, async () => {
        fetches[key] += 1;
        await new Promise((r) => setTimeout(r, 5));
        return { data: key, meta: { source: 'DHAN', asOf: new Date().toISOString() } };
      }));
    }
    await Promise.all(jobs);
    assert.deepEqual(fetches, { a: 1, b: 1, c: 1, d: 1, e: 1 });
    assert.equal(store.metrics.fetches, 5);
    assert.ok(store.metrics.dedupedWaits >= 15);
  });
});
