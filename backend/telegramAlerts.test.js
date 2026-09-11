const test = require('node:test');
const assert = require('node:assert/strict');
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
  const sample = `
    <ul id="top-ratios">
      <li><span class="name">ROCE</span><span class="number">18.5</span></li>
      <li><span class="name">ROE</span><span class="number">22.1</span></li>
      <li><span class="name">Stock P/E</span><span class="number">25.4</span></li>
    </ul>
    <table>
      <th colspan="2">Compounded Sales Growth</th>
      <tr><td>TTM:</td><td>12.5%</td></tr>
      <tr><td>3 Years:</td><td>10%</td></tr>
    </table>
    <table>
      <th colspan="2">Compounded Profit Growth</th>
      <tr><td>TTM:</td><td>15%</td></tr>
    </table>
  `;
  const data = parseScreenerHtml(sample, 'RELIANCE');
  assert.ok(data.roce > 0);
  assert.ok(data.roe > 0);
  assert.equal(data.salesGrowthTtm, 12.5);
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
