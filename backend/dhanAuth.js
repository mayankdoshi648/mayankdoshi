// backend/dhanAuth.js
const { authenticator } = require('otplib');

const GENERATE_TOKEN_URL = 'https://auth.dhan.co/app/generateAccessToken';

async function fetchAccessToken({ clientId, pin, totpSecret }, fetchImpl = fetch) {
  const totp = authenticator.generate(totpSecret);
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
    throw new Error('Dhan generateAccessToken response missing accessToken');
  }
  return { accessToken: body.accessToken, expiryTime: body.expiryTime };
}

module.exports = { fetchAccessToken };
