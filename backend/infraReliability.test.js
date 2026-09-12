'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createDataSourceManager } = require('./dataSourceManager');
const { validateQuote, isStale } = require('./priceValidation');
const { createCredentialSession } = require('./credentialSession');

describe('dataSourceManager', () => {
  it('records success and builds overall status', () => {
    const ds = createDataSourceManager();
    ds.recordEnvelope('dhan', { meta: { source: 'dhan', isMock: false, asOf: new Date().toISOString() } });
    ds.recordEnvelope('nse', { meta: { source: 'nse', isMock: false, asOf: new Date().toISOString() } });
    const snap = ds.snapshot({ marketOpen: false, hasDhan: true, auth: { authenticated: true, authMode: 'access_token' } });
    assert.match(snap.overall, /CONNECTED/);
    assert.equal(snap.sources.dhan.status, 'connected');
    assert.equal(snap.sources.nse.status, 'connected');
  });

  it('scrubs token-looking strings from errors', () => {
    const ds = createDataSourceManager();
    ds.record('dhan', { ok: false, error: 'fail eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.aaa.bbb' });
    assert.match(ds.snapshot().sources.dhan.lastError, /\[token\]/);
  });
});

describe('priceValidation', () => {
  it('flags non-positive LTP as BAD', () => {
    const v = validateQuote({ ltp: 0, timestamp: new Date().toISOString() });
    assert.equal(v.quality, 'BAD');
    assert.equal(v.ok, false);
  });

  it('does not mark closed-session prints stale', () => {
    assert.equal(isStale(new Date(Date.now() - 600_000).toISOString(), { marketOpen: false }), false);
  });
});

describe('credentialSession', () => {
  it('round-trips signed cookie ids without exposing token in cookie value', () => {
    const sessions = createCredentialSession({ secret: 'test-secret' });
    const id = sessions.create({ clientId: '1100110011', accessToken: 'super-secret-token' });
    const res = { setHeader() {} };
    let cookie = '';
    res.setHeader = (_k, v) => { cookie = v; };
    sessions.setCookieHeaders(res, id);
    assert.doesNotMatch(cookie, /super-secret-token/);
    const req = { headers: { cookie: cookie.split(';')[0] } };
    const row = sessions.fromRequest(req);
    assert.equal(row.clientId, '1100110011');
    assert.equal(row.accessToken, 'super-secret-token');
    assert.equal(sessions.parseCookie(req.headers.cookie), id);
  });
});
