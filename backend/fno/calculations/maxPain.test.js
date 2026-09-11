'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { computeMaxPain } = require('./maxPain');

test('computeMaxPain finds strike minimizing writer pain', () => {
  // Classic toy chain: puts clustered below, calls above → pain min near middle
  const strikes = [
    { strike: 90, call: { oi: 10 }, put: { oi: 100 } },
    { strike: 100, call: { oi: 50 }, put: { oi: 50 } },
    { strike: 110, call: { oi: 100 }, put: { oi: 10 } },
  ];
  const result = computeMaxPain(strikes);
  assert.ok(result);
  assert.ok(typeof result.maxPain === 'number');
  assert.ok(Array.isArray(result.byStrike));
  assert.equal(result.byStrike.length, 3);

  // Verify pain values manually for K=100
  const pain100 = result.byStrike.find((x) => x.strike === 100).pain;
  // calls: 10*max(0,100-90)+50*0+100*0 = 100
  // puts: 100*max(0,90-100)+50*0+10*max(0,110-100) = 100
  assert.equal(pain100, 200);

  const minPain = Math.min(...result.byStrike.map((x) => x.pain));
  assert.equal(result.byStrike.find((x) => x.strike === result.maxPain).pain, minPain);
});

test('computeMaxPain returns null for empty / no OI', () => {
  assert.equal(computeMaxPain([]), null);
  assert.equal(computeMaxPain(null), null);
  assert.equal(computeMaxPain(undefined), null);
  assert.equal(
    computeMaxPain([
      { strike: 100, call: { oi: 0 }, put: { oi: 0 } },
    ]),
    null
  );
  assert.equal(computeMaxPain([{ strike: 100 }]), null);
});

test('computeMaxPain accepts optional spot without changing classic formula', () => {
  const strikes = [
    { strike: 100, call: { oi: 20 }, put: { oi: 80 } },
    { strike: 110, call: { oi: 80 }, put: { oi: 20 } },
  ];
  const a = computeMaxPain(strikes);
  const b = computeMaxPain(strikes, 105);
  assert.deepEqual(a, b);
});

test('computeMaxPain byStrike sorted ascending', () => {
  const strikes = [
    { strike: 110, call: { oi: 5 }, put: { oi: 1 } },
    { strike: 90, call: { oi: 1 }, put: { oi: 5 } },
    { strike: 100, call: { oi: 3 }, put: { oi: 3 } },
  ];
  const { byStrike } = computeMaxPain(strikes);
  assert.deepEqual(
    byStrike.map((x) => x.strike),
    [90, 100, 110]
  );
});

test('computeMaxPain skips invalid strikes', () => {
  const strikes = [
    { strike: null, call: { oi: 100 }, put: { oi: 100 } },
    { strike: 100, call: { oi: 10 }, put: { oi: 10 } },
  ];
  const result = computeMaxPain(strikes);
  assert.equal(result.maxPain, 100);
  assert.equal(result.byStrike.length, 1);
});
