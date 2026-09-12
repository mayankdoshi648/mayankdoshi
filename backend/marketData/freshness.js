'use strict';

/**
 * Freshness classification for live market datasets.
 * NEVER silently present stale/unavailable values as LIVE.
 */

const DEFAULT_THRESHOLDS = Object.freeze({
  liveMaxSec: 30,
  recentMaxSec: 120,
  staleMaxSec: 600,
});

function classifyFreshness(ageSeconds, opts = {}) {
  const {
    liveMaxSec = DEFAULT_THRESHOLDS.liveMaxSec,
    recentMaxSec = DEFAULT_THRESHOLDS.recentMaxSec,
    staleMaxSec = DEFAULT_THRESHOLDS.staleMaxSec,
    marketOpen = true,
    isMock = false,
    hasData = true,
  } = opts;

  if (!hasData || isMock) return 'UNAVAILABLE';
  if (ageSeconds == null || !Number.isFinite(ageSeconds)) return 'UNAVAILABLE';

  if (!marketOpen) {
    if (ageSeconds <= staleMaxSec) return 'RECENT';
    return 'STALE';
  }

  if (ageSeconds <= liveMaxSec) return 'LIVE';
  if (ageSeconds <= recentMaxSec) return 'RECENT';
  if (ageSeconds <= staleMaxSec) return 'STALE';
  return 'UNAVAILABLE';
}

function ageSecondsFrom(timestamp, now = Date.now()) {
  if (timestamp == null) return null;
  const ms = new Date(timestamp).getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.round((now - ms) / 1000));
}

function attachFreshness(envelope, opts = {}) {
  if (!envelope || typeof envelope !== 'object') return envelope;
  const meta = envelope.meta || {};
  const fetchedAt = meta.fetchedAt || meta.asOf || null;
  const receivedAt = meta.receivedAt || new Date().toISOString();
  const ageSeconds = ageSecondsFrom(fetchedAt, opts.now);
  const status = classifyFreshness(ageSeconds, {
    marketOpen: opts.marketOpen,
    isMock: Boolean(meta.isMock),
    hasData: envelope.data != null && !meta.error,
    liveMaxSec: opts.liveMaxSec,
    recentMaxSec: opts.recentMaxSec,
    staleMaxSec: opts.staleMaxSec,
  });

  envelope.meta = {
    ...meta,
    fetchedAt: fetchedAt || receivedAt,
    receivedAt,
    ageSeconds,
    freshness: status,
    stale: status === 'STALE' || status === 'UNAVAILABLE' || Boolean(meta.stale),
  };
  return envelope;
}

module.exports = {
  DEFAULT_THRESHOLDS,
  classifyFreshness,
  ageSecondsFrom,
  attachFreshness,
};
