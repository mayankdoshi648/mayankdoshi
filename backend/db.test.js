// backend/db.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb, insertSignal, getSignalsByDate, getOpenSignals, updateOutcome } = require('./db');

function freshDb() {
  return openDb(':memory:');
}

test('insertSignal + getSignalsByDate round-trip', () => {
  const db = freshDb();
  insertSignal(db, { symbol: 'RELIANCE', side: 'BUY', price: 2500, score: 2, candleTime: '2026-07-06T09:35:00+05:30', tradeDate: '2026-07-06' });
  const rows = getSignalsByDate(db, '2026-07-06');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].symbol, 'RELIANCE');
  assert.equal(rows[0].outcome, 'OPEN');
  db.close();
});

test('getOpenSignals only returns OPEN rows', () => {
  const db = freshDb();
  const id = insertSignal(db, { symbol: 'TCS', side: 'SELL', price: 3800, score: -2, candleTime: '2026-07-06T10:00:00+05:30', tradeDate: '2026-07-06' });
  insertSignal(db, { symbol: 'INFY', side: 'BUY', price: 1500, score: 2, candleTime: '2026-07-06T10:05:00+05:30', tradeDate: '2026-07-06' });
  updateOutcome(db, id, 'HIT_TARGET');
  const open = getOpenSignals(db, '2026-07-06');
  assert.equal(open.length, 1);
  assert.equal(open[0].symbol, 'INFY');
  db.close();
});

test('getSignalsByDate is scoped to the given date', () => {
  const db = freshDb();
  insertSignal(db, { symbol: 'WIPRO', side: 'BUY', price: 500, score: 2, candleTime: '2026-07-06T09:35:00+05:30', tradeDate: '2026-07-06' });
  insertSignal(db, { symbol: 'WIPRO', side: 'BUY', price: 510, score: 2, candleTime: '2026-07-07T09:35:00+05:30', tradeDate: '2026-07-07' });
  assert.equal(getSignalsByDate(db, '2026-07-06').length, 1);
  assert.equal(getSignalsByDate(db, '2026-07-07').length, 1);
  db.close();
});
