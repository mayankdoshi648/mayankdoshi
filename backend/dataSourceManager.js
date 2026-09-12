'use strict';

/**
 * Central health / last-success tracker for Dhan + NSE (and equity WS).
 * Engines and UI read this; they do not scrape raw provider errors for tokens.
 */

function createDataSourceManager() {
  /** @type {Record<string, { status: string, lastSuccessAt: string|null, lastError: string|null, lastMeta: object|null }>} */
  const sources = {
    dhan: { status: 'unknown', lastSuccessAt: null, lastError: null, lastMeta: null },
    nse: { status: 'unknown', lastSuccessAt: null, lastError: null, lastMeta: null },
    websocket: { status: 'unknown', lastSuccessAt: null, lastError: null, lastMeta: null },
  };

  function scrub(err) {
    if (!err) return null;
    return String(err)
      .replace(/eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g, '[token]')
      .replace(/access[_-]?token[=:]\s*\S+/gi, 'access_token=[redacted]')
      .slice(0, 240);
  }

  function record(source, { ok, meta = null, error = null } = {}) {
    const key = String(source || '').toLowerCase();
    if (!sources[key]) {
      sources[key] = { status: 'unknown', lastSuccessAt: null, lastError: null, lastMeta: null };
    }
    const row = sources[key];
    if (ok) {
      row.status = 'connected';
      row.lastSuccessAt = new Date().toISOString();
      row.lastError = null;
      row.lastMeta = meta ? {
        source: meta.source || null,
        isMock: Boolean(meta.isMock),
        stale: Boolean(meta.stale),
        warning: meta.warning || null,
        asOf: meta.asOf || null,
      } : row.lastMeta;
    } else {
      row.status = 'error';
      row.lastError = scrub(error || meta?.error || 'request failed');
      if (meta) {
        row.lastMeta = {
          source: meta.source || null,
          isMock: Boolean(meta.isMock),
          stale: Boolean(meta.stale),
          warning: meta.warning || null,
          asOf: meta.asOf || null,
        };
      }
    }
    return row;
  }

  function recordEnvelope(source, envelope) {
    const meta = envelope?.meta || {};
    if (meta.isMock && meta.warning) {
      return record(source, { ok: false, meta, error: meta.warning });
    }
    if (meta.error && envelope?.data == null) {
      return record(source, { ok: false, meta, error: meta.error });
    }
    return record(source, { ok: true, meta });
  }

  function setWebsocket({ connected, error = null }) {
    if (connected) {
      return record('websocket', { ok: true, meta: { source: 'dhan-ws', isMock: false } });
    }
    sources.websocket.status = error ? 'error' : 'disconnected';
    sources.websocket.lastError = scrub(error);
    return sources.websocket;
  }

  function snapshot({ marketOpen = null, hasDhan = false, auth = null } = {}) {
    const dhanOk = sources.dhan.status === 'connected' || (hasDhan && auth?.authenticated);
    const nseOk = sources.nse.status === 'connected';
    const wsOk = sources.websocket.status === 'connected';

    let overall = 'DATA ERROR';
    if (dhanOk && nseOk) overall = 'DHAN + NSE CONNECTED';
    else if (dhanOk) overall = 'DHAN CONNECTED';
    else if (nseOk) overall = 'NSE CONNECTED';
    else if (hasDhan && auth?.authenticated) overall = 'DHAN CONNECTED';

    if ((dhanOk || nseOk) && sources.dhan.lastMeta?.isMock) overall = 'PARTIAL DATA';
    if (sources.dhan.status === 'error' && sources.nse.status === 'error') overall = 'DATA ERROR';
    if (marketOpen === false) {
      // session closed is not an error — annotate separately
    }

    return {
      overall,
      marketOpen,
      hasDhan: Boolean(hasDhan),
      authMode: auth?.authMode || null,
      authenticated: Boolean(auth?.authenticated),
      sources: {
        dhan: { ...sources.dhan },
        nse: { ...sources.nse },
        websocket: { ...sources.websocket, connected: wsOk },
      },
      asOf: new Date().toISOString(),
    };
  }

  return { record, recordEnvelope, setWebsocket, snapshot, scrub };
}

module.exports = { createDataSourceManager };
