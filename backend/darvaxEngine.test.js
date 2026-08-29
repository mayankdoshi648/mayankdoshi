const test = require('node:test');
const assert = require('node:assert/strict');
const {
  evaluateDarvaX,
  findBoxTop,
  findBoxBottom,
  passesPrefilter,
  computeStops,
} = require('./darvaxEngine');

function makeCandles(specs) {
  return specs.map((s, i) => ({
    time: Date.UTC(2024, 0, i + 1),
    open: s.o ?? s.c,
    high: s.h ?? s.c + 1,
    low: s.l ?? s.c - 1,
    close: s.c,
    volume: s.v ?? 100_000,
  }));
}

function buildBoxScenario() {
  const specs = [];
  for (let i = 0; i < 220; i++) {
    const c = 50 + i * 0.25;
    specs.push({ c, h: c + 0.5, l: c - 0.5, v: 150_000 });
  }
  const top = specs[specs.length - 1].c + 2;
  specs.push({ c: top - 1, h: top, l: top - 3, v: 200_000 });
  for (let i = 0; i < 3; i++) {
    specs.push({ c: top - 2, h: top - 0.5, l: top - 4, v: 180_000 });
  }
  const bottom = top - 10;
  specs.push({ c: bottom, h: bottom + 1, l: bottom - 1, v: 160_000 });
  for (let i = 0; i < 3; i++) {
    specs.push({ c: bottom + 1 + i, h: bottom + 2 + i, l: bottom, v: 170_000 });
  }
  for (let i = 0; i < 12; i++) {
    specs.push({ c: bottom + 4 + i * 0.3, h: top - 2, l: bottom + 2, v: 175_000 });
  }
  specs.push({ c: top + 1, h: top + 2, l: top - 0.5, v: 400_000 });
  return makeCandles(specs);
}

test('findBoxTop detects 3-day confirmation', () => {
  const candles = buildBoxScenario();
  const top = findBoxTop(candles, 252, 3);
  assert.ok(top);
  assert.ok(top.boxTop > 0);
});

test('findBoxBottom after top', () => {
  const candles = buildBoxScenario();
  const top = findBoxTop(candles, 252, 3);
  const bottom = findBoxBottom(candles, top, 3);
  assert.ok(bottom);
  assert.ok(bottom.boxBottom < top.boxTop);
});

test('passesPrefilter for strong NSE stock', () => {
  const candles = buildBoxScenario();
  assert.equal(passesPrefilter(candles, 'NSE'), true);
});

test('evaluateDarvaX returns box and reasons', () => {
  const candles = buildBoxScenario();
  const result = evaluateDarvaX(candles, { market: 'NSE', rsPercentile: 85 });
  assert.ok(result.box);
  assert.ok(result.strengthScore >= 0);
  assert.ok(Array.isArray(result.reasonsPass));
  assert.ok(result.levels.stops.primary > 0);
});

test('computeStops picks tightest valid stop', () => {
  const candles = buildBoxScenario();
  const stops = computeStops(candles, 150, 140, 'swing', null);
  assert.ok(stops.primary >= 140 * 0.995 || stops.primary >= 150 * 0.9);
});

test('evaluateDarvaX rejects insufficient history', () => {
  const candles = makeCandles([{ c: 100 }, { c: 101 }]);
  const result = evaluateDarvaX(candles, { market: 'NSE' });
  assert.equal(result.qualifies, false);
});
