'use strict';

const { FoDataProvider, BaseProvider } = require('./base');
const { DhanProvider, UNDERLYINGS } = require('./dhanProvider');
const { NseProvider, NsePublicProvider } = require('./nseProvider');
const { MockProvider } = require('./mockProvider');
const { dataEnvelope } = require('../normalize');
const {
  ALL_SECTOR_FO_SYMBOLS,
  SYMBOL_TO_SECTOR,
  sectorForSymbol,
} = require('../universe/sectors');
const {
  loadFuturesSecurityMap,
  toQuoteRequests,
} = require('../futuresSecurityMap');
const { createOiCache } = require('../../oiCache');
const { validateQuote } = require('../../priceValidation');

/**
 * Hybrid: NSE for public indices / FII-DII, Dhan for option chain & futures.
 * Falls back to labeled mock when a Dhan chain call fails.
 */
class HybridProvider extends FoDataProvider {
  /**
   * @param {object} options
   * @param {NseProvider} options.nse
   * @param {DhanProvider} options.dhan
   * @param {MockProvider} options.mock
   * @param {typeof loadFuturesSecurityMap} [options.loadFuturesMap]
   * @param {string[]} [options.defaultSymbols]
   * @param {{ get: Function, setMany: Function }} [options.oiCache]
   * @param {{ recordEnvelope?: Function }} [options.dataSources]
   */
  constructor({
    nse,
    dhan,
    mock,
    loadFuturesMap = loadFuturesSecurityMap,
    defaultSymbols = ALL_SECTOR_FO_SYMBOLS,
    oiCache = createOiCache(),
    dataSources = null,
  } = {}) {
    super();
    this.name = 'hybrid';
    this.nse = nse;
    this.dhan = dhan;
    this.mock = mock;
    this.loadFuturesMap = loadFuturesMap;
    this.defaultSymbols = defaultSymbols;
    this.oiCache = oiCache;
    this.dataSources = dataSources;
    /** @type {Map<string, number>} */
    this._prevOiBySymbol = new Map();
  }

  _track(source, envelope) {
    if (this.dataSources?.recordEnvelope) this.dataSources.recordEnvelope(source, envelope);
    return envelope;
  }

  async getIndexQuotes(symbols) {
    try {
      const env = await this.nse.getIndexQuotes(symbols);
      return this._track('nse', env);
    } catch (err) {
      const fallback = await this.mock.getIndexQuotes(symbols);
      return this._track('nse', dataEnvelope(fallback.data, {
        ...fallback.meta,
        isMock: true,
        warning: `NSE indices failed; using mock (${err.message})`,
        error: err.message,
      }));
    }
  }

  async getOptionExpiries(underlying) {
    try {
      const env = await this.dhan.getOptionExpiries(underlying);
      return this._track('dhan', env);
    } catch (err) {
      const fallback = await this.mock.getOptionExpiries(underlying);
      return this._track('dhan', dataEnvelope(fallback.data, {
        ...fallback.meta,
        isMock: true,
        warning: `Dhan expiries failed; using mock (${err.message})`,
        error: err.message,
      }));
    }
  }

  async getOptionChain(underlying, expiry) {
    try {
      const env = await this.dhan.getOptionChain(underlying, expiry);
      return this._track('dhan', env);
    } catch (err) {
      const fallback = await this.mock.getOptionChain(underlying, expiry);
      return this._track('dhan', dataEnvelope(fallback.data, {
        ...fallback.meta,
        isMock: true,
        warning: `Dhan option chain failed; using mock (${err.message})`,
        error: err.message,
      }));
    }
  }

  /**
   * Resolve string symbols (or empty = full FO universe) to Dhan security ids,
   * then fetch live futures quotes. Falls back to labeled mock only if mapping/API fails.
   */
  async getFuturesQuotes(symbols) {
    try {
      const resolved = await this._resolveFuturesRequests(symbols);
      if (!resolved.length) {
        const fallback = await this.mock.getFuturesQuotes(symbols);
        return this._track('dhan', dataEnvelope(fallback.data, {
          ...fallback.meta,
          isMock: true,
          warning: 'Dhan futures security-id map returned no contracts; using mock',
        }));
      }

      const env = await this.dhan.getFuturesQuotes(resolved);
      const enriched = this._enrichFuturesRows(env.data || []);
      return this._track('dhan', dataEnvelope(enriched, {
        ...env.meta,
        source: env.meta?.source || 'dhan',
        isMock: false,
        mappedCount: resolved.length,
      }));
    } catch (err) {
      const fallback = await this.mock.getFuturesQuotes(symbols);
      return this._track('dhan', dataEnvelope(fallback.data, {
        ...fallback.meta,
        isMock: true,
        warning: `Dhan futures failed; using mock (${err.message})`,
        error: err.message,
      }));
    }
  }

