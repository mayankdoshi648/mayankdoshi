const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { shouldAlert, formatAlertMessage } = require('./telegramAlerts');
const { parseScreenerHtml, applyFundamentalBonus } = require('./screenerFundamentals');

test('shouldAlert triggers on high score and SUPER_TREND', () => {
  assert.equal(shouldAlert({ strengthScore: 90, stage: 'ARMED' }, {}), true);
  assert.equal(shouldAlert({ strengthScore: 60, stage: 'SUPER_TREND' }, {}), true);
  assert.equal(shouldAlert({ strengthScore: 75, stage: 'BREAKOUT' }, {}), true);
  assert.equal(shouldAlert({ strengthScore: 50, stage: 'ARMED' }, {}), false);
});

test('formatAlertMessage includes symbol and score', () => {
  const msg = formatAlertMessage('2026-08-29', [{
    symbol: 'RELIANCE',
    market: 'NSE',
    stage: 'BREAKOUT',
    strengthScore: 88,
    tier: 'A+',
    box: { top: 2850, bottom: 2720 },
    rvol: 2.1,
    reasonsPass: ['✓ Within 4% of 52w high'],
    fundamentals: { roce: 10.3, salesGrowthTtm: 15, profitGrowthTtm: 12 },
  }]);
  assert.match(msg, /RELIANCE/);
  assert.match(msg, /88/);
  assert.match(msg, /BREAKOUT/);
});

test('parseScreenerHtml extracts ROCE and growth from sample HTML', () => {
  const sample = fs.readFileSync('/tmp/screener.html', 'utf8');
  const data = parseScreenerHtml(sample, 'RELIANCE');
  assert.ok(data.roce > 0);
  assert.ok(data.roe > 0);
});

test('applyFundamentalBonus increases score for strong fundamentals', () => {
  const base = {
    strengthScore: 70,
    tier: 'A',
    stage: 'BREAKOUT',
    reasonsPass: [],
    reasonsFail: [],
  };
  const updated = applyFundamentalBonus(base, {
    roce: 20,
    salesGrowthTtm: 18,
    profitGrowthTtm: 30,
  });
  assert.ok(updated.strengthScore > 70);
  assert.ok(updated.reasonsPass.some((r) => r.includes('ROCE')));
});
