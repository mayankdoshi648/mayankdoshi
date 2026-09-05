const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  breadthSeries,
  aboveSmaByDate,
  breadthSeriesFromMaps,
  detectTrend,
  diagnosePosture,
  arrowForTrend,
  buildBreadthReport,
  isCacheFresh,
} = require('./marketBreadth');
const { computeSMA } = require('./indicators');

describe('marketBreadth', () => {
  it('computeSMA matches simple average window', () => {
    const closes = [1, 2, 3, 4, 5, 6];
    const sma3 = computeSMA(closes, 3);
    assert.equal(sma3[2], 2);
    assert.equal(sma3[3], 3);
    assert.equal(sma3[5], 5);
  });

  it('breadthSeries counts % above SMA', () => {
    // 2 stocks, period 2: after warm-up, both above or mixed
    const matrix = new Map([
      ['A', [10, 11, 12, 13, 14]],
      ['B', [10, 9, 8, 7, 6]],
    ]);
    const series = breadthSeries(matrix, 2);
    // index 1: A 11>10.5 above, B 9<9.5 below → 50%
    assert.equal(series[1], 50);
    // index 4: A above, B below → 50%
    assert.equal(series[4], 50);
  });

  it('aboveSmaByDate uses continuous stock history', () => {
    const candles = [];
    const start = Date.UTC(2024, 0, 1);
    for (let i = 0; i < 25; i++) {
      candles.push({ time: start + i * 86400000, close: 100 + i });
    }
    const map = aboveSmaByDate(candles, 20);
    assert.ok(map.size >= 5);
    const lastDate = new Date(start + 24 * 86400000).toISOString().slice(0, 10);
    assert.equal(map.get(lastDate), true);
  });

  it('breadthSeriesFromMaps aggregates across stocks', () => {
    const dates = ['2024-01-01', '2024-01-02'];
    const maps = [
      new Map([['2024-01-01', true], ['2024-01-02', false]]),
      new Map([['2024-01-01', true], ['2024-01-02', true]]),
    ];
    const series = breadthSeriesFromMaps(dates, maps);
    assert.equal(series[0], 100);
    assert.equal(series[1], 50);
  });

  it('detectTrend classifies down/up/flat', () => {
    assert.equal(detectTrend([60, 58, 55, 52, 50, 48], 5, 2), 'down');
    assert.equal(detectTrend([40, 42, 45, 48, 50, 55], 5, 2), 'up');
    assert.equal(detectTrend([50, 50.5, 49.8, 50.2, 50.1, 50], 5, 2), 'flat');
  });

  it('diagnosePosture: all three falling → SIT OUT', () => {
    const r = diagnosePosture({
      dma20: 45, dma50: 40, dma200: 55,
      trend20: 'down', trend50: 'down', trend200: 'down',
    });
    assert.equal(r.code, 'SIT_OUT');
    assert.equal(r.tone, 'danger');
  });

  it('diagnosePosture: only 20 falling → STOP PRESSING', () => {
    const r = diagnosePosture({
      dma20: 48, dma50: 60, dma200: 62,
      trend20: 'down', trend50: 'flat', trend200: 'flat',
    });
    assert.equal(r.code, 'STOP_PRESSING');
    assert.equal(r.tone, 'warn');
  });

  it('diagnosePosture: 50+200 falling → REDUCE RISK', () => {
    const r = diagnosePosture({
      dma20: 55, dma50: 48, dma200: 52,
      trend20: 'flat', trend50: 'down', trend200: 'down',
    });
    assert.equal(r.code, 'REDUCE_RISK');
  });

  it('diagnosePosture: all above 50% → GREEN LIGHT', () => {
    const r = diagnosePosture({
      dma20: 62, dma50: 58, dma200: 55,
      trend20: 'up', trend50: 'up', trend200: 'flat',
    });
    assert.equal(r.code, 'GREEN_LIGHT');
    assert.equal(r.tone, 'good');
  });

  it('arrowForTrend maps correctly', () => {
    assert.equal(arrowForTrend('down'), '↓');
    assert.equal(arrowForTrend('up'), '↑');
    assert.equal(arrowForTrend('flat'), '→');
  });

  it('buildBreadthReport produces gauges and diagnosis', () => {
    const dates = [];
    const indexCloses = [];
    const start = Date.UTC(2023, 0, 1);
    for (let i = 0; i < 220; i++) {
      dates.push(new Date(start + i * 86400000).toISOString().slice(0, 10));
      indexCloses.push(20000 + i * 10);
    }
    const candlesBySymbol = new Map();
    for (const sym of ['AAA', 'BBB', 'CCC']) {
      const candles = dates.map((d, i) => ({
        time: Date.parse(d),
        close: sym === 'CCC' ? 100 - i * 0.1 : 100 + i * 0.2,
      }));
      candlesBySymbol.set(sym, candles);
    }
    const report = buildBreadthReport({
      dates,
      indexCloses,
      candlesBySymbol,
      universe: 'nifty50',
      dataSource: 'test',
      errors: 0,
      scannedAt: '2024-01-01T00:00:00.000Z',
    });
    assert.equal(report.stockCount, 3);
    assert.ok(report.gauges.dma20.value != null);
    assert.ok(report.gauges.dma50.value != null);
    assert.ok(report.gauges.dma200.value != null);
    assert.ok(report.diagnosis.code);
    assert.ok(report.series.dates.length > 0);
    assert.equal(report.series.index.length, report.series.dates.length);
  });

  it('isCacheFresh respects universe and ttl', () => {
    const cache = { universe: 'nifty50', scannedAt: new Date().toISOString() };
    assert.equal(isCacheFresh(cache, 'nifty50', 60_000), true);
    assert.equal(isCacheFresh(cache, 'nifty500', 60_000), false);
    assert.equal(isCacheFresh({ ...cache, scannedAt: '2020-01-01T00:00:00.000Z' }, 'nifty50', 1000), false);
  });
});
