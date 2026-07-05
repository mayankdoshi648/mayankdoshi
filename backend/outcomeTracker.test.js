const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb, insertSignal, getOpenSignals } = require('./db');
const { evaluateOutcome, checkOpenSignals, closeRemainingOpenSignals } = require('./outcomeTracker');

test('BUY hits target when candle high reaches +0.5%', () => {
  const outcome = evaluateOutcome({ side: 'BUY', price: 100 }, { high: 100.6, low: 99.9 });
  assert.equal(outcome, 'HIT_TARGET');
});

test('BUY hits stoploss when candle low reaches -0.3%', () => {
  const outcome = evaluateOutcome({ side: 'BUY', price: 100 }, { high: 100.1, low: 99.6 });
  assert.equal(outcome, 'HIT_SL');
});

test('BUY stays open when neither threshold is reached', () => {
  const outcome = evaluateOutcome({ side: 'BUY', price: 100 }, { high: 100.2, low: 99.8 });
  assert.equal(outcome, null);
});

test('SELL hits target when candle low drops -0.5%', () => {
  const outcome = evaluateOutcome({ side: 'SELL', price: 100 }, { high: 100.2, low: 99.4 });
  assert.equal(outcome, 'HIT_TARGET');
});

test('SELL hits stoploss when candle high rises +0.3%', () => {
  const outcome = evaluateOutcome({ side: 'SELL', price: 100 }, { high: 100.4, low: 99.8 });
  assert.equal(outcome, 'HIT_SL');
});

test('checkOpenSignals updates matching open signals for a symbol', () => {
  const db = openDb(':memory:');
  const id = insertSignal(db, { symbol: 'TCS', side: 'BUY', price: 100, score: 2, candleTime: 't1', tradeDate: '2026-07-06' });
  insertSignal(db, { symbol: 'INFY', side: 'BUY', price: 100, score: 2, candleTime: 't1', tradeDate: '2026-07-06' });
  checkOpenSignals(db, 'TCS', { high: 100.6, low: 99.9 }, '2026-07-06');
  const open = getOpenSignals(db, '2026-07-06');
  assert.equal(open.length, 1);
  assert.equal(open[0].symbol, 'INFY');
  db.close();
});

test('closeRemainingOpenSignals marks all open rows EOD_CLOSE', () => {
  const db = openDb(':memory:');
  insertSignal(db, { symbol: 'TCS', side: 'BUY', price: 100, score: 2, candleTime: 't1', tradeDate: '2026-07-06' });
  closeRemainingOpenSignals(db, '2026-07-06');
  assert.equal(getOpenSignals(db, '2026-07-06').length, 0);
  db.close();
});
