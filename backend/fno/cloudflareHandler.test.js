'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

describe('cloudflare handler routes', () => {
  let handleRequest;
  const prev = {};

  before(() => {
    for (const key of ['POWERBULL_RUNTIME', 'POWERBULL_OI_MEMORY_ONLY', 'FNO_FORCE_MOCK', 'DHAN_CLIENT_ID', 'DHAN_ACCESS_TOKEN']) {
      prev[key] = process.env[key];
    }
    process.env.POWERBULL_RUNTIME = 'cloudflare';
    process.env.POWERBULL_OI_MEMORY_ONLY = '1';
    process.env.FNO_FORCE_MOCK = '1';
    ({ handleRequest } = require('../../cloudflare/handler'));
  });

  after(() => {
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('GET /api/health', async () => {
    const resp = await handleRequest(new Request('https://example.com/api/health'), {});
    assert.equal(resp.status, 200);
    const body = await resp.json();
    assert.equal(body.runtime, 'cloudflare-pages');
    assert.equal(body.ok, true);
  });

  it('GET /api/status includes runtime', async () => {
    const resp = await handleRequest(new Request('https://example.com/api/status'), {});
    const body = await resp.json();
    assert.equal(body.runtime, 'cloudflare');
    assert.equal(body.feedConnected, false);
  });

  it('GET /api/fno/credentials/dhan never returns token', async () => {
    const resp = await handleRequest(new Request('https://example.com/api/fno/credentials/dhan'), {
      DHAN_CLIENT_ID: '998877',
      DHAN_ACCESS_TOKEN: 'super-secret-access-token-value',
      SESSION_SECRET: 'unit-test-secret',
    });
    const body = await resp.json();
    const text = JSON.stringify(body);
    assert.equal(body.data.hasDhan, true);
    assert.ok(!text.includes('super-secret-access-token-value'));
    assert.equal(body.data.runtime, 'cloudflare');
    assert.equal(body.data.pinTotpSupported, false);
  });

  it('PUT credentials seals httpOnly cookie', async () => {
    const resp = await handleRequest(new Request('https://example.com/api/fno/credentials/dhan', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        clientId: '112233',
        accessToken: 'fresh-access-token-abcdef',
      }),
    }), { SESSION_SECRET: 'unit-test-secret' });
    assert.equal(resp.status, 200);
    const setCookie = resp.headers.get('Set-Cookie') || '';
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /Secure/i);
    assert.ok(!setCookie.includes('fresh-access-token-abcdef'));
    const body = await resp.json();
    assert.equal(body.data.hasDhan, true);
  });

  it('GET /api/fno/ticker returns envelope under mock', async () => {
    const resp = await handleRequest(new Request('https://example.com/api/fno/ticker'), {
      FNO_FORCE_MOCK: '1',
      SESSION_SECRET: 'unit-test-secret',
    });
    assert.equal(resp.status, 200);
    const body = await resp.json();
    assert.ok(Array.isArray(body.data));
    assert.ok(body.meta);
  });

  it('Node-only routes return 501', async () => {
    const resp = await handleRequest(new Request('https://example.com/api/signals'), {});
    assert.equal(resp.status, 501);
  });
});
