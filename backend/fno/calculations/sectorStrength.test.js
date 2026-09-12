'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { computeSectorStrength, rankSectors } = require('./sectorStrength');

test('computeSectorStrength returns 0-100 for full bullish inputs', () => {
  const score = computeSectorStrength({
    returnPct: 3,
    avgOiChangePct: 5,
    advanceDecline: 2,
    longBuildupCount: 10,
    shortBuildupCount: 0,
    relativeVolume: 2,
  });
  assert.ok(score >= 90 && score <= 100);
});

test('computeSectorStrength bearish inputs score low', () => {
  const score = computeSectorStrength({
    returnPct: -3,
    avgOiChangePct: -5,
    advanceDecline: 0.5,
    longBuildupCount: 0,
    shortBuildupCount: 10,
    relativeVolume: 0.5,
  });
  assert.ok(score <= 15);
});

test('computeSectorStrength skips missing fields; empty → 50', () => {
  const onlyReturn = computeSectorStrength({ returnPct: 0 });
  assert.ok(onlyReturn !== null);
  assert.ok(onlyReturn >= 40 && onlyReturn <= 60);

  assert.equal(computeSectorStrength({}), 50);
  assert.equal(computeSectorStrength(null), 50);
  assert.equal(computeSectorStrength(undefined), 50);
});

test('computeSectorStrength ignores null numeric fields', () => {
  const score = computeSectorStrength({
    returnPct: 1,
    avgOiChangePct: null,
    advanceDecline: undefined,
  });
  assert.ok(score > 50);
});

test('rankSectors sorts by score desc and adds rank', () => {
  const ranked = rankSectors([
    { name: 'IT', returnPct: -1, longBuildupCount: 1, shortBuildupCount: 5, relativeVolume: 0.8, advanceDecline: 0.7 },
    { name: 'BANK', returnPct: 2, longBuildupCount: 8, shortBuildupCount: 1, relativeVolume: 1.5, advanceDecline: 1.8 },
    { name: 'AUTO', returnPct: 0.5, longBuildupCount: 3, shortBuildupCount: 3, relativeVolume: 1.0, advanceDecline: 1.0 },
  ]);
  assert.equal(ranked.length, 3);
  assert.equal(ranked[0].name, 'BANK');
  assert.equal(ranked[0].rank, 1);
  assert.equal(ranked[1].rank, 2);
  assert.equal(ranked[2].rank, 3);
  assert.ok(ranked[0].score >= ranked[1].score);
  assert.ok(ranked[1].score >= ranked[2].score);
});

test('rankSectors handles empty / invalid', () => {
  assert.deepEqual(rankSectors([]), []);
  assert.deepEqual(rankSectors(null), []);
  assert.deepEqual(rankSectors(undefined), []);
});

test('rankSectors keeps empty-stats sectors with neutral score', () => {
  const ranked = rankSectors([
    { name: 'EMPTY' },
    { name: 'OK', returnPct: 1 },
  ]);
  assert.equal(ranked[0].name, 'OK');
  assert.equal(ranked[0].rank, 1);
  assert.equal(ranked[1].name, 'EMPTY');
  assert.equal(ranked[1].score, 50);
});
