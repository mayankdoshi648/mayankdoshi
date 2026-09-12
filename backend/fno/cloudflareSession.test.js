'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  sealCredentials,
  openCredentials,
  setCookieHeader,
  COOKIE,
} = require('../../cloudflare/sessionCrypto');

describe('cloudflare sessionCrypto', () => {
  it('round-trips sealed credentials', async () => {
    const secret = 'test-session-secret-xyz';
    const sealed = await sealCredentials({
      clientId: '1234567890',
      accessToken: 'dhan-access-token-value-here',
    }, secret);
    assert.ok(sealed.includes('.'));
    const opened = await openCredentials(sealed, secret);
    assert.equal(opened.clientId, '1234567890');
    assert.equal(opened.accessToken, 'dhan-access-token-value-here');
  });

  it('rejects tampered payload', async () => {
    const sealed = await sealCredentials({
      clientId: '1',
      accessToken: 'token-token-token',
    }, 'sec');
    const bad = `${sealed.slice(0, 8)}xxxx${sealed.slice(12)}`;
    assert.equal(await openCredentials(bad, 'sec'), null);
  });

  it('sets Secure httpOnly cookie', () => {
    const h = setCookieHeader('abc.def');
    assert.match(h, new RegExp(`^${COOKIE}=`));
    assert.match(h, /HttpOnly/);
    assert.match(h, /Secure/);
  });
});
