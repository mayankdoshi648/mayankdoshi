// backend/signalEngine.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { evaluateSignal, MIN_CANDLES } = require('./signalEngine');

const fixtures = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'test/fixtures/sample-candles.json'), 'utf8')
);

test('returns NEUTRAL during warmup (<21 candles)', () => {
  const result = evaluateSignal(fixtures.neutralCandles.slice(0, MIN_CANDLES - 1));
  assert.equal(result.side, 'NEUTRAL');
});

test('decline-then-rally scenario fires BUY', () => {
  const result = evaluateSignal(fixtures.buyCandles);
  assert.equal(result.side, 'BUY');
  assert.ok(result.score >= 2);
});

test('rally-then-decline scenario fires SELL', () => {
  const result = evaluateSignal(fixtures.sellCandles);
  assert.equal(result.side, 'SELL');
  assert.ok(result.score <= -2);
});

test('flat price scenario stays NEUTRAL', () => {
  const result = evaluateSignal(fixtures.neutralCandles);
  assert.equal(result.side, 'NEUTRAL');
  assert.equal(result.score, 0);
});

test('volume spike on final candle multiplies score by 1.5', () => {
  const result = evaluateSignal(fixtures.volumeSpikeCandles);
  assert.equal(result.side, 'BUY');
  assert.equal(result.score, 3);
});
