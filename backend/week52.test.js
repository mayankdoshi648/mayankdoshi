// backend/week52.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { compute52WeekStats, sliceLastYear } = require('./week52');

test('sliceLastYear keeps last 252 candles', () => {
  const candles = Array.from({ length: 300 }, (_, i) => ({ close: i, high: i, low: i }));
  const sliced = sliceLastYear(candles);
  assert.equal(sliced.length, 252);
  assert.equal(sliced[0].close, 48);
  assert.equal(sliced.at(-1).close, 299);
});

test('compute52WeekStats derives high/low and position', () => {
  const candles = [
    { open: 100, high: 120, low: 90, close: 110 },
    { open: 110, high: 150, low: 105, close: 140 },
    { open: 140, high: 145, low: 80, close: 100 },
  ];
  const stats = compute52WeekStats(candles, 115);
  assert.equal(stats.high52, 150);
  assert.equal(stats.low52, 80);
  assert.equal(stats.pctFromHigh, -23.33);
  assert.equal(stats.pctFromLow, 43.75);
  assert.equal(stats.rangePosition, 50);
  assert.equal(stats.daysInWindow, 3);
});

test('compute52WeekStats returns nulls for empty input', () => {
  const stats = compute52WeekStats([]);
  assert.equal(stats.high52, null);
  assert.equal(stats.low52, null);
  assert.equal(stats.daysInWindow, 0);
});
