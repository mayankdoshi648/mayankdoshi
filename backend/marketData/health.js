'use strict';

const { getMarketDataStore } = require('./store');
const { classifyFreshness, ageSecondsFrom } = require('./freshness');
const { isMarketOpen } = require('../marketWindow');

/**
 * Compact Data Health snapshot for UI + /api/data-health.
 * Never includes credentials or tokens.
 */
function buildDataHealth({
  dataSources = null,
  hasDhan = false,
  auth = null,
  marketOpen = null,
  runtime = null,
} = {}) {
  const store = getMarketDataStore();
  const snap = store.snapshot();
  const m = snap.metrics;
  const open = marketOpen == null ? isMarketOpen() : marketOpen;

  const connSnap = dataSources?.snapshot
    ? dataSources.snapshot({ marketOpen: open, hasDhan, auth })
    : null;
  const dhanSrc = connSnap?.sources?.dhan || null;
  const nseSrc = connSnap?.sources?.nse || null;

  const dhanStatus = resolveProviderStatus({
    hasCreds: hasDhan,
    sourceRow: dhanSrc,
    success: m.dhanSuccess,
    failed: m.dhanFailed,
    rateLimited: m.dhanRateLimited,
    lastAt: m.lastDhanAt || dhanSrc?.lastSuccessAt,
  });

  const nseStatus = resolveProviderStatus({
    hasCreds: true,
    sourceRow: nseSrc,
    success: m.nseSuccess,
    failed: m.nseFailed,
    rateLimited: 0,
    lastAt: m.lastNseAt || nseSrc?.lastSuccessAt,
  });

  const latestAt = snap.latestMarketUpdateAt
    || m.lastDhanAt
    || m.lastNseAt
    || dhanSrc?.lastSuccessAt
    || null;
  const ageSeconds = ageSecondsFrom(latestAt);
  let overall = classifyFreshness(ageSeconds, {
    marketOpen: open,
    isMock: false,
    hasData: Boolean(latestAt) || m.dhanSuccess > 0 || m.nseSuccess > 0,
  });

  if (dhanStatus === 'DISCONNECTED' && nseStatus === 'DISCONNECTED' && !latestAt) {
    overall = 'UNAVAILABLE';
  }

  const cacheLabel = m.cacheHits > m.cacheMisses ? 'HIT' : (m.cacheMisses > 0 ? 'MISS' : '—');

  return {
    dhan: {
      status: dhanStatus,
      lastSuccessAt: m.lastDhanAt || dhanSrc?.lastSuccessAt || null,
      requests: {
        successful: m.dhanSuccess,
        failed: m.dhanFailed,
        rateLimited: m.dhanRateLimited,
        total: m.dhanRequests,
      },
      lastError: scrubPublic(m.lastError || dhanSrc?.lastError),
    },
    nse: {
      status: nseStatus,
      lastSuccessAt: m.lastNseAt || nseSrc?.lastSuccessAt || null,
      requests: {
        successful: m.nseSuccess,
        failed: m.nseFailed,
        total: m.nseRequests,
      },
      lastError: scrubPublic(nseSrc?.lastError),
    },
    cache: {
      label: cacheLabel,
      hits: m.cacheHits,
      misses: m.cacheMisses,
      hitRate: m.cacheHitRate,
      staleServes: m.cacheStaleServes,
      dedupedWaits: m.dedupedWaits,
      size: m.cacheSize,
      inflight: m.inflight,
    },
    overall,
    lastSuccessfulUpdateAt: latestAt,
    lastSuccessfulUpdateAgeSeconds: ageSeconds,
    marketOpen: open,
    runtime: runtime || null,
    connections: connSnap || null,
    entries: snap.entries.slice(0, 24),
    asOf: snap.asOf,
  };
}

function resolveProviderStatus({ hasCreds, sourceRow, success, failed, rateLimited, lastAt }) {
  if (!hasCreds && success === 0) return 'DISCONNECTED';
  if (sourceRow?.status === 'error' && success === 0) return 'DISCONNECTED';
  if (rateLimited > 0 && rateLimited >= Math.max(1, success)) return 'DEGRADED';
  if (failed > 0 && success > 0) return 'DEGRADED';
  if (sourceRow?.status === 'connected' || success > 0 || lastAt) return 'CONNECTED';
  if (hasCreds) return 'CONNECTED';
  return 'DISCONNECTED';
}

function scrubPublic(err) {
  if (!err) return null;
  return String(err)
    .replace(/eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g, '[token]')
    .replace(/access[_-]?token[=:]\s*\S+/gi, 'access_token=[redacted]')
    .slice(0, 200);
}

module.exports = { buildDataHealth };
