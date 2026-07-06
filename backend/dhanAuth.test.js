// backend/dhanAuth.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { fetchAccessToken } = require('./dhanAuth');

const VALID_TOTP_SECRET = 'JBSWY3DPEHPK3PXP';

test('fetchAccessToken POSTs clientId, pin, and a 6-digit totp to the generateAccessToken endpoint', async () => {
  let capturedUrl;
  let capturedOptions;
  const fetchImpl = async (url, options) => {
    capturedUrl = url;
    capturedOptions = options;
    return {
      ok: true,
      json: async () => ({ accessToken: 'tok123', expiryTime: '2026-07-07T09:30:00Z', dhanClientId: '1000000001' }),
    };
  };

  const result = await fetchAccessToken(
    { clientId: '1000000001', pin: '123456', totpSecret: VALID_TOTP_SECRET },
    fetchImpl
  );

  const parsed = new URL(capturedUrl);
  assert.equal(parsed.origin + parsed.pathname, 'https://auth.dhan.co/app/generateAccessToken');
  assert.equal(parsed.searchParams.get('dhanClientId'), '1000000001');
  assert.equal(parsed.searchParams.get('pin'), '123456');
  assert.match(parsed.searchParams.get('totp'), /^\d{6}$/);
  assert.equal(capturedOptions.method, 'POST');
  assert.deepEqual(result, { accessToken: 'tok123', expiryTime: '2026-07-07T09:30:00Z' });
});

test('fetchAccessToken throws with the HTTP status when the response is not OK', async () => {
  const fetchImpl = async () => ({ ok: false, status: 401, statusText: 'Unauthorized' });
  await assert.rejects(
    () => fetchAccessToken({ clientId: 'x', pin: 'y', totpSecret: VALID_TOTP_SECRET }, fetchImpl),
    /401/
  );
});

test('fetchAccessToken throws when the response body has no accessToken', async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ foo: 'bar' }) });
  await assert.rejects(
    () => fetchAccessToken({ clientId: 'x', pin: 'y', totpSecret: VALID_TOTP_SECRET }, fetchImpl),
    /accessToken/
  );
});
