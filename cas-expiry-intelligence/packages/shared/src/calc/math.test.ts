import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assessAlignment,
  computeBasis,
  computeMaxPain,
  computePcrOi,
  computeSettlementZone,
  computeVwap,
  detectWalls,
  makeTimedValue,
  resolveCasPhase,
  DEFAULT_CAS_MODE,
} from '../index.js';
import type { Candle, OptionStrikeRow } from '../types.js';

describe('marketMath', () => {
  it('computes VWAP from candles', () => {
    const candles: Candle[] = [
      { ts: 1, open: 100, high: 110, low: 90, close: 100, volume: 10 },
      { ts: 2, open: 100, high: 120, low: 100, close: 110, volume: 10 },
    ];
    const vwap = computeVwap(candles);
    assert.ok(vwap != null);
    assert.equal(Math.round(vwap!), 105);
  });

  it('computes basis', () => {
    assert.equal(computeBasis(100, 102), 2);
    assert.equal(computeBasis(null, 102), null);
  });
});

describe('alignment', () => {
  it('flags misalignment when skew exceeds threshold', () => {
    const a = assessAlignment({
      spotTs: '2026-09-12T10:00:00.000Z',
      futuresTs: '2026-09-12T10:00:00.000Z',
      optionTs: '2026-09-12T10:05:00.000Z',
      thresholdMs: 30_000,
    });
    assert.equal(a.aligned, false);
    assert.ok(a.message?.includes('MISALIGNMENT'));
  });

  it('marks unavailable timed values without timestamps', () => {
    const tv = makeTimedValue(100, null, 'DHAN');
    assert.equal(tv.health, 'UNAVAILABLE');
    assert.equal(tv.value, null);
  });
});

describe('optionMath', () => {
  const rows: OptionStrikeRow[] = [
    {
      strike: 100,
      call: { oi: 10, oiChange: 1, volume: 5, iv: 12, ltp: 1, bid: 0.9, ask: 1.1 },
      put: { oi: 50, oiChange: 5, volume: 8, iv: 13, ltp: 2, bid: 1.9, ask: 2.1 },
    },
    {
      strike: 110,
      call: { oi: 80, oiChange: 10, volume: 20, iv: 11, ltp: 0.5, bid: 0.4, ask: 0.6 },
      put: { oi: 20, oiChange: -2, volume: 3, iv: 12, ltp: 5, bid: 4.8, ask: 5.2 },
    },
  ];

  it('computes PCR OI', () => {
    const pcr = computePcrOi(rows);
    assert.ok(pcr != null);
    assert.equal(Math.round(pcr! * 100) / 100, 0.78);
  });

  it('computes max pain', () => {
    assert.equal(computeMaxPain(rows), 110);
  });

  it('detects walls using blended score', () => {
    const walls = detectWalls(rows, 105);
    assert.equal(walls.callWall, 110);
    assert.equal(walls.putWall, 100);
  });
});

describe('settlementZone', () => {
  it('returns unavailable without anchors', () => {
    const z = computeSettlementZone({
      spot: null,
      futures: null,
      basis: null,
      referenceVwap: null,
      maxPain: null,
      callWall: null,
      putWall: null,
      pcrOi: null,
      oiChangePressure: null,
      ivScore: null,
    });
    assert.equal(z.central, null);
    assert.ok(z.unavailableReason);
  });

  it('builds a zone that is not blindly equal to max pain', () => {
    const z = computeSettlementZone({
      spot: 25000,
      futures: 25020,
      basis: 20,
      referenceVwap: 24980,
      maxPain: 25100,
      callWall: 25200,
      putWall: 24800,
      pcrOi: 1.1,
      oiChangePressure: 0.2,
      ivScore: 0.1,
    });
    assert.ok(z.central != null);
    assert.notEqual(z.central, 25100);
    assert.ok((z.lower ?? 0) < (z.central ?? 0));
    assert.ok((z.upper ?? 0) > (z.central ?? 0));
  });
});

describe('casConfig', () => {
  it('resolves a CURRENT_NSE phase', () => {
    const { config, phase } = resolveCasPhase(DEFAULT_CAS_MODE, new Date('2026-09-12T09:00:00+05:30'));
    assert.equal(config.isSimulation, false);
    assert.ok(phase.id);
    assert.equal(typeof phase.lockDirectionalSignals, 'boolean');
  });
});
