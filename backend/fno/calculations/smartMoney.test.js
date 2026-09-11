'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DISCLAIMER,
  COMPONENT_CAPS,
  normalizeInput,
  labelForScore,
  setupFromBuildup,
  relativeVolumeBucket,
  scorePriceOi,
  scoreVolume,
  scoreVwap,
  scoreOptions,
  scoreSector,
  scoreFii,
  scoreMomentum,
  detectConflicts,
  computeConfidence,
  classifyTimeframes,
  computeSmartMoneyProxy,
  buildRankings,
  evaluateSmartMoneyAlert,
} = require('./smartMoney');

test('disclaimer always present and proxy language', () => {
  const r = computeSmartMoneyProxy({});
  assert.equal(r.disclaimer, DISCLAIMER);
  assert.match(r.disclaimer, /PROXY/i);
  assert.match(r.disclaimer, /does not identify actual institutional/i);
});

test('score always in -100..100; empty / null instrument safe', () => {
  const r = computeSmartMoneyProxy();
  assert.ok(r.score >= -100 && r.score <= 100);
  assert.ok(r.confidence >= 0 && r.confidence <= 100);
  assert.ok(Array.isArray(r.why));

  const r2 = computeSmartMoneyProxy(null);
  assert.ok(r2.score >= -100 && r2.score <= 100);
  assert.equal(r2.disclaimer, DISCLAIMER);
});

test('price/OI classification — long buildup / short buildup / covering / unwinding', () => {
  assert.equal(scorePriceOi({ priceChangePct: 2, oiChangePct: 5 }).setup, 'LONG BUILDUP');
  assert.equal(scorePriceOi({ priceChangePct: -2, oiChangePct: 5 }).setup, 'SHORT BUILDUP');
  assert.equal(scorePriceOi({ priceChangePct: 2, oiChangePct: -5 }).setup, 'SHORT COVERING');
  assert.equal(scorePriceOi({ priceChangePct: -2, oiChangePct: -5 }).setup, 'LONG UNWINDING');
  assert.equal(setupFromBuildup('LONG_BUILDUP'), 'LONG BUILDUP');
});

test('score normalization respects component caps', () => {
  const poi = scorePriceOi({ priceChangePct: 50, oiChangePct: 80 });
  assert.ok(Math.abs(poi.score) <= COMPONENT_CAPS.priceOi);
  const vol = scoreVolume({ priceChangePct: 3, relativeVolume: 20 });
  assert.ok(Math.abs(vol.score) <= COMPONENT_CAPS.volume);
});

test('relative volume buckets', () => {
  assert.equal(relativeVolumeBucket(0.5).bucket, 'weak');
  assert.equal(relativeVolumeBucket(1.0).bucket, 'normal');
  assert.equal(relativeVolumeBucket(1.5).bucket, 'strong');
  assert.equal(relativeVolumeBucket(2.5).bucket, 'very_strong');
  assert.ok(relativeVolumeBucket(2.5).strength <= 1.35);
});

test('volume confirmation — low volume vs strong', () => {
  const weak = scoreVolume({ priceChangePct: 2, relativeVolume: 0.5 });
  const strong = scoreVolume({ priceChangePct: 2, relativeVolume: 1.8 });
  assert.ok(strong.score > weak.score);
  assert.equal(scoreVolume({}).available, false);
});

test('VWAP confirmation', () => {
  const above = scoreVwap({ ltp: 105, vwap: 100, priceChangePct: 1, vwapSlope: 0.2 });
  const below = scoreVwap({ ltp: 95, vwap: 100, priceChangePct: -1, vwapSlope: -0.2 });
  assert.ok(above.score > 0);
  assert.ok(below.score < 0);
  assert.equal(scoreVwap({}).available, false);
});

test('options positioning / PCR contextual — missing reduces availability', () => {
  const missing = scoreOptions({ priceChangePct: 1 });
  assert.equal(missing.available, false);

  const withPcr = scoreOptions({
    priceChangePct: 1.5,
    pcr: 1.3,
    putOiChange: 5000,
    callOiChange: 1000,
  });
  assert.equal(withPcr.available, true);
  assert.ok(withPcr.score > 0);
});

test('sector confirmation aligns or dampens', () => {
  const aligned = scoreSector({ priceChangePct: 2, sectorChangePct: 1.5, sectorScore: 70 });
  const diverge = scoreSector({ priceChangePct: 2, sectorChangePct: -1.5, sectorScore: 20 });
  assert.ok(aligned.score > diverge.score);
  assert.equal(scoreSector({ priceChangePct: 1 }).available, false);
});

