'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeQuote,
  normalizeOptionLeg,
  normalizeOptionChain,
  dataEnvelope,
  num,
} = require('./normalize');

describe('normalize', () => {
  it('num returns null for missing/invalid values', () => {
    assert.equal(num(null), null);
    assert.equal(num(undefined), null);
    assert.equal(num(''), null);
    assert.equal(num('abc'), null);
    assert.equal(num(12.5), 12.5);
    assert.equal(num('3'), 3);
  });

  it('normalizeQuote maps MarketQuote fields and does not invent numbers', () => {
    const q = normalizeQuote({
      symbol: 'NIFTY',
      last_price: 24500,
      ohlc: { open: 24400, high: 24550, low: 24380, close: 24420 },
      net_change: 80,
      volume: 1000,
      oi: null,
    }, 'dhan');

    assert.equal(q.symbol, 'NIFTY');
    assert.equal(q.ltp, 24500);
    assert.equal(q.open, 24400);
    assert.equal(q.prevClose, 24420);
    assert.equal(q.change, 80);
    assert.equal(q.volume, 1000);
    assert.equal(q.oi, null);
    assert.equal(q.oiChange, null);
    assert.equal(q.iv, null);
    assert.equal(q.source, 'dhan');
    assert.equal(q.stale, false);
  });

  it('normalizeQuote derives changePct only when inputs exist', () => {
    const q = normalizeQuote({ symbol: 'X', ltp: 110, prevClose: 100 });
    assert.equal(q.change, 10);
    assert.equal(q.changePct, 10);
    const sparse = normalizeQuote({ symbol: 'Y', ltp: 110 });
    assert.equal(sparse.change, null);
    assert.equal(sparse.changePct, null);
    assert.equal(sparse.prevClose, null);
  });

  it('normalizeOptionLeg maps Dhan snake_case and computes oiChange', () => {
    const leg = normalizeOptionLeg({
      oi: 1000,
      previous_oi: 800,
      volume: 50,
      implied_volatility: 12.5,
      last_price: 134,
      previous_close_price: 120,
      top_bid_price: 133,
      top_ask_price: 135,
      average_price: 132,
      security_id: 42528,
      greeks: { delta: 0.5, gamma: 0.001, theta: -10, vega: 12 },
    });

    assert.equal(leg.oi, 1000);
    assert.equal(leg.previousOi, 800);
    assert.equal(leg.oiChange, 200);
    assert.equal(leg.iv, 12.5);
    assert.equal(leg.ltp, 134);
    assert.equal(leg.change, 14);
    assert.equal(leg.bid, 133);
    assert.equal(leg.ask, 135);
    assert.equal(leg.securityId, 42528);
    assert.equal(leg.greeks.delta, 0.5);
  });

  it('normalizeOptionLeg uses null for missing numerics (never invents)', () => {
    const leg = normalizeOptionLeg({});
    assert.equal(leg.oi, null);
    assert.equal(leg.previousOi, null);
    assert.equal(leg.oiChange, null);
    assert.equal(leg.volume, null);
    assert.equal(leg.iv, null);
    assert.equal(leg.ltp, null);
    assert.equal(leg.greeks, null);
    assert.equal(leg.securityId, null);
  });

  it('normalizeOptionChain sorts strikes and sets atm', () => {
    const chain = normalizeOptionChain({
      data: {
        last_price: 24505,
        oc: {
          '24600.000000': {
            ce: { last_price: 80, oi: 1, previous_oi: 1, implied_volatility: 10 },
            pe: { last_price: 120, oi: 2, previous_oi: 2, implied_volatility: 11 },
          },
          '24400.000000': {
            ce: { last_price: 150, oi: 3, previous_oi: 2, implied_volatility: 9 },
            pe: { last_price: 40, oi: 4, previous_oi: 4, implied_volatility: 10 },
          },
          '24500.000000': {
            ce: { last_price: 110, oi: 5, previous_oi: 4, implied_volatility: 9.5 },
            pe: { last_price: 105, oi: 6, previous_oi: 5, implied_volatility: 10.2 },
          },
        },
      },
    }, { underlying: 'NIFTY', expiry: '2026-09-17', asOf: '2026-09-11T10:00:00.000Z' });

    assert.equal(chain.underlying, 'NIFTY');
    assert.equal(chain.expiry, '2026-09-17');
    assert.equal(chain.spot, 24505);
    assert.equal(chain.atm, 24500);
    assert.deepEqual(chain.strikes.map((s) => s.strike), [24400, 24500, 24600]);
    assert.equal(chain.strikes[0].call.ltp, 150);
    assert.equal(chain.strikes[0].call.oiChange, 1);
    assert.equal(chain.source, 'dhan');
    assert.deepEqual(chain.metrics, {});
  });

  it('dataEnvelope wraps meta defaults', () => {
    const env = dataEnvelope({ ok: true }, { source: 'mock', isMock: true });
    assert.equal(env.data.ok, true);
    assert.equal(env.meta.source, 'mock');
    assert.equal(env.meta.isMock, true);
    assert.equal(env.meta.stale, false);
    assert.equal(env.meta.error, null);
    assert.ok(env.meta.asOf);
  });
});
