'use strict';

/**
 * Central NSE supplementary data service.
 * UI components must not call NSE endpoints directly — use this module / HybridProvider.
 */

const { NseProvider } = require('./providers/nseProvider');
const { dataEnvelope } = require('./normalize');

const DEFAULT_TTL_MS = {
  indices: 30_000,
  fii: 300_000,
};

function createNseDataService({ fetchImpl = fetch, ttl = DEFAULT_TTL_MS } = {}) {
  const provider = new NseProvider({ fetchImpl });
  /** @type {Map<string, { at: number, value: object }>} */
  const cache = new Map();

  function getCached(key, ttlMs) {
    const hit = cache.get(key);
    if (!hit) return null;
    if (Date.now() - hit.at > ttlMs) return { ...hit.value, meta: { ...hit.value.meta, stale: true } };
    return hit.value;
  }

  function setCached(key, value) {
    cache.set(key, { at: Date.now(), value });
    return value;
  }

  async function withRetry(fn, { retries = 2, delayMs = 400 } = {}) {
    let lastErr;
    for (let i = 0; i <= retries; i += 1) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        if (i < retries) await new Promise((r) => setTimeout(r, delayMs * (i + 1)));
      }
    }
    throw lastErr;
  }

  async function getIndexQuotes(symbols) {
    const key = `idx:${[...symbols].sort().join(',')}`;
    const cached = getCached(key, ttl.indices);
    if (cached && !cached.meta?.stale) return cached;
    try {
      const env = await withRetry(() => provider.getIndexQuotes(symbols));
      return setCached(key, {
        ...env,
        meta: {
          ...env.meta,
          fetchedAt: new Date().toISOString(),
          service: 'nseDataService',
        },
      });
    } catch (err) {
      if (cached) {
        return {
          ...cached,
          meta: {
            ...cached.meta,
            stale: true,
            warning: `NSE refresh failed; serving cache (${err.message})`,
            error: err.message,
          },
        };
      }
      return dataEnvelope([], {
        source: 'nse',
        isMock: false,
        error: err.message,
        asOf: new Date().toISOString(),
        service: 'nseDataService',
      });
    }
  }

  async function getFiiDii() {
    const key = 'fii';
    const cached = getCached(key, ttl.fii);
    if (cached && !cached.meta?.stale) return cached;
    try {
      const env = await withRetry(() => provider.getFiiDii());
      return setCached(key, {
        ...env,
        meta: {
          ...env.meta,
          fetchedAt: new Date().toISOString(),
          service: 'nseDataService',
        },
      });
    } catch (err) {
      if (cached) {
        return {
          ...cached,
          meta: {
            ...cached.meta,
            stale: true,
            warning: `NSE FII/DII refresh failed; serving cache (${err.message})`,
            error: err.message,
          },
        };
      }
      return dataEnvelope(null, {
        source: 'nse',
        isMock: false,
        error: err.message,
        asOf: new Date().toISOString(),
        service: 'nseDataService',
        available: false,
      });
    }
  }

  return {
    getIndexQuotes,
    getFiiDii,
    provider,
  };
}

module.exports = { createNseDataService };
