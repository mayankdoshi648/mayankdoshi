// backend/dhanAuth.js
const { authenticator } = require('otplib');

const GENERATE_TOKEN_URL = 'https://auth.dhan.co/app/generateAccessToken';

function normalizeTotpSecret(totpSecret) {
  return String(totpSecret || '').trim().replace(/\s+/g, '').toUpperCase();
}

function assertTotpSecretFormat(totpSecret) {
  const secret = normalizeTotpSecret(totpSecret);
  if (!secret) {
    throw new Error('TOTP secret is empty');
  }
  // Dhan/Google-Authenticator secrets are base32 (A–Z, 2–7), typically 16–64 chars.
  // A 6-digit code is a one-time password, not the secret.
  if (/^\d{6}$/.test(secret)) {
    throw new Error('DHAN_TOTP_SECRET looks like a 6-digit OTP code. Paste the Base32 TOTP secret from Dhan 2FA setup, not a one-time code.');
  }
  if (secret.length < 16 || !/^[A-Z2-7]+=*$/.test(secret)) {
    throw new Error(
      `DHAN_TOTP_SECRET looks invalid (len=${secret.length}). Expected a Base32 secret (A–Z, 2–7), usually 16+ characters from Dhan TOTP setup.`
    );
  }
  return secret;
}

async function fetchAccessToken({ clientId, pin, totpSecret }, fetchImpl = fetch) {
  const secret = assertTotpSecretFormat(totpSecret);
  const totp = authenticator.generate(secret);
  const url = new URL(GENERATE_TOKEN_URL);
  url.searchParams.set('dhanClientId', clientId);
  url.searchParams.set('pin', pin);
  url.searchParams.set('totp', totp);

  const resp = await fetchImpl(url.toString(), { method: 'POST' });
  if (!resp.ok) {
    throw new Error(`Dhan generateAccessToken failed: HTTP ${resp.status}`);
  }
  const body = await resp.json();
  if (!body.accessToken) {
    const detail = body.remarks || body.message || body.errorMessage || body.status || 'missing accessToken';
    throw new Error(`Dhan auth failed: ${detail}`);
  }
  return { accessToken: body.accessToken, expiryTime: body.expiryTime };
}

module.exports = { fetchAccessToken, assertTotpSecretFormat, normalizeTotpSecret };
