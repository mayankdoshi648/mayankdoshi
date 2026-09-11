'use strict';

/**
 * Encrypt Dhan credentials into an httpOnly cookie (no KV required on free tier).
 * Never log plaintext tokens.
 */

const COOKIE = 'pb_dhan_sess';

function b64url(buf) {
  let s;
  if (typeof Buffer !== 'undefined') s = Buffer.from(buf).toString('base64');
  else {
    let bin = '';
    const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
    s = btoa(bin);
  }
  return s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromB64url(s) {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + pad;
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(b64, 'base64'));
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveKey(secret) {
  const enc = new TextEncoder();
  const base = await crypto.subtle.importKey('raw', enc.encode(String(secret || 'powerbull-dev')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode('powerbull-dhan-v1'), iterations: 100000, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function sealCredentials({ clientId, accessToken }, secret) {
  const key = await deriveKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const payload = new TextEncoder().encode(JSON.stringify({
    clientId: String(clientId || '').trim(),
    accessToken: String(accessToken || '').trim(),
    at: Date.now(),
  }));
  const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, payload);
  return `${b64url(iv)}.${b64url(new Uint8Array(sealed))}`;
}

async function openCredentials(token, secret) {
  if (!token || !String(token).includes('.')) return null;
  try {
    const [ivPart, dataPart] = String(token).split('.');
    const key = await deriveKey(secret);
    const iv = fromB64url(ivPart);
    const data = fromB64url(dataPart);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
    const json = JSON.parse(new TextDecoder().decode(plain));
    if (!json?.clientId || !json?.accessToken) return null;
    // 12h session
    if (json.at && Date.now() - Number(json.at) > 12 * 60 * 60 * 1000) return null;
    return { clientId: json.clientId, accessToken: json.accessToken };
  } catch {
    return null;
  }
}

function readCookie(request, name = COOKIE) {
  const raw = request.headers.get('Cookie') || '';
  const parts = raw.split(';');
  for (const part of parts) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

function setCookieHeader(value, { clear = false } = {}) {
  if (clear || !value) {
    return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
  }
  return `${COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${12 * 60 * 60}`;
}

module.exports = {
  COOKIE,
  sealCredentials,
  openCredentials,
  readCookie,
  setCookieHeader,
};
