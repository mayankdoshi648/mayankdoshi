import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  computeCasIntelligence,
  computeCasRisk,
  computeMarketState,
  computeSignalScore,
} from './analyticsEngines.js';

describe('computeMarketState', () => {
  it('returns NO EDGE when inputs are sparse', () => {
    const r = computeMarketState({
      spot: null,
      vwap: null,
      referenceVwap: null,
      basis: null,
      basisExpanding: null,
      momentum: null,
      callWall: null,
      putWall: null,
      ivHigh: null,
    });
    assert.equal(r.state, 'NO EDGE');
    assert.ok(r.confidence < 50);
  });

  it('leans TREND UP when price is above VWAP with positive momentum', () => {
    const r = computeMarketState({
      spot: 25050,
      vwap: 24900,
      referenceVwap: 24920,
      basis: 25,
      basisExpanding: true,
      momentum: 0.8,
      callWall: 25200,
      putWall: 24800,
      ivHigh: false,
    });
    assert.ok(['TREND UP', 'BREAKOUT RISK'].includes(r.state));
    assert.ok(r.confidence > 50);
  });
});

describe('computeCasIntelligence', () => {
  it('stays near neutral when spot sits between balanced magnets', () => {
    const r = computeCasIntelligence({
      spot: 25000,
      referenceVwap: 25000,
      maxPain: 25000,
      callWall: 25100,
      putWall: 24900,
      basis: 5,
      pcrOi: 1,
      oiMagnetScore: 0,
      lockedDirectional: false,
    });
    assert.ok(Math.abs(r.score) <= 2);
    assert.ok(r.confidence > 0);
  });

  it('scores upward when magnets sit above spot', () => {
    const r = computeCasIntelligence({
      spot: 24900,
      referenceVwap: 25050,
      maxPain: 25050,
      callWall: 25200,
      putWall: 25000,
      basis: 40,
      pcrOi: 1.3,
      oiMagnetScore: 0.7,
      lockedDirectional: true,
    });
    assert.ok(r.score > 0);
    assert.equal(r.lockedDirectional, true);
  });
});

describe('computeSignalScore', () => {
  it('locks during CAS', () => {
    const r = computeSignalScore({
      locked: true,
      lockReason: 'test lock',
      spot: 25000,
      vwap: 24950,
      referenceVwap: 24980,
      basis: 10,
      basisWeakening: false,
      momentum: 0.2,
      callWall: 25100,
      putWall: 24900,
      oiChangePressure: 0.1,
      pcrOi: 1.1,
    });
    assert.equal(r.locked, true);
    assert.equal(r.score, null);
  });

  it('produces a directional score when unlocked', () => {
    const r = computeSignalScore({
      locked: false,
      spot: 25100,
      vwap: 24950,
      referenceVwap: 24980,
      basis: 30,
      basisWeakening: false,
      momentum: 0.6,
      callWall: 25200,
      putWall: 24800,
      oiChangePressure: 0.2,
      pcrOi: 1.2,
    });
    assert.equal(r.locked, false);
    assert.ok(r.score != null && r.score > 0);
  });
});

describe('computeCasRisk', () => {
  it('escalates on expiry + divergence + mismatch', () => {
    const r = computeCasRisk({
      isExpiryDay: true,
      iv: 28,
      spotFuturesDivergencePct: 0.9,
      distanceFromRefPct: 0.5,
      oiConcentration: 0.4,
      nearWall: true,
      rapidOiChange: true,
      ivExpanding: true,
      dataQuality: 0.3,
      timestampMismatch: true,
    });
    assert.ok(['HIGH', 'EXTREME'].includes(r.level));
  });

  it('stays LOW with clean inputs', () => {
    const r = computeCasRisk({
      isExpiryDay: false,
      iv: 12,
      spotFuturesDivergencePct: 0.05,
      distanceFromRefPct: 0.05,
      oiConcentration: 0.1,
      nearWall: false,
      rapidOiChange: false,
      ivExpanding: false,
      dataQuality: 0.9,
      timestampMismatch: false,
    });
    assert.equal(r.level, 'LOW');
  });
});