  async _resolveFuturesRequests(symbols) {
    // Already security-id objects / numbers — pass through.
    if (Array.isArray(symbols) && symbols.length && symbols.every((s) => (
      typeof s === 'number'
      || (s && typeof s === 'object' && (s.securityId != null || s.scrip != null))
    ))) {
      return symbols;
    }

    const want = (Array.isArray(symbols) && symbols.length)
      ? symbols.map((s) => String(typeof s === 'object' ? (s.symbol || s) : s).toUpperCase())
      : [...this.defaultSymbols];

    const map = await this.loadFuturesMap(want);
    return toQuoteRequests(want, map);
  }

  _enrichFuturesRows(rows) {
    const enriched = rows.map((q) => {
      const symbol = String(q.symbol || '').toUpperCase();
      const priceChangePct = q.changePct ?? null;

      let oiChangePct = null;
      let oiChange = q.oiChange ?? null;
      if (q.oi != null && Number.isFinite(Number(q.oi))) {
        const oi = Number(q.oi);
        const prevOi = this._prevOiBySymbol.get(symbol) ?? this.oiCache?.get?.(symbol);
        if (prevOi != null && prevOi > 0 && prevOi !== oi) {
          oiChange = oi - prevOi;
          oiChangePct = Number((((oi - prevOi) / prevOi) * 100).toFixed(4));
        } else if (prevOi != null && prevOi > 0 && prevOi === oi) {
          oiChange = 0;
          oiChangePct = 0;
        }
        this._prevOiBySymbol.set(symbol, oi);
      }

      const vwap = q.vwap;
      const ltp = q.ltp;
      let vwapRelation = null;
      if (ltp != null && vwap != null) vwapRelation = ltp >= vwap ? 'above' : 'below';

      const row = {
        ...q,
        symbol,
        oiChange,
        priceChangePct,
        oiChangePct,
        relativeVolume: q.relativeVolume ?? null,
        vwapRelation,
        ivChangePct: q.ivChangePct ?? null,
        pcr: q.pcr ?? null,
        high52w: q.high52w ?? null,
        low52w: q.low52w ?? null,
        sector: SYMBOL_TO_SECTOR[symbol] || sectorForSymbol(symbol),
        label: 'LIVE',
      };
      const check = validateQuote(row);
      row.dataQuality = check.quality;
      row.dataIssues = check.issues;
      return row;
    });
    this.oiCache?.setMany?.(enriched);
    return enriched;
  }

  async getFoUniverse() {
    return this.mock.getFoUniverse();
  }

  async getFiiDii() {
    try {
      const env = await this.nse.getFiiDii();
      return this._track('nse', env);
    } catch (err) {
      return this._track('nse', dataEnvelope({
        cash: null,
        futures: null,
        available: false,
        error: err.message,
      }, {
        source: 'nse',
        isMock: false,
        error: err.message,
        warning: `NSE FII/DII unavailable (${err.message})`,
      }));
    }
  }

  async getSectorReturns() {
    return this.mock.getSectorReturns();
  }
}

function hasDhanCreds(config = {}) {
  if (config.accessToken && (config.clientId || config.dhanClientId)) return true;
  return Boolean(config.clientId && config.pin && config.totpSecret);
}

/**
 * Factory: Dhan creds present → hybrid (NSE public + Dhan chain); else Mock.
 * Hybrid option-chain failures fall back to mock with isMock:true + warning.
 *
 * @param {object} [options]
 * @param {object} [options.config]
 * @param {boolean} [options.preferMock]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {string} [options.accessToken]
 * @param {string} [options.clientId]
 * @returns {FoDataProvider}
 */
function createProvider({
  config = {},
  preferMock = false,
  fetchImpl = globalThis.fetch?.bind(globalThis),
  accessToken,
  clientId,
  dataSources = null,
  oiCache = null,
} = {}) {
  const mock = new MockProvider();
  if (preferMock || process.env.FNO_FORCE_MOCK === '1') return mock;

  const cfg = {
    ...config,
    accessToken: accessToken || config.accessToken,
    clientId: clientId || config.clientId || config.dhanClientId,
  };

  if (!hasDhanCreds(cfg)) {
    return mock;
  }

  const httpFetch = fetchImpl || globalThis.fetch.bind(globalThis);
  const nse = new NseProvider({ fetchImpl: httpFetch });
  const dhan = new DhanProvider({
    config: cfg.pin && cfg.totpSecret ? cfg : null,
    accessToken: cfg.accessToken,
    clientId: cfg.clientId,
    fetchImpl: httpFetch,
  });

  return new HybridProvider({
    nse,
    dhan,
    mock,
    dataSources,
    oiCache: oiCache || createOiCache(),
  });
}

module.exports = {
  createProvider,
  HybridProvider,
  hasDhanCreds,
  FoDataProvider,
  BaseProvider,
  DhanProvider,
  NseProvider,
  NsePublicProvider,
  MockProvider,
  UNDERLYINGS,
};
