'use strict';

const { FoDataProvider } = require('./base');
const {
  normalizeQuote,
  normalizeOptionLeg,
  dataEnvelope,
} = require('../normalize');
const { INDEX_UNDERLYINGS, TICKER_ORDER, DEFAULT_INDEX_TICKERS } = require('../universe/underlyings');
const {
  ALL_SECTOR_FO_SYMBOLS,
  SECTOR_FO_SYMBOLS,
  SYMBOL_TO_SECTOR,
  sectorForSymbol,
} = require('../universe/sectors');

const MOCK_SPOT = {
  NIFTY: 24500,
  BANKNIFTY: 51200,
  FINNIFTY: 23400,
  MIDCPNIFTY: 11850,
  INDIAVIX: 13.45,
  'INDIA VIX': 13.45,
  SENSEX: 80500,
};

function hash01(seed) {
  let h = 2166136261;
  const s = String(seed);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

function nextWeeklyExpiry(from = new Date()) {
  const d = new Date(from);
  const day = d.getUTCDay();
  let add = (4 - day + 7) % 7;
  if (add === 0) add = 7;
  d.setUTCDate(d.getUTCDate() + add);
  return d.toISOString().slice(0, 10);
}

function canonicalIndexSymbol(symbol) {
  const s = String(symbol || '').toUpperCase();
  if (s === 'INDIA VIX') return 'INDIAVIX';
  return s;
}

function mockIndexRaw(symbol) {
  const canon = canonicalIndexSymbol(symbol);
  const spot = MOCK_SPOT[canon] ?? MOCK_SPOT[symbol] ?? 1000;
  const jitter = (hash01(`${canon}:chg`) - 0.5) * 0.012;
  const changePct = Number((jitter * 100).toFixed(2));
  const change = Number((spot * jitter).toFixed(2));
  const prevClose = Number((spot - change).toFixed(2));
  const open = Number((prevClose * (1 + (hash01(`${canon}:o`) - 0.5) * 0.004)).toFixed(2));
  const high = Number((Math.max(spot, open, prevClose) * (1 + hash01(`${canon}:h`) * 0.004)).toFixed(2));
  const low = Number((Math.min(spot, open, prevClose) * (1 - hash01(`${canon}:l`) * 0.004)).toFixed(2));
  return {
    symbol: canon,
    segment: 'INDEX',
    ltp: spot,
    change,
    changePct,
    open,
    high,
    low,
    prevClose,
    volume: Math.round(1e6 + hash01(`${canon}:v`) * 5e6),
    vwap: Number(((open + spot) / 2).toFixed(2)),
    oi: null,
    oiChange: null,
    iv: canon === 'INDIAVIX' ? spot : null,
    timestamp: 'MOCK',
    source: 'mock',
  };
}

function buildMockOptionChain(underlying = 'NIFTY', expiry = null) {
  const u = String(underlying || 'NIFTY').toUpperCase();
  const spot = MOCK_SPOT[u] || MOCK_SPOT.NIFTY;
  const exp = expiry || nextWeeklyExpiry();
  const step = u === 'BANKNIFTY' || u === 'SENSEX' ? 100 : 50;
  const atm = Math.round(spot / step) * step;
  const strikes = [];

  for (let i = -8; i <= 8; i++) {
    const strike = atm + i * step;
    const moneyness = (strike - spot) / spot;
    const callIv = Number((11 + Math.abs(moneyness) * 80 + hash01(`ce:${strike}`) * 2).toFixed(2));
    const putIv = Number((11.5 + Math.abs(moneyness) * 85 + hash01(`pe:${strike}`) * 2).toFixed(2));
    const callLtp = Number(Math.max(0.05, (spot - strike) * 0.55 + 80 + hash01(`ceL:${strike}`) * 40).toFixed(2));
    const putLtp = Number(Math.max(0.05, (strike - spot) * 0.55 + 75 + hash01(`peL:${strike}`) * 40).toFixed(2));
    const callOi = Math.round(800000 + hash01(`ceOi:${strike}`) * 3500000);
    const putOi = Math.round(700000 + hash01(`peOi:${strike}`) * 3200000);
    const callPrev = Math.round(callOi * (0.92 + hash01(`ceP:${strike}`) * 0.12));
    const putPrev = Math.round(putOi * (0.92 + hash01(`peP:${strike}`) * 0.12));

    strikes.push({
      strike,
      call: normalizeOptionLeg({
        oi: callOi,
        previous_oi: callPrev,
        volume: Math.round(50000 + hash01(`ceV:${strike}`) * 900000),
        implied_volatility: callIv,
        last_price: callLtp,
        previous_close_price: Number((callLtp * 0.97).toFixed(2)),
        top_bid_price: Number((callLtp - 0.5).toFixed(2)),
        top_ask_price: Number((callLtp + 0.5).toFixed(2)),
        average_price: callLtp,
        security_id: 40000 + i * 2,
        greeks: {
          delta: Number((0.5 - moneyness * 4).toFixed(4)),
          gamma: 0.0012,
          theta: -12.5,
          vega: 11.2,
        },
      }),
      put: normalizeOptionLeg({
        oi: putOi,
        previous_oi: putPrev,
        volume: Math.round(45000 + hash01(`peV:${strike}`) * 850000),
        implied_volatility: putIv,
        last_price: putLtp,
        previous_close_price: Number((putLtp * 0.98).toFixed(2)),
        top_bid_price: Number((putLtp - 0.45).toFixed(2)),
        top_ask_price: Number((putLtp + 0.55).toFixed(2)),
        average_price: putLtp,
        security_id: 40001 + i * 2,
        greeks: {
          delta: Number((-0.5 - moneyness * 4).toFixed(4)),
          gamma: 0.0011,
          theta: -10.8,
          vega: 11.4,
        },
      }),
    });
  }

  return {
    underlying: u,
    expiry: exp,
    spot,
    strikes,
    atm,
    metrics: {},
    interpretation: {},
    asOf: new Date().toISOString(),
    source: 'mock',
    label: 'MOCK DATA — for UI development only',
  };
}

const SAMPLE_FUTURES = (() => {
  const seeds = [
    { symbol: 'RELIANCE', ltp: 2985.4, changePct: 1.2, oiChangePct: 3.4, buildup: 'LONG_BUILDUP' },
    { symbol: 'HDFCBANK', ltp: 1682.1, changePct: -0.8, oiChangePct: 2.1, buildup: 'SHORT_BUILDUP' },
    { symbol: 'TCS', ltp: 4125.0, changePct: 0.6, oiChangePct: -1.8, buildup: 'SHORT_COVERING' },
    { symbol: 'INFY', ltp: 1888.5, changePct: -1.1, oiChangePct: -2.4, buildup: 'LONG_UNWINDING' },
    { symbol: 'ICICIBANK', ltp: 1245.2, changePct: 0.9, oiChangePct: 4.2, buildup: 'LONG_BUILDUP' },
    { symbol: 'SBIN', ltp: 812.3, changePct: -0.4, oiChangePct: 1.5, buildup: 'SHORT_BUILDUP' },
    { symbol: 'TATAMOTORS', ltp: 975.6, changePct: 2.3, oiChangePct: 5.1, buildup: 'LONG_BUILDUP' },
    { symbol: 'BAJFINANCE', ltp: 7120.0, changePct: -1.6, oiChangePct: 2.8, buildup: 'SHORT_BUILDUP' },
    { symbol: 'MARUTI', ltp: 12450, changePct: 0.4, oiChangePct: -0.9, buildup: 'SHORT_COVERING' },
    { symbol: 'ITC', ltp: 465.2, changePct: -0.3, oiChangePct: 1.1, buildup: 'SHORT_BUILDUP' },
  ];
  const bySym = new Map(seeds.map((s) => [s.symbol, s]));
  const patterns = ['LONG_BUILDUP', 'SHORT_BUILDUP', 'SHORT_COVERING', 'LONG_UNWINDING'];
  for (const symbol of ALL_SECTOR_FO_SYMBOLS) {
    if (bySym.has(symbol)) continue;
    const h = hash01(symbol);
    const changePct = Number(((h - 0.5) * 4).toFixed(2));
    const oiChangePct = Number(((hash01(`${symbol}:oi`) - 0.45) * 8).toFixed(2));
    let buildup = 'MIXED';
    if (Math.abs(changePct) >= 0.05 && Math.abs(oiChangePct) >= 0.05) {
      if (changePct > 0 && oiChangePct > 0) buildup = 'LONG_BUILDUP';
      else if (changePct < 0 && oiChangePct > 0) buildup = 'SHORT_BUILDUP';
      else if (changePct > 0 && oiChangePct < 0) buildup = 'SHORT_COVERING';
      else buildup = 'LONG_UNWINDING';
    }
    bySym.set(symbol, {
      symbol,
      ltp: Number((200 + h * 4000).toFixed(2)),
      changePct,
      oiChangePct,
      buildup: buildup === 'MIXED' ? patterns[Math.floor(h * 4) % 4] : buildup,
    });
  }
  return [...bySym.values()];
})();

class MockProvider extends FoDataProvider {
  constructor(options = {}) {
    super();
    this.name = 'mock';
    this.asOf = options.asOf || '2026-09-11T10:00:00.000Z';
  }

  _meta(extra = {}) {
    return {
      asOf: this.asOf,
      source: 'mock',
      isMock: true,
      stale: false,
      error: null,
      ...extra,
    };
  }

  async getIndexQuotes(symbols = TICKER_ORDER) {
    const wanted = (symbols?.length ? symbols : DEFAULT_INDEX_TICKERS)
      .map((s) => String(s).toUpperCase());
    const seen = new Set();
    const quotes = [];
    for (const s of wanted) {
      const canon = canonicalIndexSymbol(s);
      if (seen.has(canon)) continue;
      if (MOCK_SPOT[canon] == null && MOCK_SPOT[s] == null) continue;
      seen.add(canon);
      quotes.push(normalizeQuote(mockIndexRaw(canon), 'mock'));
    }
    return dataEnvelope(quotes, this._meta());
  }

  async getOptionExpiries(underlying = 'NIFTY') {
    const base = nextWeeklyExpiry(new Date(this.asOf));
    const d = new Date(base);
    const expiries = [];
    for (let i = 0; i < 6; i++) {
      const e = new Date(d);
      e.setUTCDate(d.getUTCDate() + i * 7);
      expiries.push(e.toISOString().slice(0, 10));
    }
    const monthly = new Date(d);
    monthly.setUTCMonth(monthly.getUTCMonth() + 1);
    expiries.push(monthly.toISOString().slice(0, 10));
    return dataEnvelope(expiries, this._meta({ underlying: String(underlying).toUpperCase() }));
  }

  async getOptionChain(underlying = 'NIFTY', expiry = null) {
    const chain = buildMockOptionChain(underlying, expiry);
    chain.asOf = this.asOf;
    return dataEnvelope(chain, this._meta({ warning: 'Labeled mock option chain' }));
  }

  async getFuturesQuotes(symbols = []) {
    const pool = SAMPLE_FUTURES;
    const wanted = symbols.length
      ? symbols.map((s) => (typeof s === 'object' ? s.symbol : String(s)).toUpperCase())
      : pool.map((p) => p.symbol);

    const quotes = wanted.map((sym) => {
      const sample = pool.find((p) => p.symbol === sym);
      const base = sample || {
        symbol: sym,
        ltp: 500 + hash01(sym) * 2000,
        changePct: (hash01(`${sym}:c`) - 0.5) * 4,
        oiChangePct: (hash01(`${sym}:oi`) - 0.5) * 6,
        buildup: 'MIXED',
      };
      const prev = base.ltp / (1 + base.changePct / 100);
      const oi = Math.round(1e6 + hash01(`${sym}:oiAbs`) * 4e6);
      const oiChange = Math.round(oi * (base.oiChangePct / 100));
      const vwap = Number(((prev + base.ltp) / 2).toFixed(2));
      const q = normalizeQuote({
        symbol: base.symbol,
        segment: 'NSE_FNO',
        ltp: base.ltp,
        changePct: base.changePct,
        change: Number((base.ltp - prev).toFixed(2)),
        prevClose: Number(prev.toFixed(2)),
        open: Number((prev * 1.001).toFixed(2)),
        high: Number((base.ltp * 1.01).toFixed(2)),
        low: Number((prev * 0.99).toFixed(2)),
        volume: Math.round(2e5 + hash01(`${sym}:vol`) * 1e6),
        vwap,
        oi,
        oiChange,
        timestamp: 'MOCK',
      }, 'mock');

      return {
        ...q,
        priceChangePct: base.changePct,
        oiChangePct: base.oiChangePct,
        relativeVolume: Number((0.8 + hash01(`${sym}:rvol`) * 1.5).toFixed(2)),
        vwapRelation: base.ltp >= vwap ? 'above' : 'below',
        ivChangePct: Number(((hash01(`${sym}:iv`) - 0.5) * 6).toFixed(2)),
        pcr: Number((0.7 + hash01(`${sym}:pcr`) * 0.8).toFixed(2)),
        high52w: Number((base.ltp * (1.08 + hash01(`${sym}:h52`) * 0.2)).toFixed(2)),
        low52w: Number((base.ltp * (0.7 + hash01(`${sym}:l52`) * 0.15)).toFixed(2)),
        buildup: base.buildup,
        sector: SYMBOL_TO_SECTOR[base.symbol] || sectorForSymbol(base.symbol),
        label: 'MOCK',
      };
    });

    return dataEnvelope(quotes, this._meta());
  }

  async getFoUniverse() {
    return dataEnvelope({
      indices: INDEX_UNDERLYINGS.map((i) => i.id),
      stocks: ALL_SECTOR_FO_SYMBOLS,
      sectors: SECTOR_FO_SYMBOLS,
      label: 'MOCK universe',
    }, this._meta());
  }

  async getFiiDii() {
    return dataEnvelope({
      cash: {
        fii: 1245.67,
        dii: -832.14,
        fiiNet: 1245.67,
        diiNet: -832.14,
        date: this.asOf.slice(0, 10),
        asOf: this.asOf.slice(0, 10),
        unit: 'INR crore',
        label: 'MOCK — not real FII/DII',
      },
      futures: {
        indexFuturesLong: null,
        indexFuturesShort: null,
        netFutures: null,
        note: 'Futures positioning not available in mock (never fabricate)',
      },
      available: true,
      error: null,
      label: 'MOCK FII/DII cash sample',
    }, this._meta());
  }

  async getSectorReturns() {
    const sectors = Object.keys(SECTOR_FO_SYMBOLS).map((name) => {
      const pct = Number(((hash01(`sec:${name}`) - 0.45) * 3).toFixed(2));
      return {
        sector: name,
        changePct: pct,
        direction: pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat',
        label: 'MOCK',
      };
    });
    return dataEnvelope(sectors, this._meta());
  }
}

module.exports = {
  MockProvider,
  MOCK_SPOT,
  SAMPLE_FUTURES,
  buildMockOptionChain,
  nextWeeklyExpiry,
};
