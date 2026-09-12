'use strict';

/**
 * Resolve NSE F&O futures security ids from Dhan's public scrip master.
 * Trading symbols look like: RELIANCE-Sep2026-FUT, BAJAJ-AUTO-Oct2026-FUT, NIFTY-Sep2026-FUT.
 *
 * Cloudflare Workers cannot reliably download+parse the ~25MB scrip master
 * (CPU/memory limits) — that made Hybrid fall back to mock F&O prices.
 * We ship a compact bundled map and only optionally refresh from network
 * outside Cloudflare.
 */

const DHAN_SCRIP_MASTER_URL = 'https://images.dhan.co/api-data/api-scrip-master.csv';
const FETCH_TIMEOUT_MS = 60_000;
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const FUT_SYMBOL_RE = /^(.+)-([A-Za-z]{3}\d{4})-FUT$/;

/** @type {{ at: number, map: Map<string, object>, source: string } | null} */
let cache = null;

/** @type {Map<string, object>|null} */
let bundledMap = null;

function loadBundledMap() {
  if (bundledMap) return bundledMap;
  try {
    // eslint-disable-next-line import/no-unresolved, global-require
    const json = require('./data/futuresSecurityIds.json');
    const underlyings = json.underlyings || json.symbols || {};
    bundledMap = new Map(
      Object.entries(underlyings).map(([symbol, row]) => [String(symbol).toUpperCase(), row]),
    );
  } catch {
    bundledMap = new Map();
  }
  return bundledMap;
}

function isCloudflareRuntime() {
  const rt = String(process.env.POWERBULL_RUNTIME || '').toLowerCase();
  return rt === 'cloudflare' || rt === 'cloudflare-pages' || rt === 'workerd';
}

function parseExpiryDate(value) {
  if (!value) return null;
  const iso = String(value).trim().replace(' ', 'T');
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Pick the nearest monthly (preferred) / any futures contract with expiry >= asOf.
 * @param {Array<object>} contracts
 * @param {number} asOfMs
 */
function pickFrontMonth(contracts, asOfMs) {
  const upcoming = contracts
    .filter((c) => c.expiryMs != null && c.expiryMs >= asOfMs)
    .sort((a, b) => a.expiryMs - b.expiryMs || Number(a.securityId) - Number(b.securityId));

  const monthly = upcoming.filter((c) => c.expiryFlag === 'M');
  return monthly[0] || upcoming[0] || null;
}

function isFuturesInstrument(name) {
  const n = String(name || '').toUpperCase();
  return n === 'FUTSTK' || n === 'FUTIDX';
}

/**
 * Parse Dhan scrip-master CSV into underlying → front-month futures security id.
 * @param {string} csvText
 * @param {object} [options]
 * @param {Date|number|string} [options.asOf]
 * @param {Iterable<string>|null} [options.symbols] - optional allow-list
 * @returns {Map<string, { securityId: number, segment: string, expiry: string|null, instrument: string, tradingSymbol: string }>}
 */
function parseFuturesSecurityMap(csvText, { asOf = new Date(), symbols = null } = {}) {
  const asOfMs = new Date(asOf).setHours(0, 0, 0, 0);
  const allow = symbols
    ? new Set([...symbols].map((s) => String(s).toUpperCase()))
    : null;

  const lines = String(csvText || '').split(/\r?\n/);
  if (!lines.length) return new Map();

  const header = lines[0].split(',');
  const idx = {
    exch: header.indexOf('SEM_EXM_EXCH_ID'),
    seg: header.indexOf('SEM_SEGMENT'),
    securityId: header.indexOf('SEM_SMST_SECURITY_ID'),
    instrument: header.indexOf('SEM_INSTRUMENT_NAME'),
    tradingSymbol: header.indexOf('SEM_TRADING_SYMBOL'),
    expiryDate: header.indexOf('SEM_EXPIRY_DATE'),
    expiryFlag: header.indexOf('SEM_EXPIRY_FLAG'),
  };

  /** @type {Map<string, Array<object>>} */
  const byUnderlying = new Map();

  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line) continue;
    const cols = line.split(',');
    if (cols.length < header.length) continue;
    if (cols[idx.exch] !== 'NSE' || cols[idx.seg] !== 'D') continue;

    const instrument = cols[idx.instrument];
    if (!isFuturesInstrument(instrument)) continue;

    const tradingSymbol = cols[idx.tradingSymbol] || '';
    const match = FUT_SYMBOL_RE.exec(tradingSymbol);
    if (!match) continue;

    const underlying = match[1].toUpperCase();
    if (allow && !allow.has(underlying)) continue;

    const securityId = Number(cols[idx.securityId]);
    if (!Number.isFinite(securityId)) continue;

    const expiryRaw = cols[idx.expiryDate] || null;
    const row = {
      underlying,
      securityId,
      instrument,
      tradingSymbol,
      expiryFlag: cols[idx.expiryFlag] || '',
      expiryRaw,
      expiryMs: parseExpiryDate(expiryRaw),
    };

    if (!byUnderlying.has(underlying)) byUnderlying.set(underlying, []);
    byUnderlying.get(underlying).push(row);
  }

  const out = new Map();
  for (const [underlying, contracts] of byUnderlying) {
    const picked = pickFrontMonth(contracts, asOfMs);
    if (!picked) continue;
    out.set(underlying, {
      securityId: picked.securityId,
      segment: 'NSE_FNO',
      expiry: picked.expiryRaw,
      instrument: picked.instrument,
      tradingSymbol: picked.tradingSymbol,
    });
  }
  return out;
}

