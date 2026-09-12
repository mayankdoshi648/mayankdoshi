'use strict';

/**
 * Central instrument mapping for Cash / Futures / Options.
 * UI and engines should resolve symbols here — not hard-code security ids.
 */

const { UNDERLYINGS } = require('./providers/dhanProvider');
const {
  loadFuturesSecurityMap,
  toQuoteRequests,
} = require('./futuresSecurityMap');
const { loadDhanScripMaster } = require('../instrumentMap');

const KINDS = ['CASH', 'FUTURES', 'OPTION', 'CE', 'PE', 'INDEX'];

/**
 * @typedef {object} InstrumentRef
 * @property {string} symbol
 * @property {string} exchange
 * @property {string} exchangeSegment
 * @property {string|number|null} securityId
 * @property {string} instrumentType
 * @property {string|null} expiry
 * @property {number|null} strike
 * @property {string|null} optionType
 * @property {string} source
 */

/**
 * @param {string} symbol
 * @param {object} [options]
 * @param {string} [options.kind]
 * @param {object} [options.config]
 * @param {typeof fetch} [options.fetchImpl]
 * @returns {Promise<InstrumentRef|null>}
 */
async function resolveInstrument(symbol, {
  kind = 'FUTURES',
  config = null,
  fetchImpl = fetch,
  expiry = null,
  strike = null,
  optionType = null,
} = {}) {
  const sym = String(symbol || '').trim().toUpperCase();
  if (!sym) return null;
  const k = String(kind || 'FUTURES').toUpperCase();

  if (k === 'INDEX' || (k === 'CASH' && UNDERLYINGS[sym])) {
    const meta = UNDERLYINGS[sym];
    if (!meta) return null;
    return {
      symbol: sym,
      exchange: meta.seg === 'BSE_I' ? 'BSE' : 'NSE',
      exchangeSegment: meta.seg,
      securityId: meta.scrip,
      instrumentType: 'INDEX',
      expiry: null,
      strike: null,
      optionType: null,
      source: 'static-index-map',
    };
  }

  if (k === 'FUTURES' || k === 'FUT') {
    const map = await loadFuturesSecurityMap([sym], fetchImpl);
    const hit = map.get(sym);
    if (!hit) return null;
    return {
      symbol: sym,
      exchange: 'NSE',
      exchangeSegment: hit.segment || 'NSE_FNO',
      securityId: hit.securityId,
      instrumentType: hit.instrument || 'FUTSTK',
      expiry: hit.expiry || null,
      strike: null,
      optionType: null,
      source: 'dhan-scrip-master',
      tradingSymbol: hit.tradingSymbol || null,
    };
  }

  if (k === 'CASH' || k === 'EQ') {
    const bySymbol = await loadDhanScripMaster(fetchImpl);
    const securityId = bySymbol.get(sym);
    if (!securityId) return null;
    return {
      symbol: sym,
      exchange: 'NSE',
      exchangeSegment: 'NSE_EQ',
      securityId,
      instrumentType: 'EQUITY',
      expiry: null,
      strike: null,
      optionType: null,
      source: 'dhan-scrip-master',
    };
  }

  if (k === 'OPTION' || k === 'CE' || k === 'PE') {
    const index = UNDERLYINGS[sym];
    return {
      symbol: sym,
      exchange: index?.seg === 'BSE_I' ? 'BSE' : 'NSE',
      exchangeSegment: index?.seg || 'NSE_FNO',
      securityId: index?.scrip ?? null,
      instrumentType: 'OPTION',
      expiry: expiry || null,
      strike: strike != null ? Number(strike) : null,
      optionType: (optionType || (k === 'CE' || k === 'PE' ? k : null)),
      source: index ? 'static-index-map' : 'unresolved',
      note: 'Option legs are resolved via Dhan option-chain API; this maps the underlying.',
      configPresent: Boolean(config?.accessToken || config?.clientId),
    };
  }

  return null;
}

function listKinds() {
  return [...KINDS];
}

function futuresQuoteRequests(symbols, map) {
  return toQuoteRequests(symbols, map);
}

module.exports = {
  resolveInstrument,
  listKinds,
  futuresQuoteRequests,
  KINDS,
};
