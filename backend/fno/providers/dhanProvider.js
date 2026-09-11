'use strict';

const { FoDataProvider } = require('./base');
const { fetchAccessToken } = require('../../dhanAuth');
const { dataEnvelope, normalizeQuote, normalizeOptionChain } = require('../normalize');
const { INDEX_UNDERLYINGS } = require('../universe/underlyings');
const { ALL_SECTOR_FO_SYMBOLS, SECTOR_FO_SYMBOLS } = require('../universe/sectors');

const OPTION_CHAIN_URL = 'https://api.dhan.co/v2/optionchain';
const EXPIRY_LIST_URL = 'https://api.dhan.co/v2/optionchain/expirylist';
const QUOTE_URL = 'https://api.dhan.co/v2/marketfeed/quote';
const MIN_OPTION_CHAIN_INTERVAL_MS = 3000;

/** Dhan underlying security map for index F&O. */
const UNDERLYINGS = {
  NIFTY: { scrip: 13, seg: 'IDX_I', label: 'NIFTY' },
  BANKNIFTY: { scrip: 25, seg: 'IDX_I', label: 'BANKNIFTY' },
  FINNIFTY: { scrip: 27, seg: 'IDX_I', label: 'FINNIFTY' },
  MIDCPNIFTY: { scrip: 442, seg: 'IDX_I', label: 'MIDCPNIFTY' },
  SENSEX: { scrip: 51, seg: 'BSE_I', label: 'SENSEX' },
};

class DhanProvider extends FoDataProvider {
  /**
   * @param {object} [options]
   * @param {object} [options.config] - { clientId, pin, totpSecret }
   * @param {string} [options.accessToken]
   * @param {string} [options.clientId]
   * @param {typeof fetch} [options.fetchImpl]
   * @param {() => number} [options.now]
   * @param {(ms: number) => Promise<void>} [options.sleep]
   * @param {number} [options.minIntervalMs]
   */
  constructor(options = {}) {
    super();
    this.name = 'dhan';
    this.config = options.config || null;
    this.accessToken = options.accessToken || null;
    this.clientId = options.clientId || options.config?.clientId || null;
    this.fetchImpl = options.fetchImpl || fetch;
    this.now = options.now || (() => Date.now());
    this.sleep = options.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.minIntervalMs = options.minIntervalMs ?? MIN_OPTION_CHAIN_INTERVAL_MS;
    this._lastOptionChainAt = 0;
    this._optionChainQueue = Promise.resolve();
  }

  async ensureToken() {
    if (this.accessToken && this.clientId) return this.accessToken;
    if (!this.config?.clientId || !this.config?.pin || !this.config?.totpSecret) {
      throw new Error('Dhan credentials missing: provide accessToken+clientId or config with clientId/pin/totpSecret');
    }
    const { accessToken } = await fetchAccessToken(this.config, this.fetchImpl);
    this.accessToken = accessToken;
    this.clientId = this.clientId || this.config.clientId;
    return this.accessToken;
  }

  _headers(token) {
    return {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'access-token': token,
      'client-id': String(this.clientId),
    };
  }

  resolveUnderlying(underlying) {
    const key = String(underlying || '').toUpperCase().replace(/\s+/g, '');
    const meta = UNDERLYINGS[key];
    if (!meta) throw new Error(`Unsupported Dhan underlying: ${underlying}`);
    return meta;
  }

  /**
   * Queue option-chain / expiry requests with min interval between unique calls.
   */
  _withOptionChainRateLimit(fn) {
    const run = this._optionChainQueue.then(async () => {
      const elapsed = this.now() - this._lastOptionChainAt;
      if (this._lastOptionChainAt > 0 && elapsed < this.minIntervalMs) {
        await this.sleep(this.minIntervalMs - elapsed);
      }
      this._lastOptionChainAt = this.now();
      return fn();
    });
    this._optionChainQueue = run.catch(() => {});
    return run;
  }

  async _postJson(url, body, label) {
    const token = await this.ensureToken();
    const resp = await this.fetchImpl(url, {
      method: 'POST',
      headers: this._headers(token),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(25000),
    });
    if (!resp.ok) {
      const errBody = await resp.text().catch(() => '');
      throw new Error(
        `Dhan ${label} failed: HTTP ${resp.status}${errBody ? ` ${errBody.slice(0, 160)}` : ''}`,
      );
    }
    const json = await resp.json();
    if (json?.status && String(json.status).toLowerCase() === 'failure') {
      throw new Error(`Dhan ${label} failed: ${json.remarks || json.message || 'status=failure'}`);
    }
    return json;
  }

