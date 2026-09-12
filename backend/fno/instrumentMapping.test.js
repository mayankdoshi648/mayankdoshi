'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { resolveInstrument, listKinds } = require('./instrumentMapping');
const { createNseDataService } = require('./nseDataService');

describe('instrumentMapping', () => {
  it('lists kinds', () => {
    assert.ok(listKinds().includes('FUTURES'));
    assert.ok(listKinds().includes('CASH'));
  });

  it('resolves index underlyings without network', async () => {
    const nifty = await resolveInstrument('NIFTY', { kind: 'INDEX' });
    assert.equal(nifty.securityId, 13);
    assert.equal(nifty.exchangeSegment, 'IDX_I');
  });
});

describe('nseDataService', () => {
  it('caches index quotes and timestamps', async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return {
        ok: true,
        headers: {
          get() { return null; },
          getSetCookie() { return []; },
        },
        async json() {
          return {
            data: [
              {
                index: 'NIFTY 50',
                last: 25000,
                variation: 100,
                percentChange: 0.4,
                open: 24900,
                high: 25100,
                low: 24800,
                previousClose: 24900,
              },
            ],
          };
        },
        async text() { return ''; },
      };
    };
    const svc = createNseDataService({ fetchImpl, ttl: { indices: 60_000, fii: 60_000 } });
    const first = await svc.getIndexQuotes(['NIFTY']);
    assert.ok(first?.meta);
    const callsAfterFirst = calls;
    assert.ok(callsAfterFirst >= 1);
    const second = await svc.getIndexQuotes(['NIFTY']);
    assert.equal(calls, callsAfterFirst, 'second call should hit cache');
    assert.ok(second?.meta);
  });
});
