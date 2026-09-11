'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { computeSmartMoneyProxy, DISCLAIMER } = require('./smartMoney');

test('disclaimer always present', () => {
  const r = computeSmartMoneyProxy({});
  assert.equal(r.disclaimer, DISCLAIMER);
  assert.match(r.disclaimer, /PROXY/i);
  assert.match(r.disclaimer, /does not identify actual institutional/i);
});

test('detects STRONG_LONG_BUILDUP', () => {
  const r = computeSmartMoneyProxy({
    priceChangePct: 1.2,
    oiChangePct: 5,
    relativeVolume: 1.2,
  });
  assert.ok(r.signals.includes('STRONG_LONG_BUILDUP'));
  assert.ok(r.score > 0);
  assert.ok(r.why.length > 0);
});

test('detects STRONG_SHORT_BUILDUP', () => {
  const r = computeSmartMoneyProxy({
    priceChangePct: -1.5,
    oiChangePct: 6,
  });
  assert.ok(r.signals.includes('STRONG_SHORT_BUILDUP'));
  assert.ok(r.score < 0);
});

test('detects STRONG_SHORT_COVERING and STRONG_LONG_UNWINDING', () => {
  const sc = computeSmartMoneyProxy({ priceChangePct: 1, oiChangePct: -4 });
  assert.ok(sc.signals.includes('STRONG_SHORT_COVERING'));
  const lu = computeSmartMoneyProxy({ priceChangePct: -1, oiChangePct: -4 });
  assert.ok(lu.signals.includes('STRONG_LONG_UNWINDING'));
});

test('detects UNUSUAL_VOLUME and UNUSUAL_OI', () => {
  const r = computeSmartMoneyProxy({
    priceChangePct: 0.2,
    oiChangePct: 10,
    relativeVolume: 2.5,
  });
  assert.ok(r.signals.includes('UNUSUAL_VOLUME'));
  assert.ok(r.signals.includes('UNUSUAL_OI'));
});

test('detects IV_EXPANSION and IV_CRUSH', () => {
  const exp = computeSmartMoneyProxy({ priceChangePct: 0.1, oiChangePct: 0.1, ivChangePct: 8 });
  assert.ok(exp.signals.includes('IV_EXPANSION'));
  const crush = computeSmartMoneyProxy({ priceChangePct: 0.1, oiChangePct: 0.1, ivChangePct: -8 });
  assert.ok(crush.signals.includes('IV_CRUSH'));
});

test('detects VWAP_BREAKOUT and VWAP_BREAKDOWN', () => {
  const up = computeSmartMoneyProxy({
    priceChangePct: 0.8,
    oiChangePct: 0.1,
    vwapRelation: 'above',
  });
  assert.ok(up.signals.includes('VWAP_BREAKOUT'));
  const down = computeSmartMoneyProxy({
    priceChangePct: -0.8,
    oiChangePct: 0.1,
    vwapRelation: 'below',
  });
  assert.ok(down.signals.includes('VWAP_BREAKDOWN'));
});

test('detects OPTION_CHAIN_IMBALANCE from call/put OI or PCR', () => {
  const byOi = computeSmartMoneyProxy(
    { priceChangePct: 0.1, oiChangePct: 0.1 },
    { putOi: 8000, callOi: 2000 }
  );
  assert.ok(byOi.signals.includes('OPTION_CHAIN_IMBALANCE'));

  const byPcr = computeSmartMoneyProxy({ priceChangePct: 0.1, oiChangePct: 0.1, pcr: 1.8 });
  assert.ok(byPcr.signals.includes('OPTION_CHAIN_IMBALANCE'));
});

test('score always in -100..100; empty instrument safe', () => {
  const r = computeSmartMoneyProxy();
  assert.ok(r.score >= -100 && r.score <= 100);
  assert.ok(Array.isArray(r.signals));
  assert.ok(Array.isArray(r.why));

  const r2 = computeSmartMoneyProxy(null);
  assert.equal(r2.score, 0);
  assert.equal(r2.disclaimer, DISCLAIMER);
});

test('does not fabricate strong signals from tiny moves', () => {
  const r = computeSmartMoneyProxy({ priceChangePct: 0.1, oiChangePct: 0.2 });
  assert.ok(!r.signals.includes('STRONG_LONG_BUILDUP'));
});

test('accepts alternate field names pricePct/oiPct/rvol', () => {
  const r = computeSmartMoneyProxy({ pricePct: 1.5, oiPct: 5, rvol: 3 });
  assert.ok(r.signals.includes('STRONG_LONG_BUILDUP'));
  assert.ok(r.signals.includes('UNUSUAL_VOLUME'));
});
