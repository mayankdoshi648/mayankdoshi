// backend/stockDashboard.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createStockDashboard,
  sortRanked,
  filterSector,
  buildDemoRows,
} = require('./stockDashboard');
const { createTokenManager } = require('./dhanToken');

const sample = [
  { symbol: 'A', sector: 'IT', sectorShort: 'IT', changePct: 2, pctFromHigh: -1, pctFromLow: 40, volume: 100 },
  { symbol: 'B', sector: 'Banks', sectorShort: 'Banks', changePct: -3, pctFromHigh: -20, pctFromLow: 5, volume: 500 },
  { symbol: 'C', sector: 'IT', sectorShort: 'IT', changePct: 1, pctFromHigh: -0.5, pctFromLow: 60, volume: 50 },
];

test('sortRanked gainers and losers', () => {
  assert.deepEqual(sortRanked(sample, 'gainers').map((r) => r.symbol), ['A', 'C', 'B']);
  assert.deepEqual(sortRanked(sample, 'losers').map((r) => r.symbol), ['B', 'C', 'A']);
});

test('sortRanked near 52w extremes and volume', () => {
  assert.equal(sortRanked(sample, 'near52wHigh')[0].symbol, 'C');
  assert.equal(sortRanked(sample, 'near52wLow')[0].symbol, 'B');
  assert.equal(sortRanked(sample, 'volume')[0].symbol, 'B');
});

test('filterSector matches short or full name', () => {
  assert.equal(filterSector(sample, 'IT').length, 2);
  assert.equal(filterSector(sample, 'all').length, 3);
});

test('demo dashboard returns ranked filtered rows', async () => {
  const tokenManager = createTokenManager({ config: {} });
  const dash = createStockDashboard({
    tokenManager,
    config: {},
    demoMode: true,
    fetchImpl: async () => {
      throw new Error('network blocked in unit test');
    },
  });

  const report = await dash.getDashboard({
    universe: 'nifty50',
    ranking: 'gainers',
    limit: 10,
  });
  assert.equal(report.mode, 'demo');
  assert.ok(report.rows.length > 0);
  assert.ok(report.rows[0].high52 != null);
  assert.ok(report.rows[0].low52 != null);
  assert.ok(report.sectors.length > 0);

  const sector = report.rows[0].sector;
  const filtered = await dash.getDashboard({
    universe: 'nifty50',
    sector,
    ranking: 'all',
    limit: 50,
  });
  assert.ok(filtered.rows.every((r) => r.sector === sector));
});

test('buildDemoRows is deterministic per symbol', () => {
  const instruments = [
    { symbol: 'RELIANCE', name: 'Reliance', sector: 'Oil Gas & Consumable Fuels', securityId: '1' },
  ];
  const a = buildDemoRows(instruments)[0];
  const b = buildDemoRows(instruments)[0];
  assert.equal(a.ltp, b.ltp);
  assert.equal(a.high52, b.high52);
});
