'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  computeExpectedMove,
  compareIvRealized,
  straddleImpliedRange,
} = require('./expectedMove');

test('computeExpectedMove uses spot * (iv/100) * sqrt(dte/365)', () => {
  const spot = 20000;
  const atmIv = 12.5;
  const dteDays = 7;
  const expected = spot * (atmIv / 100) * Math.sqrt(dteDays / 365);
  const result = computeExpectedMove({ spot, atmIv, dteDays });
  assert.ok(result);
  assert.ok(Math.abs(result.move - expected) < 1e-9);
  assert.ok(Math.abs(result.upper1sd - (spot + expected)) < 1e-9);
  assert.ok(Math.abs(result.lower1sd - (spot - expected)) < 1e-9);
  assert.ok(Math.abs(result.upper2sd - (spot + 2 * expected)) < 1e-9);
  assert.ok(Math.abs(result.lower2sd - (spot - 2 * expected)) < 1e-9);
  assert.equal(result.expectedUpper, result.upper1sd);
  assert.equal(result.expectedLower, result.lower1sd);
});

test('computeExpectedMove returns null for invalid inputs', () => {
  assert.equal(computeExpectedMove({}), null);
  assert.equal(computeExpectedMove({ spot: 100, atmIv: 10 }), null);
  assert.equal(computeExpectedMove({ spot: 0, atmIv: 10, dteDays: 5 }), null);
  assert.equal(computeExpectedMove({ spot: -1, atmIv: 10, dteDays: 5 }), null);
  assert.equal(computeExpectedMove({ spot: 100, atmIv: -5, dteDays: 5 }), null);
  assert.equal(computeExpectedMove({ spot: 100, atmIv: 10, dteDays: -1 }), null);
  assert.equal(computeExpectedMove({ spot: null, atmIv: 10, dteDays: 5 }), null);
});

test('computeExpectedMove allows dteDays 0 → move 0', () => {
  const result = computeExpectedMove({ spot: 100, atmIv: 20, dteDays: 0 });
  assert.ok(result);
  assert.equal(result.move, 0);
  assert.equal(result.upper1sd, 100);
  assert.equal(result.lower1sd, 100);
});

test('compareIvRealized IV_RICH / IV_CHEAP / NEUTRAL (|spread| >= 3)', () => {
  assert.equal(compareIvRealized({ atmIv: 18, realizedVol: 12 }).regime, 'IV_RICH');
  assert.equal(compareIvRealized({ atmIv: 10, realizedVol: 15 }).regime, 'IV_CHEAP');
  assert.equal(compareIvRealized({ atmIv: 12, realizedVol: 11 }).regime, 'NEUTRAL');
  assert.equal(compareIvRealized({ atmIv: 15, realizedVol: 12 }).spread, 3);
  assert.equal(compareIvRealized({ atmIv: 15, realizedVol: 12 }).regime, 'IV_RICH');
  assert.equal(compareIvRealized({ atmIv: 14.9, realizedVol: 12 }).regime, 'NEUTRAL');
});

test('compareIvRealized null regime when missing', () => {
  const r = compareIvRealized({});
  assert.equal(r.regime, null);
  assert.equal(r.spread, null);
  assert.equal(compareIvRealized({ atmIv: 10 }).regime, null);
  assert.equal(compareIvRealized({ realizedVol: 10 }).regime, null);
});

test('straddleImpliedRange returns upper/lower around spot', () => {
  const r = straddleImpliedRange({ straddlePrice: 150, spot: 20000 });
  assert.deepEqual(r, { range: 150, upper: 20150, lower: 19850 });
});

test('straddleImpliedRange null on invalid', () => {
  assert.equal(straddleImpliedRange({}), null);
  assert.equal(straddleImpliedRange({ straddlePrice: 10, spot: 0 }), null);
  assert.equal(straddleImpliedRange({ straddlePrice: -1, spot: 100 }), null);
  assert.equal(straddleImpliedRange({ straddlePrice: null, spot: 100 }), null);
});
