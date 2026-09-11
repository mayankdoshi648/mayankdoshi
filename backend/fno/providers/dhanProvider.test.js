'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { DhanProvider, UNDERLYINGS, MIN_OPTION_CHAIN_INTERVAL_MS } = require('./dhanProvider');
const { createProvider, HybridProvider } = require('./index');
const { MockProvider } = require('./mockProvider');

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; },
    async text() { return JSON.stringify(body); },
  };
}

describe('DhanProvider', () => {
  it('exports UNDERLYINGS map with expected scrips', () => {
    assert.equal(UNDERLYINGS.NIFTY.scrip, 13);
    assert.equal(UNDERLYINGS.NIFTY.seg, 'IDX_I');
    assert.equal(UNDERLYINGS.BANKNIFTY.scrip, 25);
    assert.equal(UNDERLYINGS.FINNIFTY.scrip, 27);
    assert.equal(UNDERLYINGS.MIDCPNIFTY.scrip, 442);
    assert.equal(UNDERLYINGS.SENSEX.scrip, 51);
    assert.equal(UNDERLYINGS.SENSEX.seg, 'BSE_I');
  });

  it('getOptionChain POSTs to Dhan with auth headers and normalizes', async () => {
    const calls = [];
    const fetchImpl = async (url, opts) => {
      calls.push({ url, opts });
      return jsonResponse({
        status: 'success',
        data: {
          last_price: 24510,
          oc: {
            '24500.000000': {
              ce: {
                last_price: 120,
                oi: 1000,
                previous_oi: 900,
                implied_volatility: 10,
                top_bid_price: 119,
                top_ask_price: 121,
                volume: 50,
                security_id: 1,
                greeks: { delta: 0.5, gamma: 0.001, theta: -1, vega: 2 },
              },
              pe: {
                last_price: 110,
                oi: 2000,
                previous_oi: 1800,
                implied_volatility: 11,
                volume: 60,
                security_id: 2,
              },
            },
          },
        },
      });
    };

    const provider = new DhanProvider({
      accessToken: 'tok',
      clientId: 'cid',
      fetchImpl,
    });

    const { data, meta } = await provider.getOptionChain('NIFTY', '2026-09-17');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.dhan.co/v2/optionchain');
    assert.equal(calls[0].opts.method, 'POST');
    assert.equal(calls[0].opts.headers['access-token'], 'tok');
    assert.equal(calls[0].opts.headers['client-id'], 'cid');
    const body = JSON.parse(calls[0].opts.body);
    assert.deepEqual(body, {
      UnderlyingScrip: 13,
      UnderlyingSeg: 'IDX_I',
      Expiry: '2026-09-17',
    });
    assert.equal(meta.isMock, false);
    assert.equal(meta.source, 'dhan');
    assert.equal(data.spot, 24510);
    assert.equal(data.strikes[0].call.oiChange, 100);
  });

  it('getOptionExpiries hits expirylist endpoint', async () => {
    const fetchImpl = async (url) => {
      assert.equal(url, 'https://api.dhan.co/v2/optionchain/expirylist');
      return jsonResponse({ status: 'success', data: ['2026-09-17', '2026-09-24'] });
    };
    const provider = new DhanProvider({ accessToken: 't', clientId: 'c', fetchImpl });
    const { data } = await provider.getOptionExpiries('BANKNIFTY');
    assert.deepEqual(data, ['2026-09-17', '2026-09-24']);
  });

  it('throws clear Error on API failure (does not fabricate)', async () => {
    const fetchImpl = async () => jsonResponse({ error: 'nope' }, 401);
    const provider = new DhanProvider({ accessToken: 't', clientId: 'c', fetchImpl });
    await assert.rejects(
      () => provider.getOptionChain('NIFTY', '2026-09-17'),
      /Dhan optionchain failed: HTTP 401/,
    );
  });

  it('rate-limits option-chain unique calls with >= 3s gap', async () => {
    let now = 1_000_000;
    const sleeps = [];
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return jsonResponse({ status: 'success', data: ['2026-09-17'] });
    };
    const provider = new DhanProvider({
      accessToken: 't',
      clientId: 'c',
      fetchImpl,
      now: () => now,
      sleep: async (ms) => { sleeps.push(ms); now += ms; },
    });

    await provider.getOptionExpiries('NIFTY');
    await provider.getOptionExpiries('NIFTY');
    assert.equal(calls, 2);
    assert.equal(sleeps.length, 1);
    assert.ok(sleeps[0] >= MIN_OPTION_CHAIN_INTERVAL_MS - 1);
  });

  it('createProvider with Dhan creds returns HybridProvider', () => {
    const p = createProvider({
      config: { accessToken: 't', clientId: 'c' },
      fetchImpl: async () => jsonResponse({}),
    });
    assert.ok(p instanceof HybridProvider);
  });

  it('Hybrid falls back to mock chain with isMock true on Dhan failure', async () => {
    const fetchImpl = async (url) => {
      if (String(url).includes('optionchain') && !String(url).includes('expirylist')) {
        return jsonResponse({ message: 'fail' }, 500);
      }
      return jsonResponse({ data: [] });
    };
    const hybrid = createProvider({
      config: { accessToken: 't', clientId: 'c' },
      fetchImpl,
    });
    assert.ok(hybrid instanceof HybridProvider);
    const { data, meta } = await hybrid.getOptionChain('NIFTY', '2026-09-17');
    assert.equal(meta.isMock, true);
    assert.ok(meta.warning);
    assert.equal(data.spot, 24500);
    assert.ok(data.strikes.length > 0);
  });

  it('preferMock forces MockProvider even with creds', () => {
    const p = createProvider({
      preferMock: true,
      config: { accessToken: 't', clientId: 'c' },
    });
    assert.ok(p instanceof MockProvider);
  });

  it('Hybrid getFuturesQuotes resolves security ids and returns live (non-mock) rows', async () => {
    const fetchImpl = async (url, opts = {}) => {
      if (String(url).includes('marketfeed/quote')) {
        const body = JSON.parse(opts.body || '{}');
        assert.ok(body.NSE_FNO.includes(222));
        return jsonResponse({
          data: {
            NSE_FNO: {
              222: {
                last_price: 1266.1,
                net_change: -6.4,
                average_price: 1262.3,
                volume: 10122500,
                oi: 131565500,
                ohlc: { open: 1270.1, high: 1270.9, low: 1255.7, close: 1272.5 },
              },
            },
          },
        });
      }
      return jsonResponse({ data: [] });
    };
    const dhan = new DhanProvider({
      accessToken: 't',
      clientId: 'c',
      fetchImpl,
    });
    const hybrid = new HybridProvider({
      nse: new MockProvider(),
      dhan,
      mock: new MockProvider(),
      loadFuturesMap: async () => new Map([
        ['RELIANCE', { securityId: 222, segment: 'NSE_FNO' }],
      ]),
      defaultSymbols: ['RELIANCE'],
    });

    const first = await hybrid.getFuturesQuotes();
    assert.equal(first.meta.isMock, false);
    assert.equal(first.meta.source, 'dhan');
    assert.equal(first.data.length, 1);
    assert.equal(first.data[0].symbol, 'RELIANCE');
    assert.equal(first.data[0].ltp, 1266.1);
    assert.equal(first.data[0].priceChangePct != null, true);
    assert.equal(first.data[0].oiChangePct, null); // no prior snapshot yet

    const second = await hybrid.getFuturesQuotes();
    assert.equal(second.data[0].oiChangePct, 0); // same OI as previous poll
  });
});
