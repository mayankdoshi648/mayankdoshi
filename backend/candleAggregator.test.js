const test = require('node:test');
const assert = require('node:assert/strict');
const { CandleAggregator, BUCKET_MS } = require('./candleAggregator');

test('first tick in a bucket opens a candle and returns null', () => {
  const agg = new CandleAggregator();
  const closed = agg.onTick({ symbol: 'TCS', ltp: 100, ltq: 10, timestamp: 0 });
  assert.equal(closed, null);
  assert.equal(agg.getCandles('TCS').length, 0);
});

test('ticks in the same bucket update high/low/close/volume', () => {
  const agg = new CandleAggregator();
  agg.onTick({ symbol: 'TCS', ltp: 100, ltq: 10, timestamp: 0 });
  agg.onTick({ symbol: 'TCS', ltp: 105, ltq: 5, timestamp: 60 * 1000 });
  agg.onTick({ symbol: 'TCS', ltp: 98, ltq: 5, timestamp: 2 * 60 * 1000 });
  const closed = agg.onTick({ symbol: 'TCS', ltp: 102, ltq: 20, timestamp: BUCKET_MS });
  assert.ok(closed);
  assert.equal(closed.open, 100);
  assert.equal(closed.high, 105);
  assert.equal(closed.low, 98);
  assert.equal(closed.close, 102 === 102 ? 98 : 98); // close of the FIRST bucket must be its last tick before rollover
});

test('a tick in a new bucket closes the previous candle correctly', () => {
  const agg = new CandleAggregator();
  agg.onTick({ symbol: 'TCS', ltp: 100, ltq: 10, timestamp: 0 });
  agg.onTick({ symbol: 'TCS', ltp: 103, ltq: 10, timestamp: 60 * 1000 });
  const closed = agg.onTick({ symbol: 'TCS', ltp: 110, ltq: 1, timestamp: BUCKET_MS + 1000 });
  assert.equal(closed.open, 100);
  assert.equal(closed.close, 103);
  assert.equal(closed.volume, 20);
  assert.equal(agg.getCandles('TCS').length, 1);
});

test('symbols are tracked independently', () => {
  const agg = new CandleAggregator();
  agg.onTick({ symbol: 'TCS', ltp: 100, ltq: 10, timestamp: 0 });
  agg.onTick({ symbol: 'INFY', ltp: 200, ltq: 10, timestamp: 0 });
  agg.onTick({ symbol: 'TCS', ltp: 101, ltq: 10, timestamp: BUCKET_MS });
  assert.equal(agg.getCandles('TCS').length, 1);
  assert.equal(agg.getCandles('INFY').length, 0);
});

test('reset clears all state', () => {
  const agg = new CandleAggregator();
  agg.onTick({ symbol: 'TCS', ltp: 100, ltq: 10, timestamp: 0 });
  agg.onTick({ symbol: 'TCS', ltp: 101, ltq: 10, timestamp: BUCKET_MS });
  agg.reset();
  assert.equal(agg.getCandles('TCS').length, 0);
});
