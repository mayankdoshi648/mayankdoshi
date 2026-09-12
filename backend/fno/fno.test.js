'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeQuote, normalizeOptionLeg, normalizeOptionChain, dataEnvelope } = require('./normalize');
const { MockProvider } = require('./providers/mockProvider');
const { FnoService } = require('./service');
const { computeExpectedMove } = require('./calculations/expectedMove');

describe('normalize', () => {
  it('does not invent numbers', () => {
    const q = normalizeQuote({ symbol: 'NIFTY' }, 'test');
    assert.equal(q.ltp, null);
    assert.equal(q.volume, null);
  });
  it('derives oiChange from previous_oi', () => {
    const leg = normalizeOptionLeg({ oi: 120, previous_oi: 100, last_price: 10, previous_close_price: 8 });
    assert.equal(leg.oiChange, 20);
    assert.equal(leg.change, 2);
  });
  it('normalizes dhan-like chain', () => {
    const chain = normalizeOptionChain({
      data: {
        last_price: 100,
        oc: {
          '100.000000': {
            ce: { oi: 1, last_price: 2, implied_volatility: 10 },
            pe: { oi: 3, last_price: 4, implied_volatility: 11 },
          },
        },
      },
    }, { underlying: 'NIFTY', expiry: '2026-09-17' });
    assert.equal(chain.spot, 100);
    assert.equal(chain.strikes.length, 1);
    assert.equal(chain.strikes[0].put.oi, 3);
  });
  it('envelope marks mock', () => {
    const env = dataEnvelope({ ok: true }, { isMock: true, source: 'mock' });
    assert.equal(env.meta.isMock, true);
  });
});

