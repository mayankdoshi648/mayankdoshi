// backend/dhanQuotes.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeQuote, fetchOhlcQuotes, chunk } = require('./dhanQuotes');

test('chunk splits arrays', () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
});

test('normalizeQuote computes changePct from prev close', () => {
  const q = normalizeQuote('11536', {
    last_price: 110,
    net_change: 10,
    volume: 12345,
    ohlc: { open: 100, high: 112, low: 99, close: 100 },
  });
  assert.equal(q.ltp, 110);
  assert.equal(q.change, 10);
  assert.equal(q.changePct, 10);
  assert.equal(q.volume, 12345);
});

test('fetchOhlcQuotes maps security ids', async () => {
  const fetchImpl = async () => ({
    ok: true,
    async json() {
      return {
        status: 'success',
        data: {
          NSE_EQ: {
            2885: {
              last_price: 2500,
              ohlc: { open: 2480, high: 2510, low: 2470, close: 2490 },
            },
          },
        },
      };
    },
  });

  const map = await fetchOhlcQuotes({
    accessToken: 'tok',
    clientId: 'cid',
    securityIds: ['2885'],
    fetchImpl,
  });
  assert.equal(map.get('2885').ltp, 2500);
  assert.equal(map.get('2885').prevClose, 2490);
});

test('postMarketFeed retries on HTTP 429 then succeeds', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls < 3) {
      return {
        ok: false,
        status: 429,
        async text() { return '{"data":{"805":"Too many requests"},"status":"failed"}'; },
      };
    }
    return {
      ok: true,
      async json() {
        return { status: 'success', data: { NSE_EQ: { 2885: { last_price: 1, ohlc: { close: 1 } } } } };
      },
    };
  };
  const { postMarketFeed, DHAN_OHLC_URL } = require('./dhanQuotes');
  const data = await postMarketFeed(DHAN_OHLC_URL, {
    accessToken: 't',
    clientId: 'c',
    securityIds: [2885],
    fetchImpl,
  });
  assert.equal(calls, 3);
  assert.ok(data[2885] || data['2885']);
});
