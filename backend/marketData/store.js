'use strict';

/**
 * Isolate-shared market-data store (Cloudflare Worker + Node).
 * TTL cache + in-flight promise dedupe + Dhan/NSE metrics.
 */

const { attachFreshness, classifyFreshness, ageSecondsFrom } = require('./freshness');

const TTL = Object.freeze({
  LTP: 5_000,
  TICKER: 20_000,
  OPTION_CHAIN: 15_000,
  FUTURES_OI: 45_000,
  SCANNER: 90_000,
  MARKET_WIDE: 60_000,
  FII: 300_000,
  INSTRUMENT_MASTER: 6 * 60 * 60_000,
  WEEK52: 12 * 60 * 60_000,
  HISTORICAL: 6 * 60 * 60_000,
  OVERVIEW: 45_000,
  EQUITY_QUOTES: 90_000,
  EQUITY_QUOTES_LITE: 180_000,
});

function emptyMetrics() {
  return {
    cacheHits: 0,
    cacheMisses: 0,
    cacheStaleServes: 0,
    dedupedWaits: 0,
    fetches: 0,
    fetchErrors: 0,
    dhanRequests: 0,
    dhanSuccess: 0,
    dhanFailed: 0,
    dhanRateLimited: 0,
    nseRequests: 0,
    nseSuccess: 0,
    nseFailed: 0,
    lastDhanAt: null,
    lastNseAt: null,
    lastError: null,
    startedAt: new Date().toISOString(),
  };
}

function createMarketDataStore({ now = () => Date.now() } = {}) {
  const cache = new Map();
  const inflight = new Map();
  const metrics = emptyMetrics();

  function scrub(err) {
    if (!err) return null;
    return String(err)
      .replace(/eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g, '[token]')
      .replace(/access[_-]?token[=:]\s*\S+/gi, 'access_token=[redacted]')
      .slice(0, 240);
  }

  function recordDhan({ ok, rateLimited = false, error = null } = {}) {
    metrics.dhanRequests += 1;
    if (ok) {
      metrics.dhanSuccess += 1;
      metrics.lastDhanAt = new Date(now()).toISOString();
    } else {
      metrics.dhanFailed += 1;
      metrics.lastError = scrub(error);
    }
    if (rateLimited) metrics.dhanRateLimited += 1;
  }

  function recordNse({ ok, error = null } = {}) {
    metrics.nseRequests += 1;
    if (ok) {
      metrics.nseSuccess += 1;
      metrics.lastNseAt = new Date(now()).toISOString();
    } else {
      metrics.nseFailed += 1;
      metrics.lastError = scrub(error);
    }
  }

  function peek(key) {
    return cache.get(key) || null;
  }

  function getFresh(key) {
    const hit = cache.get(key);
    if (!hit) {
      metrics.cacheMisses += 1;
      return null;
    }
    const age = now() - hit.at;
    if (age > hit.ttl) {
      metrics.cacheMisses += 1;
      return { value: hit.value, stale: true, ageMs: age, source: hit.source };
    }
    metrics.cacheHits += 1;
    return { value: hit.value, stale: false, ageMs: age, source: hit.source };
  }

  function set(key, value, ttlMs, source = null) {
    const receivedAt = new Date(now()).toISOString();
    let stored = value;
    if (value && typeof value === 'object' && value.meta) {
      stored = attachFreshness({
        ...value,
        meta: {
          ...value.meta,
          fetchedAt: value.meta.fetchedAt || value.meta.asOf || receivedAt,
          receivedAt,
          source: value.meta.source || source,
          cacheKey: key,
        },
      }, { now: now() });
    }
    cache.set(key, {
      at: now(),
      ttl: ttlMs,
      value: stored,
      source: source || stored?.meta?.source || null,
    });
    return stored;
  }

  async function getOrFetch(key, ttlMs, fetcher, {
    allowStaleOnError = true,
    sourceHint = null,
  } = {}) {
    const fresh = getFresh(key);
    if (fresh && !fresh.stale) return fresh.value;

    if (inflight.has(key)) {
      metrics.dedupedWaits += 1;
      return inflight.get(key);
    }

    const pending = (async () => {
      metrics.fetches += 1;
      try {
        const value = await fetcher();
        return set(key, value, ttlMs, sourceHint || value?.meta?.source || null);
      } catch (err) {
        metrics.fetchErrors += 1;
        metrics.lastError = scrub(err);
        if (allowStaleOnError) {
          const staleHit = cache.get(key);
          if (staleHit?.value) {
            metrics.cacheStaleServes += 1;
            const v = staleHit.value;
            if (v?.meta) {
              v.meta = {
                ...v.meta,
                stale: true,
                freshness: 'STALE',
                warning: v.meta.warning || `Serving stale cache after error: ${scrub(err)}`,
                ageSeconds: ageSecondsFrom(v.meta.fetchedAt || v.meta.asOf, now()),
              };
            }
            return v;
          }
        }
        throw err;
      } finally {
        inflight.delete(key);
      }
    })();

    inflight.set(key, pending);
    return pending;
  }

  function invalidate(keyOrPrefix) {
    if (!keyOrPrefix) {
      cache.clear();
      return;
    }
    if (cache.has(keyOrPrefix)) {
      cache.delete(keyOrPrefix);
      return;
    }
    for (const k of [...cache.keys()]) {
      if (k.startsWith(keyOrPrefix)) cache.delete(k);
    }
  }

  function snapshot() {
    const entries = [];
    let latestFetchedAt = null;
    for (const [key, hit] of cache.entries()) {
      const meta = hit.value?.meta || {};
      const fetchedAt = meta.fetchedAt || meta.asOf || null;
      const ageSeconds = ageSecondsFrom(fetchedAt, now());
      const freshness = meta.freshness || classifyFreshness(ageSeconds, {
        isMock: Boolean(meta.isMock),
        hasData: hit.value?.data != null,
      });
      if (fetchedAt && (!latestFetchedAt || fetchedAt > latestFetchedAt)) {
        latestFetchedAt = fetchedAt;
      }
      entries.push({
        key,
        source: hit.source || meta.source || null,
        ageSeconds,
        freshness,
        isMock: Boolean(meta.isMock),
        stale: Boolean(meta.stale) || freshness === 'STALE',
      });
    }

    const hitRate = (metrics.cacheHits + metrics.cacheMisses) > 0
      ? metrics.cacheHits / (metrics.cacheHits + metrics.cacheMisses)
      : null;

    return {
      metrics: {
        ...metrics,
        cacheHitRate: hitRate,
        inflight: inflight.size,
        cacheSize: cache.size,
      },
      entries,
      latestMarketUpdateAt: latestFetchedAt,
      asOf: new Date(now()).toISOString(),
    };
  }

  function resetMetrics() {
    Object.assign(metrics, emptyMetrics());
  }

  function _resetAll() {
    cache.clear();
    inflight.clear();
    resetMetrics();
  }

  return {
    TTL,
    getOrFetch,
    getFresh,
    peek,
    set,
    invalidate,
    snapshot,
    recordDhan,
    recordNse,
    resetMetrics,
    _resetAll,
    get metrics() { return { ...metrics }; },
  };
}

function getMarketDataStore() {
  if (!globalThis.__powerbullMarketDataStore) {
    globalThis.__powerbullMarketDataStore = createMarketDataStore();
  }
  return globalThis.__powerbullMarketDataStore;
}

module.exports = {
  TTL,
  createMarketDataStore,
  getMarketDataStore,
};
