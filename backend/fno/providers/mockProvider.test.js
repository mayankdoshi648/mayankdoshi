'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { MockProvider, MOCK_SPOT, buildMockOptionChain } = require('./mockProvider');
const { createProvider } = require('./index');

describe('MockProvider', () => {
  it('always labels envelopes as mock', async () => {
    const p = new MockProvider({ asOf: '2026-09-11T10:00:00.000Z' });
    const quotes = await p.getIndexQuotes(['NIFTY', 'BANKNIFTY', 'INDIA VIX']);
    assert.equal(quotes.meta.isMock, true);
    assert.equal(quotes.meta.source, 'mock');
    assert.ok(quotes.data.length >= 3);
    const nifty = quotes.data.find((q) => q.symbol === 'NIFTY');
    assert.equal(nifty.ltp, MOCK_SPOT.NIFTY);
    assert.ok(nifty.open != null);
    assert.ok(nifty.high != null);
    assert.ok(nifty.low != null);
    assert.ok(nifty.prevClose != null);
  });

  it('builds a realistic NIFTY option chain around ~24500', async () => {
    const p = new MockProvider();
    const { data, meta } = await p.getOptionChain('NIFTY');
    assert.equal(meta.isMock, true);
    assert.equal(data.spot, 24500);
    assert.ok(data.strikes.length >= 10);
    assert.ok(data.strikes.every((s, i, arr) => i === 0 || arr[i - 1].strike < s.strike));
    const atm = data.strikes.find((s) => s.strike === data.atm);
    assert.ok(atm.call.oi > 0);
    assert.ok(atm.put.iv > 0);
    assert.ok(atm.call.volume > 0);
  });

  it('returns sample futures with buildup labels for scanners', async () => {
    const p = new MockProvider();
    const { data, meta } = await p.getFuturesQuotes();
    assert.equal(meta.isMock, true);
    assert.ok(data.length >= 5);
    assert.ok(data.every((q) => q.buildup && q.oi != null));
  });

  it('returns clearly labeled mock FII/DII cash numbers', async () => {
    const p = new MockProvider();
    const { data, meta } = await p.getFiiDii();
    assert.equal(meta.isMock, true);
    assert.equal(data.available, true);
    assert.ok(String(data.cash.label).includes('MOCK'));
    assert.equal(typeof data.cash.fii, 'number');
  });

  it('createProvider without Dhan creds returns MockProvider', () => {
    const p = createProvider({ config: {} });
    assert.ok(p instanceof MockProvider);
  });

  it('buildMockOptionChain is deterministic', () => {
    const a = buildMockOptionChain('NIFTY', '2026-09-17');
    const b = buildMockOptionChain('NIFTY', '2026-09-17');
    assert.equal(a.strikes[0].call.oi, b.strikes[0].call.oi);
    assert.equal(a.strikes[0].put.iv, b.strikes[0].put.iv);
  });
});