  async getIndexQuotes(symbols = []) {
    const wanted = (symbols.length ? symbols : Object.keys(UNDERLYINGS))
      .map((s) => String(s).toUpperCase());
    const bySeg = {};
    const idToSymbol = new Map();

    for (const sym of wanted) {
      const u = UNDERLYINGS[sym];
      if (!u) continue;
      if (!bySeg[u.seg]) bySeg[u.seg] = [];
      bySeg[u.seg].push(u.scrip);
      idToSymbol.set(`${u.seg}:${u.scrip}`, sym);
    }

    if (!Object.keys(bySeg).length) {
      return dataEnvelope([], { source: 'dhan', isMock: false });
    }

    let body;
    try {
      body = await this._postJson(QUOTE_URL, bySeg, 'marketfeed/quote');
    } catch (err) {
      // SENSEX (BSE_I) may fail — retry without BSE when mixed with IDX
      if (bySeg.BSE_I && Object.keys(bySeg).length > 1) {
        const retry = { ...bySeg };
        delete retry.BSE_I;
        body = await this._postJson(QUOTE_URL, retry, 'marketfeed/quote');
      } else {
        throw err;
      }
    }

    const quotes = [];
    for (const [seg, instruments] of Object.entries(body?.data || {})) {
      for (const [secId, raw] of Object.entries(instruments || {})) {
        const symbol = idToSymbol.get(`${seg}:${Number(secId)}`)
          || idToSymbol.get(`${seg}:${secId}`)
          || String(secId);
        quotes.push(normalizeQuote({
          symbol,
          segment: seg,
          ...raw,
          open: raw?.ohlc?.open,
          high: raw?.ohlc?.high,
          low: raw?.ohlc?.low,
          prevClose: raw?.ohlc?.close,
          change: raw?.net_change,
          vwap: raw?.average_price,
        }, 'dhan'));
      }
    }
    return dataEnvelope(quotes, { source: 'dhan', isMock: false });
  }

  async getOptionExpiries(underlying) {
    const meta = this.resolveUnderlying(underlying);
    return this._withOptionChainRateLimit(async () => {
      const json = await this._postJson(
        EXPIRY_LIST_URL,
        { UnderlyingScrip: meta.scrip, UnderlyingSeg: meta.seg },
        'optionchain/expirylist',
      );
      const expiries = Array.isArray(json.data) ? json.data.map(String) : [];
      return dataEnvelope(expiries, { source: 'dhan', isMock: false });
    });
  }

  async getOptionChain(underlying, expiry) {
    const meta = this.resolveUnderlying(underlying);
    if (!expiry) throw new Error('expiry required');
    return this._withOptionChainRateLimit(async () => {
      const json = await this._postJson(
        OPTION_CHAIN_URL,
        {
          UnderlyingScrip: meta.scrip,
          UnderlyingSeg: meta.seg,
          Expiry: String(expiry),
        },
        'optionchain',
      );
      const asOf = new Date().toISOString();
      const chain = normalizeOptionChain(json, {
        underlying: meta.label,
        expiry: String(expiry),
        asOf,
        source: 'dhan',
      });
      return dataEnvelope(chain, { source: 'dhan', isMock: false, asOf });
    });
  }

  /**
   * Futures quotes via marketfeed/quote.
   * Accepts securityId numbers or { segment, securityId, symbol } objects.
   */
  async getFuturesQuotes(symbols = []) {
    if (!symbols.length) {
      return dataEnvelope([], { source: 'dhan', isMock: false });
    }

    const bySeg = {};
    const idMeta = new Map();

    for (const item of symbols) {
      if (item && typeof item === 'object') {
        const seg = item.segment || item.exchangeSegment || 'NSE_FNO';
        const sid = item.securityId ?? item.scrip;
        if (sid == null) continue;
        if (!bySeg[seg]) bySeg[seg] = [];
        bySeg[seg].push(Number(sid));
        idMeta.set(`${seg}:${Number(sid)}`, item.symbol || String(sid));
      } else {
        const sid = Number(item);
        if (!Number.isFinite(sid)) continue;
        if (!bySeg.NSE_FNO) bySeg.NSE_FNO = [];
        bySeg.NSE_FNO.push(sid);
        idMeta.set(`NSE_FNO:${sid}`, String(item));
      }
    }

    if (!Object.keys(bySeg).length) {
      throw new Error('Dhan getFuturesQuotes requires securityId numbers or {segment,securityId} objects');
    }

    const body = await this._postJson(QUOTE_URL, bySeg, 'marketfeed/quote');
    const quotes = [];
    for (const [seg, instruments] of Object.entries(body?.data || {})) {
      for (const [secId, raw] of Object.entries(instruments || {})) {
        const symbol = idMeta.get(`${seg}:${Number(secId)}`) || String(secId);
        quotes.push(normalizeQuote({
          symbol,
          segment: seg,
          ...raw,
          open: raw?.ohlc?.open,
          high: raw?.ohlc?.high,
          low: raw?.ohlc?.low,
          prevClose: raw?.ohlc?.close,
          change: raw?.net_change,
          vwap: raw?.average_price,
        }, 'dhan'));
      }
    }
    return dataEnvelope(quotes, { source: 'dhan', isMock: false });
  }

  async getFoUniverse() {
    return dataEnvelope({
      indices: INDEX_UNDERLYINGS.map((i) => i.id),
      underlyings: UNDERLYINGS,
      stocks: ALL_SECTOR_FO_SYMBOLS,
      sectors: SECTOR_FO_SYMBOLS,
    }, { source: 'dhan', isMock: false });
  }

  async getFiiDii() {
    return dataEnvelope({
      cash: null,
      futures: null,
      available: false,
      error: 'FII/DII is not provided by Dhan; use NseProvider',
    }, {
      source: 'dhan',
      isMock: false,
      error: 'FII/DII is not provided by Dhan; use NseProvider',
    });
  }
}

module.exports = {
  DhanProvider,
  UNDERLYINGS,
  MIN_OPTION_CHAIN_INTERVAL_MS,
  OPTION_CHAIN_URL,
  EXPIRY_LIST_URL,
  QUOTE_URL,
};
