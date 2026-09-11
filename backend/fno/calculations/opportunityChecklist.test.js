'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  evaluateOpportunity,
  buildOpportunityUniverse,
  filterOpportunityRows,
  WEIGHTS,
} = require('./opportunityChecklist');

function baseRow(over = {}) {
  return {
    symbol: 'HDFCBANK',
    sector: 'BANKING',
    ltp: 1985,
    priceChangePct: 2.1,
    oiChangePct: 8.4,
    relativeVolume: 2.4,
    vwap: 1960,
    vwapRelation: 'above',
    volume: 1200000,
    high: 1995,
    low: 1940,
    open: 1950,
    prevClose: 1944,
    pcr: 1.15,
    iv: 18,
    ivChangePct: 2,
    buildup: 'LONG_BUILDUP',
    smartMoney: {
      score: 87,
      confidence: 91,
      setup: 'LONG BUILDUP',
      buildup: 'LONG_BUILDUP',
      signal: 'STRONG LONG',
      components: {
        priceOi: { score: 27, max: 30, available: true },
        volume: { score: 14, max: 15, available: true },
        vwap: { score: 14, max: 15, available: true },
        options: { score: 12, max: 15, available: true },
        sector: { score: 9, max: 10, available: true },
        fii: { score: 0, max: 10, available: false },
        momentum: { score: 5, max: 5, available: true },
      },
      timeframes: { labels: { '5M': 'N/A', '15M': 'N/A', '30M': 'N/A', '60M': 'N/A', DAILY: 'N/A' }, overall: 'N/A' },
    },
    ...over,
  };
}

describe('opportunity checklist engine', () => {
  it('weights sum to 100', () => {
    const sum = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
    assert.equal(sum, 100);
  });

  it('scores a strong long buildup without fabricating missing MTF', () => {
    const r = evaluateOpportunity(baseRow(), {
      regime: { label: 'BULLISH', score: 68, confidence: 70 },
      indices: { NIFTY: { changePct: 0.6 }, BANKNIFTY: { changePct: 0.8 }, INDIAVIX: { ltp: 13.2 } },
      sectorStats: { sector: 'BANKING', returnPct: 1.8, rank: 2, score: 72, advanceDecline: 2.1 },
      fii: { cash: { fiiNet: 1200 }, positioningRegime: { label: 'BULLISH' } },
    });
    assert.equal(r.symbol, 'HDFCBANK');
    assert.ok(r.opportunityScore >= 70);
    assert.ok(r.confidence >= 55);
    assert.ok(['A+', 'A', 'B'].includes(r.grade));
    assert.equal(r.direction, 'BULLISH');
    assert.match(r.disclaimer, /NOT a guarantee/i);
    assert.ok(r.checks.some((c) => c.status === 'UNAVAILABLE' && /timeframe|MTF|15M|EMA|ATR|Opening/i.test(c.label + c.note)));
    assert.ok(r.waitFor);
    assert.ok(r.invalidation?.items?.length);
    assert.ok(r.why);
  });

  it('does not award A+ when highly extended / conflicting', () => {
    const r = evaluateOpportunity(baseRow({
      priceChangePct: 4.8,
      relativeVolume: 0.9,
      vwapRelation: 'above',
      high: 1990,
      ltp: 1988,
      smartMoney: {
        ...baseRow().smartMoney,
        score: 40,
        confidence: 50,
      },
    }), {
      regime: { label: 'BEARISH', score: 30, confidence: 60 },
      sectorStats: { returnPct: -1.5, rank: 18, score: 30, advanceDecline: 0.4 },
    });
    assert.notEqual(r.grade, 'A+');
    assert.ok(r.conflict.level === 'MEDIUM' || r.conflict.level === 'HIGH' || r.opportunityScore < 85);
  });

  it('marks missing data as UNAVAILABLE and lowers confidence path', () => {
    const r = evaluateOpportunity({
      symbol: 'XYZ',
      buildup: 'NEUTRAL',
      smartMoney: { score: 0, confidence: 20, setup: 'MIXED', components: {}, timeframes: { labels: {} } },
    }, {});
    assert.ok(r.checks.filter((c) => c.status === 'UNAVAILABLE').length >= 5);
    assert.ok(r.opportunityScore <= 60);
  });

  it('builds universe rankings and filters', () => {
    const rows = [
      baseRow(),
      baseRow({ symbol: 'TCS', priceChangePct: -2, oiChangePct: 5, buildup: 'SHORT_BUILDUP', vwapRelation: 'below', relativeVolume: 1.8,
        smartMoney: { ...baseRow().smartMoney, score: -70, setup: 'SHORT BUILDUP', buildup: 'SHORT_BUILDUP' } }),
      baseRow({ symbol: 'INFY', priceChangePct: 1, oiChangePct: -3, buildup: 'SHORT_COVERING', relativeVolume: 1.1,
        smartMoney: { ...baseRow().smartMoney, score: 45, setup: 'SHORT COVERING', buildup: 'SHORT_COVERING', confidence: 55 } }),
    ];
    const uni = buildOpportunityUniverse(rows, {
      regime: { score: 60, confidence: 60, label: 'BULLISH' },
      sectorsByName: new Map([['BANKING', { returnPct: 1, score: 60, rank: 3 }]]),
    });
    assert.ok(uni.rows.length === 3);
    assert.ok(uni.rankings.topBullish);
    assert.ok(uni.heatmap.length === 3);
    const filtered = filterOpportunityRows(uni.rows, { filter: 'BULLISH', sort: 'opportunityScore' });
    assert.ok(filtered.every((r) => r.direction === 'BULLISH'));
  });

  it('wait-for provides measurable triggers for incomplete bullish setup', () => {
    const r = evaluateOpportunity(baseRow({ relativeVolume: 1.05, vwapRelation: 'below' }), {
      regime: { score: 55, confidence: 55, label: 'NEUTRAL' },
      sectorStats: { returnPct: 0.2, score: 50, rank: 8 },
    });
    assert.ok(r.waitFor.triggers.length >= 1);
    assert.ok(r.waitFor.triggers.some((t) => /1\.50x|VWAP|RVOL|volume/i.test(`${t.label} ${t.required}`)));
    assert.ok(r.waitFor.scenario.potentialScore >= r.opportunityScore);
  });
});
