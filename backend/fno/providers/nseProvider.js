'use strict';

const { FoDataProvider } = require('./base');
const { dataEnvelope, normalizeQuote } = require('../normalize');
const { INDEX_UNDERLYINGS, TICKER_ORDER } = require('../universe/underlyings');
const { ALL_SECTOR_FO_SYMBOLS, SECTOR_FO_SYMBOLS } = require('../universe/sectors');

const NSE_HOME = 'https://www.nseindia.com';
const NSE_ALL_INDICES = 'https://www.nseindia.com/api/allIndices';
const NSE_FII_DII = 'https://www.nseindia.com/api/fiidiiTradeReact';

const INDEX_NSE_MAP = {
  NIFTY: ['NIFTY 50'],
  BANKNIFTY: ['NIFTY BANK'],
  FINNIFTY: ['NIFTY FIN SERVICE', 'NIFTY FINANCIAL SERVICES'],
  MIDCPNIFTY: ['NIFTY MID SELECT', 'NIFTY MIDCAP SELECT', 'NIFTY MIDCAP 50', 'NIFTY MIDCAP 100'],
  INDIAVIX: ['INDIA VIX'],
  'INDIA VIX': ['INDIA VIX'],
  SENSEX: ['SENSEX', 'BSE SENSEX'],
};

class NseProvider extends FoDataProvider {
  /**
   * @param {object} [options]
   * @param {typeof fetch} [options.fetchImpl]
   */
  constructor(options = {}) {
    super();
    this.name = 'nse';
    this.fetchImpl = options.fetchImpl || fetch;
    this.cookieJar = '';
  }

  _headers() {
    return {
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      Accept: 'application/json,text/plain,*/*',
      Referer: `${NSE_HOME}/`,
      Cookie: this.cookieJar,
    };
  }

  async ensureSession() {
    const home = await this.fetchImpl(NSE_HOME, {
      headers: { 'User-Agent': this._headers()['User-Agent'] },
      signal: AbortSignal.timeout(15000),
      redirect: 'follow',
    });
    const raw = typeof home.headers.getSetCookie === 'function'
      ? home.headers.getSetCookie()
      : [];
    if (raw.length) {
      this.cookieJar = raw.map((c) => c.split(';')[0]).join('; ');
      return;
    }
    const single = home.headers.get('set-cookie');
    if (single) {
      this.cookieJar = single.split(',').map((c) => c.split(';')[0].trim()).join('; ');
    }
  }

  async _fetchJson(url, label) {
    await this.ensureSession();
    const resp = await this.fetchImpl(url, {
      headers: this._headers(),
      signal: AbortSignal.timeout(20000),
    });
    if (!resp.ok) throw new Error(`NSE ${label} failed: HTTP ${resp.status}`);
    return resp.json();
  }

  async fetchAllIndices() {
    const body = await this._fetchJson(NSE_ALL_INDICES, 'allIndices');
    const byName = new Map();
    for (const row of body?.data || []) {
      if (row?.index) byName.set(String(row.index).toUpperCase(), row);
    }
    return byName;
  }

  _pickRow(byName, names) {
    for (const name of names) {
      const row = byName.get(String(name).toUpperCase());
      if (row) return row;
    }
    return null;
  }

  _canonicalSymbol(sym) {
    const s = String(sym || '').toUpperCase();
    if (s === 'INDIA VIX') return 'INDIAVIX';
    return s;
  }

  async getIndexQuotes(symbols = TICKER_ORDER) {
    const byName = await this.fetchAllIndices();
    const wanted = (symbols?.length ? symbols : TICKER_ORDER).map((s) => String(s).toUpperCase());

    const quotes = [];
    for (const rawSym of wanted) {
      const symbol = this._canonicalSymbol(rawSym);
      const names = INDEX_NSE_MAP[rawSym] || INDEX_NSE_MAP[symbol]
        || INDEX_UNDERLYINGS.find((u) => u.id === symbol)?.nseAliases
        || [INDEX_UNDERLYINGS.find((u) => u.id === symbol)?.nseName || rawSym];
      const row = this._pickRow(byName, names);
      if (!row) continue;
      quotes.push(normalizeQuote({
        symbol,
        segment: 'INDEX',
        last: row.last,
        previousClose: row.previousClose,
        change: row.variation,
        changePct: row.percentChange,
        open: row.open,
        high: row.high,
        low: row.low,
        volume: row.totalTradedVolume ?? row.volume,
        timestamp: row.timeVal || row.timestamp || null,
      }, 'nse'));
    }

    return dataEnvelope(quotes, { source: 'nse', isMock: false });
  }

  async getOptionExpiries() {
    throw new Error('NSE public API does not expose option expiries in this provider; use DhanProvider');
  }

  async getOptionChain() {
    throw new Error('NSE public API option chain is not implemented in this provider; use DhanProvider');
  }

  async getFuturesQuotes() {
    throw new Error('NSE public futures quotes are not implemented in this provider; use DhanProvider');
  }

  async getFoUniverse() {
    return dataEnvelope({
      indices: INDEX_UNDERLYINGS.map((i) => i.id),
      stocks: ALL_SECTOR_FO_SYMBOLS,
      sectors: SECTOR_FO_SYMBOLS,
    }, { source: 'nse', isMock: false });
  }

  /**
   * FII/DII from NSE fiidiiTradeReact. Never fabricates numbers.
   * On failure → { cash: null, futures: null, error, available: false }.
   */
  async getFiiDii() {
    try {
      const body = await this._fetchJson(NSE_FII_DII, 'fiidiiTradeReact');
      const rows = Array.isArray(body) ? body : (body?.data || []);
      let fiiNet = null;
      let diiNet = null;
      let asOf = null;

      for (const row of rows) {
        const cat = String(row.category || row.Category || '').toUpperCase();
        const net = parseNet(row.netValue ?? row.net_value ?? row.net);
        if (net == null) continue;
        if (cat.includes('FII') || cat.includes('FPI')) fiiNet = net;
        if (cat.includes('DII')) diiNet = net;
        asOf = row.date || row.Date || asOf;
      }

      const available = fiiNet != null || diiNet != null;
      if (!available) {
        return dataEnvelope({
          cash: null,
          futures: null,
          available: false,
          error: 'FII/DII response empty or unparseable',
        }, { source: 'nse', isMock: false, error: 'FII/DII response empty or unparseable' });
      }

      return dataEnvelope({
        available: true,
        cash: {
          fii: fiiNet,
          dii: diiNet,
          fiiNet,
          diiNet,
          unit: 'INR Cr',
          asOf,
        },
        futures: {
          indexFuturesLong: null,
          indexFuturesShort: null,
          netFutures: null,
          note: 'Index futures long/short not exposed by this NSE endpoint — fields left null',
        },
        error: null,
      }, { source: 'nse', isMock: false });
    } catch (err) {
      return dataEnvelope({
        cash: null,
        futures: null,
        available: false,
        error: err.message || String(err),
      }, {
        source: 'nse',
        isMock: false,
        error: err.message || String(err),
      });
    }
  }
}

function parseNet(value) {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** Alias used by older docs / parallel modules. */
const NsePublicProvider = NseProvider;

module.exports = {
  NseProvider,
  NsePublicProvider,
  INDEX_NSE_MAP,
  NSE_ALL_INDICES,
  NSE_FII_DII,
  NSE_FIIDII: NSE_FII_DII,
};
