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
});
