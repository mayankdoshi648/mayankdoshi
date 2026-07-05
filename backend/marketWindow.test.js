// backend/marketWindow.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { isMarketOpen } = require('./marketWindow');

function istToUtc(y, m, d, hh, mm) {
  // IST is UTC+5:30 — build the UTC instant that corresponds to this IST wall time
  return new Date(Date.UTC(y, m - 1, d, hh, mm) - 5.5 * 60 * 60 * 1000);
}

test('open at 9:30 IST on a weekday', () => {
  assert.equal(isMarketOpen(istToUtc(2026, 7, 6, 9, 30)), true); // Monday
});

test('closed at 9:29 IST', () => {
  assert.equal(isMarketOpen(istToUtc(2026, 7, 6, 9, 29)), false);
});

test('open at 15:30 IST (inclusive close)', () => {
  assert.equal(isMarketOpen(istToUtc(2026, 7, 6, 15, 30)), true);
});

test('closed at 15:31 IST', () => {
  assert.equal(isMarketOpen(istToUtc(2026, 7, 6, 15, 31)), false);
});

test('closed on Saturday even during market hours', () => {
  assert.equal(isMarketOpen(istToUtc(2026, 7, 4, 12, 0)), false); // Saturday
});
