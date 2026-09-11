// backend/dhanToken.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createTokenManager } = require('./dhanToken');

test('token manager reports demo status without credentials', () => {
  const tm = createTokenManager({ config: {} });
  const status = tm.getStatus();
  assert.equal(status.hasCredentials, false);
  assert.equal(status.mode, 'demo');
});

test('token manager caches access token', async () => {
  let calls = 0;
  const tm = createTokenManager({
    config: { clientId: 'c', pin: '1', totpSecret: 'S'.repeat(16) },
    fetchTokenFn: async () => {
      calls += 1;
      return { accessToken: 'abc', expiryTime: new Date(Date.now() + 3600_000).toISOString() };
    },
  });

  const a = await tm.getAccessToken();
  const b = await tm.getAccessToken();
  assert.equal(a.accessToken, 'abc');
  assert.equal(b.accessToken, 'abc');
  assert.equal(calls, 1);
  assert.equal(tm.getStatus().authenticated, true);
  assert.equal(tm.getStatus().mode, 'live');
});

test('token manager force refresh', async () => {
  let calls = 0;
  const tm = createTokenManager({
    config: { clientId: 'c', pin: '1', totpSecret: 'S'.repeat(16) },
    fetchTokenFn: async () => {
      calls += 1;
      return { accessToken: `tok-${calls}`, expiryTime: new Date(Date.now() + 3600_000).toISOString() };
    },
  });
  await tm.getAccessToken();
  const forced = await tm.getAccessToken({ force: true });
  assert.equal(forced.accessToken, 'tok-2');
  assert.equal(calls, 2);
});
