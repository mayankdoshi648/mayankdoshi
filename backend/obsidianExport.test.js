const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseDhanHistoricalResponse } = require('./dhanHistorical');
const { exportToObsidian } = require('./obsidianExport');

test('parseDhanHistoricalResponse maps arrays to candles', () => {
  const body = {
    timestamp: [1000, 2000],
    open: [100, 101],
    high: [102, 103],
    low: [99, 100],
    close: [101, 102],
    volume: [1000, 2000],
  };
  const candles = parseDhanHistoricalResponse(body);
  assert.equal(candles.length, 2);
  assert.equal(candles[0].close, 101);
  assert.equal(candles[1].time, 2000000);
});

test('exportToObsidian writes daily and stock notes', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'obsidian-'));
  const scanDate = '2026-08-29';
  const item = {
    symbol: 'RELIANCE',
    market: 'NSE',
    strengthScore: 82,
    tier: 'A',
    stage: 'BREAKOUT',
    close: 2850,
    pctFrom52wHigh: 4.2,
    rvol: 2.1,
    rsPercentile: 88,
    qualifies: true,
    box: { top: 2850, bottom: 2720 },
    levels: { entry: 2850, stops: { primary: 2710, primaryKey: 'box_bottom', box_bottom: 2706, pct_10: 2565, ema: 2780, riskPerShare: 140 } },
    reasonsPass: ['✓ Within 4.2% of 52w high', '✓ Breakout with RVOL 2.1×'],
    reasonsFail: [],
    patterns: { BULL_RESCUE: true },
  };

  const result = exportToObsidian({
    vaultPath: tmp,
    scanDate,
    nseResults: [item],
    usResults: [],
    minScore: 55,
  });

  assert.ok(fs.existsSync(result.dailyPath));
  assert.ok(fs.existsSync(result.nseDailyPath));
  assert.equal(result.exportedCount, 1);
  assert.equal(result.stockPaths.length, 1);

  const daily = fs.readFileSync(result.dailyPath, 'utf8');
  assert.match(daily, /DarvaX Scan — 2026-08-29/);
  assert.match(daily, /RELIANCE/);

  const stock = fs.readFileSync(result.stockPaths[0], 'utf8');
  assert.match(stock, /symbol: RELIANCE/);
  assert.match(stock, /BREAKOUT/);

  fs.rmSync(tmp, { recursive: true, force: true });
});
