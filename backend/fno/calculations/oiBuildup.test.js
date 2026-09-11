'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  WEIGHTS,
  classifyBuildup,
  computeBuildupScore,
  explainBuildup,
  NEUTRAL_THRESHOLD,
} = require('./oiBuildup');

test('classifyBuildup LONG_BUILDUP when price↑ and OI↑', () => {
  assert.equal(classifyBuildup({ priceChangePct: 1.2, oiChangePct: 3.5 }), 'LONG_BUILDUP');
});

test('classifyBuildup SHORT_BUILDUP when price↓ and OI↑', () => {
  assert.equal(classifyBuildup({ priceChangePct: -1.2, oiChangePct: 3.5 }), 'SHORT_BUILDUP');
});

test('classifyBuildup SHORT_COVERING when price↑ and OI↓', () => {
  assert.equal(classifyBuildup({ priceChangePct: 1.2, oiChangePct: -3.5 }), 'SHORT_COVERING');
});

test('classifyBuildup LONG_UNWINDING when price↓ and OI↓', () => {
  assert.equal(classifyBuildup({ priceChangePct: -1.2, oiChangePct: -3.5 }), 'LONG_UNWINDING');
});

test('classifyBuildup NEUTRAL when abs price change < 0.05', () => {
  assert.equal(classifyBuildup({ priceChangePct: 0.04, oiChangePct: 5 }), 'NEUTRAL');
  assert.equal(classifyBuildup({ priceChangePct: -0.049, oiChangePct: -5 }), 'NEUTRAL');
});

test('classifyBuildup NEUTRAL when abs OI change < 0.05', () => {
  assert.equal(classifyBuildup({ priceChangePct: 2, oiChangePct: 0.03 }), 'NEUTRAL');
});

test('classifyBuildup NEUTRAL at exact threshold boundary (abs < 0.05)', () => {
  assert.equal(NEUTRAL_THRESHOLD, 0.05);
  assert.equal(classifyBuildup({ priceChangePct: 0.05, oiChangePct: 1 }), 'LONG_BUILDUP');
  assert.equal(classifyBuildup({ priceChangePct: 0.0499, oiChangePct: 1 }), 'NEUTRAL');
});

test('classifyBuildup NEUTRAL on missing/invalid inputs', () => {
  assert.equal(classifyBuildup({}), 'NEUTRAL');
  assert.equal(classifyBuildup({ priceChangePct: 1 }), 'NEUTRAL');
  assert.equal(classifyBuildup({ oiChangePct: 1 }), 'NEUTRAL');
  assert.equal(classifyBuildup({ priceChangePct: null, oiChangePct: 1 }), 'NEUTRAL');
  assert.equal(classifyBuildup({ priceChangePct: NaN, oiChangePct: 1 }), 'NEUTRAL');
  assert.equal(classifyBuildup(), 'NEUTRAL');
});

test('WEIGHTS is exported and sums to 100', () => {
  assert.ok(WEIGHTS);
  assert.ok(WEIGHTS.priceChangePct);
  assert.ok(WEIGHTS.oiChangePct);
  const sum = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
  assert.equal(sum, 100);
});

test('computeBuildupScore returns value in -100..100', () => {
  const score = computeBuildupScore({
    priceChangePct: 2,
    oiChangePct: 5,
    relativeVolume: 2.5,
    vwapRelation: 'above',
    ivChangePct: -1,
    pcr: 1.2,
    sectorReturnPct: 1,
    marketRegimeScore: 70,
  });
  assert.ok(score >= -100 && score <= 100);
  assert.ok(score > 0, 'long buildup context should score positive');
});

test('computeBuildupScore short buildup leans negative', () => {
  const score = computeBuildupScore({
    priceChangePct: -2,
    oiChangePct: 5,
    relativeVolume: 2,
    vwapRelation: 'below',
    pcr: 0.5,
    sectorReturnPct: -1,
    marketRegimeScore: 20,
  });
  assert.ok(score < 0);
});

test('computeBuildupScore with empty inputs returns 0 (no fabrication)', () => {
  assert.equal(computeBuildupScore({}), 0);
  assert.equal(computeBuildupScore(), 0);
});

test('computeBuildupScore ignores null optional fields', () => {
  const score = computeBuildupScore({
    priceChangePct: 1,
    oiChangePct: 2,
    relativeVolume: null,
    vwapRelation: null,
    ivChangePct: undefined,
    pcr: null,
  });
  assert.ok(score > 0);
});

test('explainBuildup returns classification, score, why[]', () => {
  const result = explainBuildup({ priceChangePct: 1.5, oiChangePct: 4, relativeVolume: 1.8 });
  assert.equal(result.classification, 'LONG_BUILDUP');
  assert.ok(typeof result.score === 'number');
  assert.ok(Array.isArray(result.why));
  assert.ok(result.why.length >= 2);
  assert.ok(result.why.some((w) => w.includes('LONG_BUILDUP')));
});

test('explainBuildup handles missing data', () => {
  const result = explainBuildup({});
  assert.equal(result.classification, 'NEUTRAL');
  assert.equal(result.score, 0);
  assert.ok(result.why.some((w) => /insufficient/i.test(w)));
});
