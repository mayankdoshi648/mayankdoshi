const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  directionFromPct,
  formatQuote,
  emaStatusFromCloses,
  pickQuote,
} = require('./marketOverview');

describe('marketOverview', () => {
  it('directionFromPct maps up/down/flat', () => {
    assert.equal(directionFromPct(0.5), 'up');
    assert.equal(directionFromPct(-1.2), 'down');
    assert.equal(directionFromPct(0), 'flat');
    assert.equal(directionFromPct(null), 'flat');
  });

  it('formatQuote adds green/red arrow for change', () => {
    const up = formatQuote(
      { id: 'nifty50', label: 'Nifty 50' },
      { last: 24000, change: 100, changePct: 0.42 },
    );
    assert.equal(up.direction, 'up');
    assert.equal(up.arrow, '▲');
    assert.equal(up.changePct, 0.42);

    const down = formatQuote(
      { id: 'bankNifty', label: 'Bank Nifty' },
      { last: 50000, change: -200, changePct: -0.4 },
    );
    assert.equal(down.direction, 'down');
    assert.equal(down.arrow, '▼');
  });

  it('emaStatusFromCloses marks above/below EMA 20/50/200', () => {
    const closes = [];
    for (let i = 0; i < 250; i++) closes.push(100 + i * 0.5);
    const status = emaStatusFromCloses(closes);
    assert.equal(status.ema20.above, true);
    assert.equal(status.ema50.above, true);
    assert.equal(status.ema200.above, true);
    assert.equal(status.bias, 'bullish');
    assert.equal(status.score, 3);
  });

  it('emaStatusFromCloses detects bearish when price below all EMAs', () => {
    const closes = [];
    for (let i = 0; i < 250; i++) closes.push(200 - i * 0.4);
    const status = emaStatusFromCloses(closes);
    assert.equal(status.ema20.above, false);
    assert.equal(status.ema50.above, false);
    assert.equal(status.ema200.above, false);
    assert.equal(status.bias, 'bearish');
  });

  it('pickQuote reads NSE row fields', () => {
    const byName = new Map([
      ['NIFTY 50', {
        index: 'NIFTY 50',
        last: 23897.7,
        previousClose: 23873.45,
        variation: 24.25,
        percentChange: 0.1,
      }],
    ]);
    const q = pickQuote(byName, 'NIFTY 50');
    assert.equal(q.last, 23897.7);
    assert.equal(q.changePct, 0.1);
    assert.equal(pickQuote(byName, 'MISSING'), null);
  });
});
