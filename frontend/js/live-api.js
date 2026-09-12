/* frontend/js/live-api.js
 * Resolve /api/* calls to a live Cloudflare (or Node) host when this page is static.
 */
(function (global) {
  'use strict';

  const STORAGE_KEY = 'POWERBULL_LIVE_API';

  function isStaticHost() {
    const h = location.hostname;
    return (
      h.endsWith('github.io')
      || h.endsWith('vercel.app')
      || (h === 'localhost' && !/:(3000|3002|8787)$/.test(location.host))
    );
  }

  function normalizeOrigin(raw) {
    const s = String(raw || '').trim().replace(/\/+$/, '');
    if (!s) return '';
    try {
      const u = new URL(s.includes('://') ? s : `https://${s}`);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
      return u.origin;
    } catch {
      return '';
    }
  }

  function getLiveApiOrigin() {
    const fromQuery = new URLSearchParams(location.search).get('liveApi')
      || new URLSearchParams(location.search).get('api');
    if (fromQuery) {
      const n = normalizeOrigin(fromQuery);
      if (n) {
        try { localStorage.setItem(STORAGE_KEY, n); } catch { /* ignore */ }
        return n;
      }
    }
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      const n = normalizeOrigin(stored);
      if (n) return n;
    } catch { /* ignore */ }
    return normalizeOrigin(global.POWERBULL_LIVE_API);
  }

  function setLiveApiOrigin(raw) {
    const n = normalizeOrigin(raw);
    try {
      if (n) localStorage.setItem(STORAGE_KEY, n);
      else localStorage.removeItem(STORAGE_KEY);
    } catch { /* ignore */ }
    global.POWERBULL_LIVE_API = n;
    return n;
  }

  function resolveApiUrl(path) {
    const p = String(path || '');
    if (/^https?:\/\//i.test(p)) return p;
    const origin = getLiveApiOrigin();
    // On static hosts, always prefer live API origin when set.
    if (origin && (p.startsWith('/api/') || p === '/api')) {
      return origin + p;
    }
    // Same-origin when served by Worker/Node.
    return p;
  }

  async function apiFetch(path, options = {}) {
    const url = resolveApiUrl(path);
    const opts = {
      credentials: 'include',
      ...options,
      headers: {
        ...(options.headers || {}),
      },
    };
    return fetch(url, opts);
  }

  global.PowerBullLiveApi = {
    isStaticHost,
    getLiveApiOrigin,
    setLiveApiOrigin,
    normalizeOrigin,
    resolveApiUrl,
    apiFetch,
  };
})(window);
