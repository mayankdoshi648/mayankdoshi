// backend/dhanToken.js — cached Dhan access-token manager
const { fetchAccessToken } = require('./dhanAuth');
const { hasDhanCredentials, hasLoginCredentials, hasStaticAccessToken } = require('./config');

function createTokenManager({ config, fetchImpl = fetch, fetchTokenFn = fetchAccessToken }) {
  let cached = null;
  let inflight = null;
  let lastError = null;

  function hasCredentials() {
    return hasDhanCredentials(config);
  }

  function isExpired(entry, now = Date.now()) {
    if (!entry?.accessToken) return true;
    // Refresh 5 minutes before stated expiry; if no expiry, keep for 20h
    const expiryMs = entry.expiryTime
      ? new Date(entry.expiryTime).getTime()
      : entry.fetchedAt + 20 * 60 * 60 * 1000;
    return !Number.isFinite(expiryMs) || now >= expiryMs - 5 * 60 * 1000;
  }

  function staticTokenEntry() {
    return {
      accessToken: config.accessToken,
      expiryTime: config.accessTokenExpiry || null,
      fetchedAt: Date.now(),
      source: 'static',
    };
  }

  async function getAccessToken({ force = false } = {}) {
    if (!hasCredentials()) {
      const err = new Error(
        'Dhan credentials not configured (DHAN_CLIENT_ID + DHAN_ACCESS_TOKEN, or PIN + TOTP secret)'
      );
      lastError = err.message;
      throw err;
    }

    // Preferred path: paste a ready-made access token (no PIN/TOTP needed).
    if (hasStaticAccessToken(config)) {
      if (force || !cached || cached.accessToken !== config.accessToken || isExpired(cached)) {
        cached = staticTokenEntry();
      }
      lastError = null;
      return cached;
    }

    if (!hasLoginCredentials(config)) {
      const err = new Error('Dhan credentials incomplete');
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
          source: 'login',
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
      authMode: hasStaticAccessToken(config) ? 'access_token' : (hasLoginCredentials(config) ? 'pin_totp' : null),
    };
  }

  function clear() {
    cached = null;
    lastError = null;
  }

  return { getAccessToken, getStatus, clear, hasCredentials, isExpired };
}

module.exports = { createTokenManager };