test('FII — not fabricated; index only applied to score', () => {
  const missing = scoreFii({ isIndex: true });
  assert.equal(missing.available, false);

  const stock = scoreFii({ isIndex: false, fiiNetFutures: 8000, fiiNetCash: 1200 });
  assert.equal(stock.score, 0);
  assert.match(stock.reasons[0], /index-level/i);

  const idx = scoreFii({ isIndex: true, fiiNetFutures: 8000, fiiNetCash: 1200 });
  assert.ok(idx.score > 0);
});

test('confidence independent of score magnitude when data missing', () => {
  const strongMissing = computeSmartMoneyProxy({
    priceChangePct: 2.5,
    oiChangePct: 9,
    relativeVolume: 2.2,
    ltp: 100,
    vwap: 98,
  });
  const strongFull = computeSmartMoneyProxy({
    priceChangePct: 2.5,
    oiChangePct: 9,
    relativeVolume: 2.2,
    ltp: 100,
    vwap: 98,
    pcr: 1.25,
    putOiChange: 4000,
    callOiChange: 1000,
    sectorChangePct: 1.4,
    sectorScore: 72,
    isIndex: true,
    fiiNetFutures: 5000,
    fiiNetCash: 800,
    timeframes: { m5: 1, m15: 1, m30: 1, m60: 0.5, daily: 1 },
  });
  assert.ok(strongMissing.score > 40);
  assert.ok(strongFull.confidence > strongMissing.confidence);
});

test('conflict detection reduces confidence', () => {
  const mixed = computeSmartMoneyProxy({
    priceChangePct: 2,
    oiChangePct: 6,
    relativeVolume: 0.5,
    ltp: 95,
    vwap: 100,
    sectorChangePct: -1.8,
    sectorScore: 25,
    pcr: 0.6,
  });
  assert.ok(mixed.conflicting);
  assert.ok(mixed.conflicts.length >= 1);
  assert.ok(mixed.why.some((w) => /CONFLICTING/i.test(w)));
});

test('strong bullish / strong bearish / short covering / long unwinding', () => {
  const bull = computeSmartMoneyProxy({
    priceChangePct: 2.1,
    oiChangePct: 8.4,
    relativeVolume: 2.4,
    ltp: 1680,
    vwap: 1650,
    vwapSlope: 0.3,
    sectorChangePct: 1.6,
    sectorScore: 75,
    pcr: 1.25,
    putOiChange: 8000,
    callOiChange: 2000,
  });
  assert.ok(bull.score > 0);
  assert.equal(bull.setup, 'LONG BUILDUP');
  assert.match(bull.signal, /LONG/);

  const bear = computeSmartMoneyProxy({
    priceChangePct: -2.2,
    oiChangePct: 7.5,
    relativeVolume: 2.1,
    ltp: 1600,
    vwap: 1650,
    vwapSlope: -0.2,
    sectorChangePct: -1.4,
    sectorScore: 25,
    pcr: 0.7,
    callOiChange: 7000,
    putOiChange: 1000,
  });
  assert.ok(bear.score < 0);
  assert.equal(bear.setup, 'SHORT BUILDUP');

  const cover = computeSmartMoneyProxy({ priceChangePct: 1.5, oiChangePct: -5, relativeVolume: 1.4 });
  assert.equal(cover.setup, 'SHORT COVERING');
  assert.ok(cover.score > 0);

  const unwind = computeSmartMoneyProxy({ priceChangePct: -1.5, oiChangePct: -5, relativeVolume: 1.4 });
  assert.equal(unwind.setup, 'LONG UNWINDING');
  assert.ok(unwind.score < 0);
});

test('extreme volume does not fully dominate; low volume weakens', () => {
  const extreme = scoreVolume({ priceChangePct: 1, relativeVolume: 12 });
  const strong = scoreVolume({ priceChangePct: 1, relativeVolume: 1.8 });
  assert.ok(Math.abs(extreme.score) <= COMPONENT_CAPS.volume);
  assert.ok(Math.abs(extreme.score) - Math.abs(strong.score) < 6);
});

test('multi-timeframe scoring', () => {
  const aligned = classifyTimeframes({ m5: 1, m15: 1, m30: 1, m60: 1, daily: 1 });
  assert.match(aligned.overall, /BULLISH/);
  const mixed = classifyTimeframes({ m5: 1, m15: -1, m30: 1, m60: -1, daily: 0 });
  assert.match(mixed.overall, /MIXED|REVERSING/);

  const mom = scoreMomentum({ timeframes: { m5: 1, m15: 1, m30: 1, m60: 1, daily: 1 } });
  assert.ok(mom.score > 0);
  assert.equal(mom.available, true);
});

test('label bands and final score labels', () => {
  assert.equal(labelForScore(87).signal, 'VERY STRONG LONG');
  assert.equal(labelForScore(-87).signal, 'VERY STRONG SHORT');
  assert.equal(labelForScore(0).signal, 'NEUTRAL');
});

