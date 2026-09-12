'use strict';

const crypto = require('node:crypto');

/**
 * Minimal signed httpOnly session for Dhan credentials entered via UI.
 * Tokens live in server memory only (optional env persist is separate).
 */

const COOKIE = 'pb_session';
const DEFAULT_TTL_MS = 12 * 60 * 60 * 1000;

function createCredentialSession({
  secret = process.env.SESSION_SECRET || process.env.DHAN_CLIENT_ID || 'powerbull-dev-session',
  ttlMs = DEFAULT_TTL_MS,
} = {}) {
  /** @type {Map<string, { clientId: string, accessToken: string, createdAt: number, lastSeen: number }>} */
  const sessions = new Map();

  function sign(id) {
    return crypto.createHmac('sha256', secret).update(id).digest('hex').slice(0, 24);
  }

  function pack(id) {
    return `${id}.${sign(id)}`;
  }

  function unpack(raw) {
    if (!raw || !String(raw).includes('.')) return null;
    const [id, sig] = String(raw).split('.');
    if (!id || sig !== sign(id)) return null;
    return id;
  }

  function parseCookie(header) {
    if (!header) return null;
    const parts = String(header).split(';');
    for (const part of parts) {
      const [k, ...rest] = part.trim().split('=');
      if (k === COOKIE) return unpack(decodeURIComponent(rest.join('=')));
    }
    return null;
  }

  function create(creds) {
    const id = crypto.randomBytes(16).toString('hex');
    const now = Date.now();
    sessions.set(id, {
      clientId: String(creds.clientId || '').trim(),
      accessToken: String(creds.accessToken || '').trim(),
      createdAt: now,
      lastSeen: now,
    });
    return id;
  }

  function get(id) {
    if (!id) return null;
    const row = sessions.get(id);
    if (!row) return null;
    if (Date.now() - row.lastSeen > ttlMs) {
      sessions.delete(id);
      return null;
    }
    row.lastSeen = Date.now();
    return row;
  }

  function clear(id) {
    if (id) sessions.delete(id);
  }

  function setCookieHeaders(res, id, { clearCookie = false } = {}) {
    if (clearCookie || !id) {
      res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
      return;
    }
    const secure = process.env.NODE_ENV === 'production' || process.env.FORCE_SECURE_COOKIES === '1';
    const maxAge = Math.floor(ttlMs / 1000);
    res.setHeader(
      'Set-Cookie',
      `${COOKIE}=${encodeURIComponent(pack(id))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`,
    );
  }

  function fromRequest(req) {
    return get(parseCookie(req.headers.cookie));
  }

  return {
    COOKIE,
    create,
    get,
    clear,
    parseCookie,
    setCookieHeaders,
    fromRequest,
  };
}

module.exports = { createCredentialSession };
