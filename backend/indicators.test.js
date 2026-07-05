const test = require('node:test');
const assert = require('node:assert/strict');
const { computeEMA, computeRSI, computeSessionVWAP, isVolumeSpike } = require('./indicators');

test('computeEMA returns null before warmup, then EMA values', () => {
  const closes = [10, 11, 12, 13, 14, 15, 16, 17, 18];
  const ema = computeEMA(closes, 3);
  assert.equal(ema[0], null);
  assert.equal(ema[1], null);
  assert.ok(Math.abs(ema[2] - 11) < 1e-9); // SMA seed of first 3
  assert.ok(ema[8] > ema[2]); // trending up
});

test('computeRSI treats flat prices as neutral (50), not 100', () => {
  const closes = new Array(20).fill(100);
  const rsi = computeRSI(closes, 14);
  assert.equal(rsi[13], null);
  assert.equal(rsi[14], 50);
});

test('computeRSI is high after a steady rally', () => {
  const closes = Array.from({ length: 20 }, (_, i) => 100 + i);
  const rsi = computeRSI(closes, 14);
  assert.ok(rsi[19] > 70);
});

test('computeSessionVWAP accumulates across the session', () => {
  const candles = [
    { high: 101, low: 99, close: 100, volume: 100 },
    { high: 103, low: 101, close: 102, volume: 300 },
  ];
  const vwap = computeSessionVWAP(candles);
  assert.ok(Math.abs(vwap[0] - 100) < 1e-9);
  assert.ok(vwap[1] > 100 && vwap[1] < 102);
});

test('isVolumeSpike detects >1.5x rolling average', () => {
  const volumes = new Array(20).fill(1000).concat([2000]);
  assert.equal(isVolumeSpike(volumes, 20, 20, 1.5), true);
  assert.equal(isVolumeSpike(volumes, 20, 20, 3), false);
});

test('isVolumeSpike is false before enough history', () => {
  const volumes = new Array(5).fill(1000);
  assert.equal(isVolumeSpike(volumes, 4, 20, 1.5), false);
});
