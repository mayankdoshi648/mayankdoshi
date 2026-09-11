// backend/dhanToken.js — cached Dhan access-token manager
const { fetchAccessToken } = require('./dhanAuth');

function createTokenManager({ config, fetchImpl = fetch, fetchTokenFn = fetchAccessToken }) {
  let cached = null;
  let inflight = null;
  let lastError = null;

  function hasCredentials() {
    return Boolean(config?.clientId && config?.pin && config?.totpSecret);
  }

  function isExpired(entry, now = Date.now()) {
    if (!entry?.accessToken) return true;
    // Refresh 5 minutes before stated expiry; if no expiry, keep for 20h
    const expiryMs = entry.expiryTime
      ? new Date(entry.expiryTime).getTime()
      : entry.fetchedAt + 20 * 60 * 60 * 1000;
    return !Number.isFinite(expiryMs) || now >= expiryMs - 5 * 60 * 1000;
  }

  async function getAccessToken({ force = false } = {}) {
    if (!hasCredentials()) {
      const err = new Error('Dhan credentials not configured (DHAN_CLIENT_ID / DHAN_PIN / DHAN_TOTP_SECRET)');
      lastError = err.message;
      throw err;
    }

    if (!force && cached && !isExpired(cached)) {
      return cached;
    }

    if (inflight) return inflight;

    inflight = (async () => {
      try {
        const result = await fetchTokenFn(
          {
            clientId: config.clientId,
            pin: config.pin,
            totpSecret: config.totpSecret,
          },
          fetchImpl
        );
        cached = {
          accessToken: result.accessToken,
          expiryTime: result.expiryTime || null,
          fetchedAt: Date.now(),
        };
        lastError = null;
        return cached;
      } catch (err) {
        lastError = err.message;
        throw err;
      } finally {
        inflight = null;
      }
    })();

    return inflight;
  }

  function getStatus() {
    const authenticated = Boolean(cached?.accessToken) && !isExpired(cached);
    return {
      hasCredentials: hasCredentials(),
      authenticated,
      expiryTime: cached?.expiryTime || null,
      lastError,
      mode: hasCredentials() ? (authenticated ? 'live' : 'connecting') : 'demo',
    };
  }

  function clear() {
    cached = null;
    lastError = null;
  }

  return { getAccessToken, getStatus, clear, hasCredentials, isExpired };
}

module.exports = { createTokenManager };
