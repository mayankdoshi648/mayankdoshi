'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { classifyBuildup, computeBuildupScore, WEIGHTS } = require('./oiBuildup');
const { computeOiPcr, computeVolumePcr } = require('./pcr');
const { computeMaxPain } = require('./maxPain');
const { computeExpectedMove, compareIvRealized, straddleImpliedRange } = require('./expectedMove');
const { computeMarketRegime, labelFromScore } = require('./marketRegime');
const { computeSmartMoneyProxy, DISCLAIMER } = require('./smartMoney');
const { computeSectorStrength, rankSectors } = require('./sectorStrength');
const { analyzeOptionChain, daysToExpiry } = require('./optionChainMetrics');

describe('oiBuildup', () => {
  it('classifies four quadrants', () => {
    assert.equal(classifyBuildup({ priceChangePct: 1, oiChangePct: 2 }), 'LONG_BUILDUP');
    assert.equal(classifyBuildup({ priceChangePct: -1, oiChangePct: 2 }), 'SHORT_BUILDUP');
    assert.equal(classifyBuildup({ priceChangePct: 1, oiChangePct: -2 }), 'SHORT_COVERING');
    assert.equal(classifyBuildup({ priceChangePct: -1, oiChangePct: -2 }), 'LONG_UNWINDING');
  });
  it('neutral on missing or tiny moves', () => {
    assert.equal(classifyBuildup({}), 'NEUTRAL');
    assert.equal(classifyBuildup({ priceChangePct: 0.01, oiChangePct: 5 }), 'NEUTRAL');
  });
  it('scores within -100..100 and exports weights', () => {
    const s = computeBuildupScore({
      priceChangePct: 2,
      oiChangePct: 8,
      relativeVolume: 2.5,
      vwapRelation: 'above',
    });
    assert.ok(s >= -100 && s <= 100);
    assert.ok(WEIGHTS.priceChangePct);
  });
});

describe('pcr', () => {
  const strikes = [
    { strike: 100, call: { oi: 100, volume: 10 }, put: { oi: 200, volume: 30 } },
    { strike: 110, call: { oi: 50, volume: 10 }, put: { oi: 50, volume: 10 } },
  ];
  it('computes OI and volume PCR', () => {
    assert.equal(computeOiPcr(strikes), 250 / 150);
    assert.equal(computeVolumePcr(strikes), 40 / 20);
  });
  it('returns null on zero call OI', () => {
    assert.equal(computeOiPcr([{ strike: 1, call: { oi: 0 }, put: { oi: 10 } }]), null);
  });
});

describe('maxPain', () => {
  it('finds minimizing strike', () => {
    const strikes = [
      { strike: 100, call: { oi: 10 }, put: { oi: 0 } },
      { strike: 110, call: { oi: 0 }, put: { oi: 10 } },
      { strike: 105, call: { oi: 5 }, put: { oi: 5 } },
    ];
    const r = computeMaxPain(strikes);
    assert.ok(r.maxPain);
    assert.ok(r.byStrike.length === 3);
  });
  it('null on empty', () => {
    assert.equal(computeMaxPain([]), null);
  });
});

describe('expectedMove', () => {
  it('matches formula', () => {
    const r = computeExpectedMove({ spot: 100, atmIv: 20, dteDays: 365 });
    assert.ok(Math.abs(r.move - 20) < 1e-9);
    assert.equal(r.upper1sd, 120);
    assert.equal(r.lower2sd, 60);
  });
  it('null on bad inputs', () => {
    assert.equal(computeExpectedMove({ spot: 100, atmIv: 20 }), null);
  });
  it('compares IV vs realized', () => {
    assert.equal(compareIvRealized({ atmIv: 20, realizedVol: 10 }).regime, 'IV_RICH');
    assert.equal(compareIvRealized({ atmIv: 10, realizedVol: 20 }).regime, 'IV_CHEAP');
  });
  it('straddle range', () => {
    assert.deepEqual(straddleImpliedRange({ straddlePrice: 200, spot: 24500 }), {
      range: 200,
      upper: 24700,
      lower: 24300,
    });
  });
});

describe('marketRegime', () => {
  it('labels scores', () => {
    assert.equal(labelFromScore(80), 'STRONG_BULLISH');
    assert.equal(labelFromScore(10), 'STRONG_BEARISH');
  });
  it('skips missing factors and lowers confidence', () => {
    const sparse = computeMarketRegime({ priceVsVwap: 'above' });
    const full = computeMarketRegime({
      priceVsVwap: 'above',
      priceVsEma20: 'above',
      priceVsEma50: 'above',
      breadthPctAbove50: 70,
      advanceDeclineRatio: 1.5,
      fiiNetFutures: 1000,
      pcr: 1.2,
      oiBuildupBias: 0.5,
      indiaVix: 13,
      momentumScore: 40,
    });
    assert.ok(sparse.confidence < full.confidence);
    assert.ok(full.score >= 60);
    assert.equal(full.factors.length, 10);
  });
});

describe('smartMoney', () => {
  it('includes proxy disclaimer and signals', () => {
    const r = computeSmartMoneyProxy({
      symbol: 'HDFCBANK',
      priceChangePct: 2.1,
      oiChangePct: 8.4,
      relativeVolume: 2.3,
      vwapRelation: 'above',
      sectorReturnPct: 1.4,
    });
    assert.equal(r.disclaimer, DISCLAIMER);
    assert.ok(
      r.setup === 'LONG BUILDUP' ||
        r.signals.includes('LONG_BUILDUP') ||
        /LONG/i.test(r.signal)
    );
    assert.ok(r.why.some((w) => /Price/i.test(w)));
    assert.ok(r.confidence >= 0 && r.confidence <= 100);
  });
});

describe('sectorStrength', () => {
  it('ranks by score', () => {
    const ranked = rankSectors([
      { sector: 'IT', returnPct: -1, longBuildupCount: 0, shortBuildupCount: 3 },
      { sector: 'BANKING', returnPct: 2, longBuildupCount: 5, shortBuildupCount: 1, relativeVolume: 1.5 },
    ]);
    assert.equal(ranked[0].rank, 1);
    assert.equal(ranked[0].sector, 'BANKING');
  });
  it('default mid score when empty', () => {
    assert.equal(computeSectorStrength({}), 50);
  });
});

describe('optionChainMetrics', () => {
  it('identifies ATM, PCR, max pain, expected move', () => {
    const strikes = [];
    for (let k = 24400; k <= 24600; k += 50) {
      strikes.push({
        strike: k,
        call: { oi: k === 24600 ? 9000 : 1000, previousOi: 800, volume: 100, iv: 12, ltp: 100 },
        put: { oi: k === 24400 ? 8000 : 1000, previousOi: 900, volume: 120, iv: 13, ltp: 90 },
      });
    }
    const r = analyzeOptionChain({
      spot: 24510,
      strikes,
      expiry: '2026-09-17',
      asOf: '2026-09-11T10:00:00+05:30',
    });
    assert.equal(r.atm.strike, 24500);
    assert.ok(r.metrics.oiPcr > 0);
    assert.equal(r.highlights.highestCallOi.strike, 24600);
    assert.equal(r.highlights.highestPutOi.strike, 24400);
    assert.ok(r.expectedMove.move > 0);
    assert.ok(r.interpretation.evidence.length > 0);
    assert.ok(daysToExpiry('2026-09-17', '2026-09-11') > 5);
  });
});