describe('mock provider + service', () => {
  it('returns labeled mock chain with analyzable metrics', async () => {
    const mock = new MockProvider();
    const env = await mock.getOptionChain('NIFTY');
    assert.equal(env.meta.isMock, true);
    assert.ok(env.data.strikes.length > 5);
  });

  it('service scanner classifies buildups', async () => {
    const service = new FnoService({ provider: new MockProvider() });
    const scan = await service.getFoScanner();
    assert.ok(scan.data.length > 10);
    const types = new Set(scan.data.map((r) => r.buildup));
    assert.ok([...types].some((t) => t !== 'NEUTRAL'));
  });

  it('expected move formula sanity via chain analysis', async () => {
    const service = new FnoService({ provider: new MockProvider() });
    const chain = await service.getOptionChain('NIFTY');
    assert.ok(chain.data.expectedMove?.move > 0);
    const manual = computeExpectedMove({
      spot: chain.data.spot,
      atmIv: chain.data.metrics.atmIv,
      dteDays: chain.data.metrics.dteDays,
    });
    assert.ok(Math.abs(manual.move - chain.data.expectedMove.move) < 1e-6);
  });

  it('smart money includes disclaimer', async () => {
    const service = new FnoService({ provider: new MockProvider() });
    const sm = await service.getSmartMoney(5);
    assert.match(sm.data.disclaimer, /PROXY/i);
    assert.ok(sm.data.market?.bias);
    assert.ok(sm.data.rankings?.topLongs);
    assert.ok(Array.isArray(sm.data.rows));
    assert.ok(sm.data.rows[0]?.confidence != null || sm.data.rows.length === 0);
  });

  it('smart money detail returns explainable panel', async () => {
    const service = new FnoService({ provider: new MockProvider() });
    const detail = await service.getSmartMoneyDetail('HDFCBANK');
    assert.equal(detail.data.symbol, 'HDFCBANK');
    assert.ok(detail.data.score != null);
    assert.ok(detail.data.explanation);
    assert.ok(detail.data.components?.priceOi);
    assert.ok(detail.data.history);
  });

  it('watchlist includes smart money fields when available', async () => {
    const service = new FnoService({ provider: new MockProvider() });
    const wl = await service.getWatchlistQuotes();
    const row = (wl.data || []).find((r) => r.symbol === 'HDFCBANK');
    assert.ok(row);
    assert.equal(typeof row.smartMoneyScore, 'number');
    assert.equal(typeof row.smartMoneyConfidence, 'number');
  });

  it('watchlist add/remove', async () => {
    const service = new FnoService({ provider: new MockProvider() });
    service.addWatchlist('INFY');
    assert.ok(service.getWatchlist().includes('INFY'));
    service.removeWatchlist('INFY');
    assert.ok(!service.getWatchlist().includes('INFY'));
  });

  it('alerts evaluate with configurable rules', async () => {
    const service = new FnoService({ provider: new MockProvider() });
    service.updateAlertRules({ unusualVolumeMult: 1.2 });
    const alerts = await service.evaluateAlerts();
    assert.ok(Array.isArray(alerts.data.alerts));
  });

  it('dhan credentials status / set / clear (no secrets in status)', () => {
    const prevForce = process.env.FNO_FORCE_MOCK;
    delete process.env.FNO_FORCE_MOCK;
    const service = new FnoService({
      config: { clientId: '', pin: '', totpSecret: '', hasDhan: false },
      provider: new MockProvider(),
    });
    assert.equal(service.getDhanStatus().hasDhan, false);
    assert.equal(service.getDhanStatus().liveCapable, false);

    const status = service.setDhanCredentials({
      clientId: '1100110011',
      pin: '1234',
      totpSecret: 'JBSWY3DPEHPK3PXP',
      persistEnv: false,
    });
    assert.equal(status.hasDhan, true);
    assert.equal(status.liveCapable, true);
    assert.equal(status.source, 'runtime');
    assert.equal(status.clientIdMasked, '11••••11');
    assert.equal(status.pin, undefined);
    assert.equal(status.totpSecret, undefined);
    assert.ok(service.provider?.name === 'hybrid' || service.provider?.name === 'dhan' || service.provider?.name);

    service.clearDhanCredentials();
    assert.equal(service.getDhanStatus().hasDhan, false);
    assert.equal(service.getDhanStatus().source, 'none');

    if (prevForce != null) process.env.FNO_FORCE_MOCK = prevForce;
    else delete process.env.FNO_FORCE_MOCK;
  });

  it('rejects incomplete dhan credentials', () => {
    const service = new FnoService({ provider: new MockProvider() });
    assert.throws(
      () => service.setDhanCredentials({ clientId: '1', pin: '', totpSecret: '' }),
      /accessToken|pin|totp/i,
    );
  });

  it('accepts clientId + accessToken without PIN/TOTP', () => {
    const prevForce = process.env.FNO_FORCE_MOCK;
    delete process.env.FNO_FORCE_MOCK;
    const service = new FnoService({
      config: { clientId: '', pin: '', totpSecret: '', accessToken: '', hasDhan: false },
      provider: new MockProvider(),
    });
    const status = service.setDhanCredentials({
      clientId: '1100110011',
      accessToken: 'eyJhbGciOi.static.token',
      persistEnv: false,
    });
    assert.equal(status.hasDhan, true);
    assert.equal(status.authMode, 'access_token');
    assert.equal(status.liveCapable, true);
    if (prevForce != null) process.env.FNO_FORCE_MOCK = prevForce;
    else delete process.env.FNO_FORCE_MOCK;
  });

  it('testDhanCredentials uses auth helper', async () => {
    const dhanAuth = require('../dhanAuth');
    const orig = dhanAuth.fetchAccessToken;
    dhanAuth.fetchAccessToken = async () => ({ accessToken: 'abcdTOKEN', expiryTime: '2099-01-01T00:00:00Z' });
    try {
      const service = new FnoService({
        config: { clientId: '1100110011', pin: '1234', totpSecret: 'JBSWY3DPEHPK3PXP' },
        provider: new MockProvider(),
      });
      const result = await service.testDhanCredentials();
      assert.equal(result.ok, true);
      assert.equal(result.authMode, 'pin_totp');
      assert.equal(result.tokenLength, 9);
    } finally {
      dhanAuth.fetchAccessToken = orig;
    }
  });

  it('testDhanCredentials accepts static access token', async () => {
    const service = new FnoService({
      config: { clientId: '1100110011', accessToken: 'statictoken123' },
      provider: new MockProvider(),
    });
    const result = await service.testDhanCredentials();
    assert.equal(result.ok, true);
    assert.equal(result.authMode, 'access_token');
  });

  it('opportunity board returns ranked checklist rows', async () => {
    const service = new FnoService({ provider: new MockProvider() });
    const board = await service.getOpportunityBoard({ limit: 20 });
    assert.ok(Array.isArray(board.data.rows));
    assert.ok(board.data.rows.length >= 10);
    const row = board.data.rows[0];
    assert.ok(row.opportunityScore != null);
    assert.ok(row.confidence != null);
    assert.ok(row.grade);
    assert.ok(row.readiness?.status);
    assert.ok(board.data.rankings?.topBullish);
    assert.match(board.data.disclaimer, /NOT a guarantee/i);
  });

  it('opportunity detail includes wait-for and unavailable fields', async () => {
    const service = new FnoService({ provider: new MockProvider() });
    const board = await service.getOpportunityBoard({ limit: 5 });
    const symbol = board.data.rows[0].symbol;
    const detail = await service.getOpportunityDetail(symbol);
    assert.equal(detail.data.symbol, symbol);
    assert.ok(Array.isArray(detail.data.checks));
    assert.ok(detail.data.checks.some((c) => c.status === 'UNAVAILABLE'));
    assert.ok(detail.data.waitFor);
    assert.ok(detail.data.why);
  });
});
