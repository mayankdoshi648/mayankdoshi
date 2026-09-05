const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildQuotesUrl,
  normalizeQuoteProps,
  toNeoSymbol,
  extractQuoteList,
  matchQuote,
  fetchKotakQuotesByIds,
  isKotakConfigured,
  generateTotp,
} = require('./kotakNeo');

describe('kotakNeo', () => {
  const prevKey = process.env.KOTAK_NEO_CONSUMER_KEY;

  before(() => {
    process.env.KOTAK_NEO_CONSUMER_KEY = 'test-consumer-key';
  });

  after(() => {
    if (prevKey == null) delete process.env.KOTAK_NEO_CONSUMER_KEY;
    else process.env.KOTAK_NEO_CONSUMER_KEY = prevKey;
  });

  it('isKotakConfigured reads consumer key', () => {
    assert.equal(isKotakConfigured(), true);
  });

  it('toNeoSymbol and buildQuotesUrl encode nse_cm tokens', () => {
    const token = { instrument_token: 'Nifty 50', exchange_segment: 'nse_cm' };
    assert.equal(toNeoSymbol(token), 'nse_cm|Nifty 50');
    const url = buildQuotesUrl([token], 'ltp');
    assert.match(url, /neosymbol\//);
    assert.match(url, /mis\.kotaksecurities\.com/);
    assert.match(url, /ltp$/);
    assert.ok(url.includes(encodeURIComponent('nse_cm|Nifty 50')));
  });

  it('normalizeQuoteProps maps ltp / percent fields', () => {
    const q = normalizeQuoteProps({
      ltp: '24850.25',
      per_change: '0.42',
      change: '104.10',
      prev_close: '24746.15',
      exchange_token: 'Nifty 50',
    });
    assert.equal(q.value, 24850.25);
    assert.equal(q.pChange, 0.42);
    assert.equal(q.change, 104.1);
  });

  it('normalizeQuoteProps accepts Neo live per_change field', () => {
    const q = normalizeQuoteProps({
      exchange_token: 'Nifty 50',
      ltp: '23897.7',
      per_change: '0.1016',
      change: '24.25',
    });
    assert.equal(q.value, 23897.7);
    assert.equal(q.pChange, 0.1016);
  });

  it('normalizeQuoteProps derives percent from prev close', () => {
    const q = normalizeQuoteProps({ last_price: 110, previous_close: 100 });
    assert.equal(q.value, 110);
    assert.equal(q.pChange, 10);
  });

  it('extractQuoteList + matchQuote find token row', () => {
    const list = extractQuoteList({
      data: [
        { instrument_token: 'Nifty Bank', ltp: 52000, per_change: -0.2 },
        { instrument_token: 'Nifty 50', ltp: 24000, per_change: 0.1 },
      ],
    });
    assert.equal(list.length, 2);
    const hit = matchQuote(list, {
      instrument_token: 'Nifty 50',
      exchange_segment: 'nse_cm',
    });
    assert.equal(hit.ltp, 24000);
  });

  it('fetchKotakQuotesByIds uses Authorization header and maps ids', async () => {
    let seenUrl = '';
    let seenAuth = '';
    const fetchImpl = async (url, opts) => {
      seenUrl = url;
      seenAuth = opts.headers.Authorization;
      return {
        data: [
          {
            instrument_token: 'Nifty 50',
            ltp: 24100,
            per_change: 0.55,
            change: 132,
          },
        ],
      };
    };

    const map = await fetchKotakQuotesByIds(
      [{ id: 'nifty50', instrument_token: 'Nifty 50', exchange_segment: 'nse_cm' }],
      { fetchImpl },
    );
    assert.equal(seenAuth, 'test-consumer-key');
    assert.match(seenUrl, /neosymbol/);
    assert.equal(map.get('nifty50').last, 24100);
    assert.equal(map.get('nifty50').changePct, 0.55);
  });

  it('generateTotp returns 6 digits for a known secret', () => {
    // "JBSWY3DPEHPK3PXP" is a common test Base32 secret
    const code = generateTotp('JBSWY3DPEHPK3PXP');
    assert.match(code, /^\d{6}$/);
  });
});
