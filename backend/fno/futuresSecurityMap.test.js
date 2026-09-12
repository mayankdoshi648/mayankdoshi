'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseFuturesSecurityMap,
  toQuoteRequests,
  pickFrontMonth,
  FUT_SYMBOL_RE,
  loadFuturesSecurityMap,
  clearFuturesSecurityMapCache,
} = require('./futuresSecurityMap');

const SAMPLE_CSV = [
  'SEM_EXM_EXCH_ID,SEM_SEGMENT,SEM_SMST_SECURITY_ID,SEM_INSTRUMENT_NAME,SEM_EXPIRY_CODE,SEM_TRADING_SYMBOL,SEM_LOT_UNITS,SEM_CUSTOM_SYMBOL,SEM_EXPIRY_DATE,SEM_STRIKE_PRICE,SEM_OPTION_TYPE,SEM_TICK_SIZE,SEM_EXPIRY_FLAG,SEM_EXCH_INSTRUMENT_TYPE,SEM_SERIES,SM_SYMBOL_NAME',
  'NSE,D,111,FUTSTK,0,RELIANCE-Aug2026-FUT,250,RELIANCE AUG FUT,2026-08-28 14:30:00,-0.01,XX,0.05,M,FUT,,',
  'NSE,D,222,FUTSTK,0,RELIANCE-Sep2026-FUT,250,RELIANCE SEP FUT,2026-09-29 14:30:00,-0.01,XX,0.05,M,FUT,,',
  'NSE,D,333,FUTSTK,0,RELIANCE-Oct2026-FUT,250,RELIANCE OCT FUT,2026-10-27 14:30:00,-0.01,XX,0.05,M,FUT,,',
  'NSE,D,444,FUTIDX,0,NIFTY-Sep2026-FUT,25,NIFTY SEP FUT,2026-09-29 14:30:00,-0.01,XX,0.05,M,FUT,,',
  'NSE,D,555,FUTSTK,0,BAJAJ-AUTO-Sep2026-FUT,75,BAJAJ-AUTO SEP FUT,2026-09-29 14:30:00,-0.01,XX,0.05,M,FUT,,',
  'NSE,E,999,EQUITY,0,RELIANCE,1,RELIANCE,,,XX,0.05,,EQ,EQ,',
].join('\n');

describe('futuresSecurityMap', () => {
  it('parses FUT trading symbols including hyphenated names', () => {
    assert.equal(FUT_SYMBOL_RE.exec('BAJAJ-AUTO-Sep2026-FUT')[1], 'BAJAJ-AUTO');
    assert.equal(FUT_SYMBOL_RE.exec('M&M-Sep2026-FUT')[1], 'M&M');
  });

  it('picks nearest monthly expiry on/after asOf', () => {
    const map = parseFuturesSecurityMap(SAMPLE_CSV, { asOf: new Date('2026-09-11T00:00:00+05:30') });
    assert.equal(map.get('RELIANCE').securityId, 222);
    assert.equal(map.get('NIFTY').securityId, 444);
    assert.equal(map.get('BAJAJ-AUTO').securityId, 555);
    assert.equal(map.get('RELIANCE').segment, 'NSE_FNO');
  });

  it('filters by requested symbols', () => {
    const map = parseFuturesSecurityMap(SAMPLE_CSV, {
      asOf: new Date('2026-09-11'),
      symbols: ['NIFTY'],
    });
    assert.equal(map.size, 1);
    assert.ok(map.has('NIFTY'));
  });

  it('toQuoteRequests maps symbols to Dhan quote objects', () => {
    const map = parseFuturesSecurityMap(SAMPLE_CSV, { asOf: new Date('2026-09-11') });
    const reqs = toQuoteRequests(['RELIANCE', 'MISSING'], map);
    assert.deepEqual(reqs, [
      { symbol: 'RELIANCE', securityId: 222, segment: 'NSE_FNO' },
    ]);
  });

  it('pickFrontMonth prefers monthly contracts', () => {
    const picked = pickFrontMonth([
      { expiryMs: Date.parse('2026-09-15T00:00:00Z'), expiryFlag: 'W', securityId: 1 },
      { expiryMs: Date.parse('2026-09-29T00:00:00Z'), expiryFlag: 'M', securityId: 2 },
    ], Date.parse('2026-09-11T00:00:00Z'));
    assert.equal(picked.securityId, 2);
  });

  it('uses bundled map on Cloudflare runtime without network', async () => {
    const prev = process.env.POWERBULL_RUNTIME;
    process.env.POWERBULL_RUNTIME = 'cloudflare';
    clearFuturesSecurityMapCache();
    let fetched = false;
    const fetchImpl = async () => {
      fetched = true;
      throw new Error('network should not be used on Cloudflare');
    };
    const map = await loadFuturesSecurityMap(['NIFTY', 'RELIANCE'], fetchImpl);
    assert.equal(fetched, false);
    assert.ok(map.get('NIFTY')?.securityId);
    assert.ok(map.get('RELIANCE')?.securityId);
    process.env.POWERBULL_RUNTIME = prev;
    clearFuturesSecurityMapCache();
  });
});
