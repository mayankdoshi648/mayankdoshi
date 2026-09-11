'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzeOptionChain, daysToExpiry, dteFromExpiry } = require('./optionChainMetrics');

function chain() {
  return [
    {
      strike: 90,
      call: { oi: 100, previousOi: 80, volume: 10, iv: 14, previousIv: 14 },
      put: { oi: 500, previousOi: 400, volume: 20, iv: 16, previousIv: 15 },
    },
    {
      strike: 100,
      call: { oi: 300, previousOi: 250, volume: 50, iv: 12, previousIv: 12 },
      put: { oi: 300, previousOi: 280, volume: 40, iv: 12, previousIv: 11 },
    },
    {
      strike: 110,
      call: { oi: 600, previousOi: 500, volume: 200, iv: 18, previousIv: 14 },
      put: { oi: 80, previousOi: 70, volume: 5, iv: 15, previousIv: 15 },
    },
  ];
}

test('analyzeOptionChain finds ATM nearest to spot', () => {
  const r = analyzeOptionChain({
    spot: 101,
    strikes: chain(),
    expiry: '2026-09-18',
    asOf: '2026-09-11T10:00:00+05:30',
  });
  assert.equal(r.atm.strike, 100);
});

test('highest call/put OI and OI addition', () => {
  const r = analyzeOptionChain({ spot: 100, strikes: chain() });
  assert.equal(r.highestCallOi.strike, 110);
  assert.equal(r.highestCallOi.oi, 600);
  assert.equal(r.highestPutOi.strike, 90);
  assert.equal(r.highestPutOi.oi, 500);
  assert.equal(r.callResistance.strike, 110);
  assert.equal(r.putSupport.strike, 90);
  assert.equal(r.highestCallOiAddition.strike, 110);
  assert.equal(r.highestCallOiAddition.oiAddition, 100);
  assert.equal(r.highestPutOiAddition.strike, 90);
  assert.equal(r.highestPutOiAddition.oiAddition, 100);
  assert.equal(r.highlights.highestCallOi.strike, 110);
  assert.equal(r.metrics.maxPain != null, true);
});

test('unusual volume > 2x median', () => {
  const r = analyzeOptionChain({ spot: 100, strikes: chain() });
  assert.ok(r.unusualVolume.length >= 1);
  assert.ok(r.unusualVolume.some((u) => u.strike === 110 && u.side === 'call'));
});

test('significant IV changes when previousIv available (|Δ| >= 3)', () => {
  const r = analyzeOptionChain({ spot: 100, strikes: chain() });
  assert.ok(r.significantIvChanges.some((c) => c.strike === 110 && c.side === 'call'));
});

test('PCR, max pain, ATM IV, expected move present', () => {
  const r = analyzeOptionChain({
    spot: 100,
    strikes: chain(),
    expiry: '2026-09-25',
    asOf: '2026-09-11T12:00:00+05:30',
  });
  assert.ok(typeof r.pcr === 'number');
  assert.ok(typeof r.metrics.oiPcr === 'number');
  assert.ok(r.maxPain !== null);
  assert.ok(typeof r.atmIv === 'number');
  assert.ok(r.expectedMove);
  assert.ok(r.dteDays >= 0.5);
  assert.ok(r.interpretation.evidence.length > 0);
  assert.ok(r.interpretation.notes.some((n) => /no naked BUY\/SELL/i.test(n)));
});

test('empty / missing inputs handled without fabricating', () => {
  const r = analyzeOptionChain({});
  assert.equal(r.atm, null);
  assert.equal(r.pcr, null);
  assert.equal(r.maxPain, null);
  assert.equal(r.expectedMove, null);
  assert.ok(r.interpretation.evidence.length >= 1);

  const r2 = analyzeOptionChain({ spot: 100, strikes: [] });
  assert.equal(r2.atm, null);
});

test('daysToExpiry / dteFromExpiry use IST with min 0.5', () => {
  assert.equal(daysToExpiry, dteFromExpiry);
  assert.ok(daysToExpiry('2026-09-11', '2026-09-11T15:00:00+05:30') >= 0.5);
  assert.ok(daysToExpiry('2026-09-18', '2026-09-11T10:00:00+05:30') > 5);
  assert.equal(daysToExpiry(null, '2026-09-11'), null);
  assert.equal(daysToExpiry('bad', '2026-09-11'), null);
});

test('uses oiChange when previousOi absent', () => {
  const strikes = [
    {
      strike: 100,
      call: { oi: 200, oiChange: 40, volume: 10, iv: 12 },
      put: { oi: 150, oiChange: 90, volume: 10, iv: 12 },
    },
    {
      strike: 105,
      call: { oi: 100, oiChange: 10, volume: 10, iv: 13 },
      put: { oi: 80, oiChange: 5, volume: 10, iv: 13 },
    },
  ];
  const r = analyzeOptionChain({ spot: 100, strikes });
  assert.equal(r.highestCallOiAddition.oiAddition, 40);
  assert.equal(r.highestPutOiAddition.oiAddition, 90);
});
