'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { computeOiPcr, computeVolumePcr, computePcr } = require('./pcr');

const sample = [
  { strike: 100, call: { oi: 1000, volume: 50 }, put: { oi: 2000, volume: 80 } },
  { strike: 105, call: { oi: 500, volume: 50 }, put: { oi: 1000, volume: 20 } },
];

test('computeOiPcr sums put OI / call OI', () => {
  // (2000+1000)/(1000+500) = 2
  assert.equal(computeOiPcr(sample), 2);
});

test('computeVolumePcr sums put volume / call volume', () => {
  // (80+20)/(50+50) = 1
  assert.equal(computeVolumePcr(sample), 1);
});

test('computePcr is alias for OI PCR', () => {
  assert.equal(computePcr(sample), computeOiPcr(sample));
});

test('returns null when call OI is zero (no divide by zero)', () => {
  const strikes = [
    { strike: 100, call: { oi: 0, volume: 10 }, put: { oi: 500, volume: 5 } },
  ];
  assert.equal(computeOiPcr(strikes), null);
  assert.equal(computePcr(strikes), null);
});

test('returns null when call volume is zero', () => {
  const strikes = [
    { strike: 100, call: { oi: 100, volume: 0 }, put: { oi: 50, volume: 10 } },
  ];
  assert.equal(computeVolumePcr(strikes), null);
});

test('returns null for empty / missing / invalid', () => {
  assert.equal(computeOiPcr([]), null);
  assert.equal(computeOiPcr(null), null);
  assert.equal(computeOiPcr(undefined), null);
  assert.equal(computeVolumePcr([]), null);
  assert.equal(computeOiPcr([{ strike: 100 }]), null);
  assert.equal(computeOiPcr([{ strike: 100, call: {}, put: {} }]), null);
});

test('ignores non-finite OI and still computes from valid legs', () => {
  const strikes = [
    { strike: 100, call: { oi: 100 }, put: { oi: 50 } },
    { strike: 105, call: { oi: null }, put: { oi: NaN } },
  ];
  assert.equal(computeOiPcr(strikes), 0.5);
});