test('accepts alternate field names and legacy second-arg extras', () => {
  const r = computeSmartMoneyProxy(
    { pricePct: 1.5, oiPct: 5, rvol: 2, vwapRelation: 'above' },
    { sectorReturnPct: 1.2 }
  );
  assert.ok(r.score > 0);
  assert.equal(r.setup, 'LONG BUILDUP');
  assert.ok(r.components.vwap.available);
});

test('normalizeInput merges extras', () => {
  const n = normalizeInput({ symbol: 'NIFTY', priceChangePct: 1 }, { isIndex: true, fiiNetCash: 100 });
  assert.equal(n.isIndex, true);
  assert.equal(n.fiiNetCash, 100);
});

test('rankings engine', () => {
  const rows = [
    { symbol: 'A', score: 80, confidence: 90, relativeVolume: 2, setup: 'LONG BUILDUP', signal: 'STRONG LONG' },
    { symbol: 'B', score: -70, confidence: 85, relativeVolume: 1.8, setup: 'SHORT BUILDUP', signal: 'STRONG SHORT' },
    { symbol: 'C', score: 40, confidence: 70, relativeVolume: 1.5, setup: 'SHORT COVERING', signal: 'LONG' },
    { symbol: 'D', score: -35, confidence: 60, relativeVolume: 1.3, setup: 'LONG UNWINDING', signal: 'SHORT' },
  ];
  const ranks = buildRankings(rows);
  assert.equal(ranks.topLongs[0].symbol, 'A');
  assert.equal(ranks.topShorts[0].symbol, 'B');
  assert.equal(ranks.topShortCovering[0].symbol, 'C');
  assert.equal(ranks.topLongUnwinding[0].symbol, 'D');
});

test('alert evaluation — crosses, flips, acceleration', () => {
  const prev = { score: 42, confidence: 70, setup: 'LONG BUILDUP' };
  const curr = { score: 78, confidence: 88, setup: 'LONG BUILDUP' };
  const triggers = evaluateSmartMoneyAlert(prev, curr, {
    scoreAbove: 80,
    crossAbove: 60,
    confidenceAbove: 80,
  });
  assert.ok(triggers.some((t) => t.type === 'smart_money_cross_above'));
  assert.ok(triggers.some((t) => t.type === 'score_acceleration'));
  assert.ok(triggers.some((t) => t.type === 'strong_long_buildup'));

  const flip = evaluateSmartMoneyAlert(
    { score: -30, confidence: 60 },
    { score: 35, confidence: 70, setup: 'LONG BUILDUP' },
    {}
  );
  assert.ok(flip.some((t) => t.type === 'signal_flip_bullish'));
});

test('market closed soft-penalizes confidence', () => {
  const open = computeSmartMoneyProxy({ priceChangePct: 1, oiChangePct: 3, relativeVolume: 1.2 });
  const closed = computeSmartMoneyProxy({
    priceChangePct: 1,
    oiChangePct: 3,
    relativeVolume: 1.2,
    marketClosed: true,
  });
  assert.ok(closed.confidence <= open.confidence);
});

test('explanation generated from calculated values', () => {
  const r = computeSmartMoneyProxy({
    symbol: 'HDFCBANK',
    priceChangePct: 2.1,
    oiChangePct: 8.4,
    relativeVolume: 2.4,
    ltp: 100,
    vwap: 98,
  });
  assert.match(r.explanation, /Smart Money Proxy/);
  assert.match(r.explanation, /2\.1/);
  assert.match(r.explanation, /HDFCBANK|LONG BUILDUP|Confidence/i);
  assert.ok(r.bullishFactors.length + r.bearishFactors.length >= 1);
});

test('detectConflicts + computeConfidence helpers', () => {
  const components = {
    priceOi: scorePriceOi({ priceChangePct: 2, oiChangePct: 5 }),
    volume: scoreVolume({ priceChangePct: 2, relativeVolume: 0.4 }),
    vwap: scoreVwap({ ltp: 90, vwap: 100, priceChangePct: 2 }),
    options: scoreOptions({ priceChangePct: 2, pcr: 0.5 }),
    sector: scoreSector({ priceChangePct: 2, sectorChangePct: -2, sectorScore: 20 }),
    fii: scoreFii({}),
    momentum: scoreMomentum({}),
  };
  const conflicts = detectConflicts(components, { priceChangePct: 2, relativeVolume: 0.4 });
  assert.ok(conflicts.length >= 1);
  const conf = computeConfidence(components, conflicts, { relativeVolume: 0.4 });
  assert.ok(conf.confidence < 80);
  assert.ok(conf.missing.includes('fii'));
});
