'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { computeMarketRegime, labelFromScore } = require('./marketRegime');

test('labelFromScore thresholds', () => {
  assert.equal(labelFromScore(75), 'STRONG_BULLISH');
  assert.equal(labelFromScore(90), 'STRONG_BULLISH');
  assert.equal(labelFromScore(60), 'BULLISH');
  assert.equal(labelFromScore(74.9), 'BULLISH');
  assert.equal(labelFromScore(40), 'NEUTRAL');
  assert.equal(labelFromScore(59.9), 'NEUTRAL');
  assert.equal(labelFromScore(25), 'BEARISH');
  assert.equal(labelFromScore(39.9), 'BEARISH');
  assert.equal(labelFromScore(24.9), 'STRONG_BEARISH');
  assert.equal(labelFromScore(0), 'STRONG_BEARISH');
});

test('computeMarketRegime bullish when many bullish factors', () => {
  const r = computeMarketRegime({
    priceVsVwap: 'above',
    priceVsEma20: 'above',
    priceVsEma50: 'above',
    breadthPctAbove50: 70,
    advanceDeclineRatio: 2.0,
    fiiNetFutures: 3000,
    pcr: 1.4,
    oiBuildupBias: 'LONG_BUILDUP',
    indiaVix: 11,
    momentumScore: 80,
  });
  assert.ok(r.score >= 60);
  assert.ok(['BULLISH', 'STRONG_BULLISH'].includes(r.label));
  assert.equal(r.confidence, 1);
  assert.equal(r.factors.length, 10);
  assert.ok(r.factors.every((f) => typeof f.contribution === 'number' && f.evidence));
});

test('computeMarketRegime bearish when many bearish factors', () => {
  const r = computeMarketRegime({
    priceVsVwap: 'below',
    priceVsEma20: 'below',
    priceVsEma50: 'below',
    breadthPctAbove50: 20,
    advanceDeclineRatio: 0.4,
    fiiNetFutures: -3000,
    pcr: 0.4,
    oiBuildupBias: 'SHORT_BUILDUP',
    indiaVix: 30,
    momentumScore: 10,
  });
  assert.ok(r.score <= 40);
  assert.ok(['BEARISH', 'STRONG_BEARISH', 'NEUTRAL'].includes(r.label));
  assert.ok(r.score < 50);
});

test('missing factors skipped and reduce confidence', () => {
  const r = computeMarketRegime({
    priceVsVwap: 'above',
    pcr: 1.1,
  });
  assert.equal(r.factors.length, 2);
  assert.equal(r.confidence, 0.2);
  assert.ok(r.score >= 0 && r.score <= 100);
});

test('null/undefined inputs do not fabricate factors', () => {
  const r = computeMarketRegime({
    priceVsVwap: null,
    priceVsEma20: undefined,
    fiiNetFutures: null,
    pcr: 1.0,
  });
  assert.equal(r.factors.length, 1);
  assert.equal(r.factors[0].name, 'pcr');
});

test('empty / invalid input → neutral score 50, confidence 0', () => {
  const a = computeMarketRegime({});
  assert.equal(a.score, 50);
  assert.equal(a.confidence, 0);
  assert.equal(a.label, 'NEUTRAL');
  assert.deepEqual(a.factors, []);

  const b = computeMarketRegime(null);
  assert.equal(b.confidence, 0);
  assert.equal(b.score, 50);
});

test('numeric priceVsVwap and oiBuildupBias score accepted', () => {
  const r = computeMarketRegime({
    priceVsVwap: 0.5,
    oiBuildupBias: 40,
  });
  assert.equal(r.factors.length, 2);
  assert.ok(r.confidence > 0);
});