async function fetchScripMaster(fetchImpl = fetch) {
  const resp = await fetchImpl(DHAN_SCRIP_MASTER_URL, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!resp.ok) {
    throw new Error(`Failed to fetch Dhan scrip master: HTTP ${resp.status}`);
  }
  return resp.text();
}

function filterMap(full, want) {
  const filtered = new Map();
  for (const sym of want) {
    const hit = full.get(sym);
    if (hit) filtered.set(sym, hit);
  }
  return filtered;
}

/**
 * Load front-month futures security ids for the requested symbols.
 * Prefer the bundled compact map on Cloudflare (and as network fallback).
 *
 * @param {Iterable<string>} symbols
 * @param {typeof fetch} [fetchImpl]
 * @param {object} [options]
 * @param {boolean} [options.forceRefresh] - attempt network refresh (ignored on CF)
 * @param {Date} [options.asOf]
 * @param {boolean} [options.allowNetwork]
 */
async function loadFuturesSecurityMap(symbols, fetchImpl = fetch, options = {}) {
  const want = [...symbols].map((s) => String(s).toUpperCase());
  const now = Date.now();

  if (!options.forceRefresh && cache && now - cache.at < CACHE_TTL_MS) {
    return filterMap(cache.map, want);
  }

  const allowNetwork = options.allowNetwork === true
    || process.env.FNO_REFRESH_SECURITY_MAP === '1'
    || (options.forceRefresh && !isCloudflareRuntime());

  // Cloudflare (and default path): use bundled map — never pull 25MB CSV in-worker.
  if (isCloudflareRuntime() || !allowNetwork) {
    const bundled = loadBundledMap();
    cache = { at: now, map: bundled, source: 'bundled' };
    return filterMap(bundled, want);
  }

  try {
    const csv = await fetchScripMaster(fetchImpl);
    const full = parseFuturesSecurityMap(csv, { asOf: options.asOf || new Date() });
    cache = { at: now, map: full, source: 'network' };
    return filterMap(full, want);
  } catch (err) {
    const bundled = loadBundledMap();
    if (!bundled.size) throw err;
    cache = { at: now, map: bundled, source: `bundled-fallback:${err.message}` };
    return filterMap(bundled, want);
  }
}

function clearFuturesSecurityMapCache() {
  cache = null;
}

/**
 * @param {Iterable<string>} symbols
 * @param {Map<string, object>} map
 * @returns {Array<{ symbol: string, securityId: number, segment: string }>}
 */
function toQuoteRequests(symbols, map) {
  const out = [];
  for (const raw of symbols) {
    const symbol = String(raw).toUpperCase();
    const hit = map.get(symbol);
    if (!hit) continue;
    out.push({
      symbol,
      securityId: hit.securityId,
      segment: hit.segment || 'NSE_FNO',
    });
  }
  return out;
}

module.exports = {
  DHAN_SCRIP_MASTER_URL,
  FUT_SYMBOL_RE,
  parseFuturesSecurityMap,
  loadFuturesSecurityMap,
  clearFuturesSecurityMapCache,
  toQuoteRequests,
  pickFrontMonth,
  loadBundledMap,
  isCloudflareRuntime,
};
