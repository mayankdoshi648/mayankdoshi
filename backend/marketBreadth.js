const fs = require('node:fs');
const path = require('node:path');
const { computeSMA } = require('./indicators');
const { fetchDailyCandles, fetchYahooDailyCandles } = require('./darvaxData');
const { resolveNseInstrumentMap, parseNifty50Csv, NIFTY500_CSV_URL } = require('./instrumentMap');
const { fetchAccessToken } = require('./dhanAuth');

const CACHE_DIR = path.join(__dirname, '..', 'data');
const CACHE_FILE = path.join(CACHE_DIR, 'breadth-cache.json');
const NIFTY50_CSV_URL = 'https://archives.nseindia.com/content/indices/ind_nifty50list.csv';
const INDEX_YAHOO = '^NSEI';
const DEFAULT_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const TREND_LOOKBACK = 5;
const TREND_THRESHOLD_PP = 2; // percentage points

const UNIVERSE_SIZES = {
  nifty50: 50,
  nifty500: 500,
};

function loadNse500Universe() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'universe', 'nse500.json'), 'utf8'));
}

async function fetchNifty50Symbols(fetchImpl = fetch) {
  const resp = await fetchImpl(NIFTY50_CSV_URL, {
    headers: { 'User-Agent': 'Mozilla/5.0 PowerBullPro/1.0' },
    signal: AbortSignal.timeout(15000),
  });
  if (!resp.ok) throw new Error(`Nifty 50 list failed: HTTP ${resp.status}`);
  return parseNifty50Csv(await resp.text());
}

async function resolveUniverse(universe = 'nifty50', fetchImpl = fetch) {
  if (universe === 'nifty500') return loadNse500Universe();
  try {
    return await fetchNifty50Symbols(fetchImpl);
  } catch {
    return loadNse500Universe().slice(0, 50);
  }
}

function dateKey(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Per stock, compute whether close is above SMA(period) on each trading day.
 * Uses each stock's own continuous series (avoids calendar-gap SMA corruption).
 */
function aboveSmaByDate(candles, period) {
  const closes = candles.map((c) => c.close);
  const sma = computeSMA(closes, period);
  const map = new Map();
  for (let i = 0; i < candles.length; i++) {
    if (sma[i] == null) continue;
    map.set(dateKey(candles[i].time), candles[i].close > sma[i]);
  }
  return map;
}

/**
 * For each index date, % of stocks trading above SMA(period).
 */
function breadthSeriesFromMaps(dates, aboveMaps) {
  return dates.map((d) => {
    let above = 0;
    let counted = 0;
    for (const map of aboveMaps) {
      if (!map.has(d)) continue;
      counted += 1;
      if (map.get(d)) above += 1;
    }
    return counted === 0 ? null : (above / counted) * 100;
  });
}

/** @deprecated Prefer breadthSeriesFromMaps — kept for unit tests with dense matrices. */
function breadthSeries(matrix, period) {
  const n = matrix.size ? matrix.values().next().value.length : 0;
  const dates = Array.from({ length: n }, (_, i) => String(i));
  const aboveMaps = [];
  for (const closes of matrix.values()) {
    const map = new Map();
    const sma = computeSMA(closes, period);
    for (let i = 0; i < closes.length; i++) {
      if (sma[i] == null || closes[i] == null) continue;
      map.set(dates[i], closes[i] > sma[i]);
    }
    aboveMaps.push(map);
  }
  return breadthSeriesFromMaps(dates, aboveMaps);
}

function alignIndex(indexCandles) {
  return {
    dates: indexCandles.map((c) => dateKey(c.time)),
    indexCloses: indexCandles.map((c) => c.close),
  };
}

function detectTrend(series, lookback = TREND_LOOKBACK, threshold = TREND_THRESHOLD_PP) {
  const valid = [];
  for (let i = series.length - 1; i >= 0 && valid.length < lookback + 1; i--) {
    if (series[i] != null) valid.push(series[i]);
  }
  if (valid.length < 2) return 'flat';
  const current = valid[0];
  const prior = valid[Math.min(lookback, valid.length - 1)];
  const delta = current - prior;
  if (delta <= -threshold) return 'down';
  if (delta >= threshold) return 'up';
  return 'flat';
}

function latestValue(series) {
  for (let i = series.length - 1; i >= 0; i--) {
    if (series[i] != null) return { value: series[i], index: i };
  }
  return { value: null, index: -1 };
}

/**
 * Posture rules from Market Breadth Decoded:
 * 1. 20↓ 50→ 200→ → STOP PRESSING
 * 2. 20→ 50↓ 200↓ → REDUCE RISK
 * 3. 20↓ 50↓ 200↓ → SIT OUT
 * 4. all > 50% → GREEN LIGHT — PRESS
 * Checked bearish-first so simultaneous matches prefer caution.
 */
function diagnosePosture({ dma20, dma50, dma200, trend20, trend50, trend200 }) {
  const allDown = trend20 === 'down' && trend50 === 'down' && trend200 === 'down';
  if (allDown) {
    return {
      code: 'SIT_OUT',
      posture: 'SIT OUT',
      diagnosis: 'The rally lacks broad support.',
      whatChanged: 'All three fall together',
      tone: 'danger',
    };
  }

  if (trend50 === 'down' && trend200 === 'down' && (trend20 === 'flat' || trend20 === 'up')) {
    return {
      code: 'REDUCE_RISK',
      posture: 'REDUCE RISK',
      diagnosis: 'Weaker stocks are rolling over. The junk rally is ending.',
      whatChanged: '50- and 200-day breadth drop',
      tone: 'danger',
    };
  }

  if (trend20 === 'down' && trend50 === 'flat' && trend200 === 'flat') {
    return {
      code: 'STOP_PRESSING',
      posture: 'STOP PRESSING',
      diagnosis: 'Leaders are cracking. First warning.',
      whatChanged: 'Only 20-day breadth drops',
      tone: 'warn',
    };
  }

  if (dma20 != null && dma50 != null && dma200 != null && dma20 > 50 && dma50 > 50 && dma200 > 50) {
    return {
      code: 'GREEN_LIGHT',
      posture: 'GREEN LIGHT — PRESS',
      diagnosis: 'Participation is broad enough to support a sustainable move.',
      whatChanged: 'All three are above 50%',
      tone: 'good',
    };
  }

  return {
    code: 'MIXED',
    posture: 'STAY SELECTIVE',
    diagnosis: 'Breadth is mixed — no clear all-clear or all-stop signal.',
    whatChanged: 'Readings do not match a primary posture rule',
    tone: 'neutral',
  };
}

function arrowForTrend(trend) {
  if (trend === 'down') return '↓';
  if (trend === 'up') return '↑';
  return '→';
}

async function mapPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const i = next;
      next += 1;
      results[i] = await worker(items[i], i);
    }
  }
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, () => run());
  await Promise.all(runners);
  return results;
}

async function prepareDhanContext(symbols, config, fetchImpl) {
  if (!config?.clientId || !config?.pin || !config?.totpSecret) return null;
  try {
    const { accessToken } = await fetchAccessToken(config, fetchImpl);
    const instrumentMap = await resolveNseInstrumentMap(symbols, fetchImpl);
    return { accessToken, clientId: config.clientId, instrumentMap, strict: false };
  } catch {
    return null;
  }
}

async function fetchUniverseCandles(symbols, options = {}) {
  const {
    fetchImpl = fetch,
    config = null,
    concurrency = 16,
    onProgress = null,
    range = '1y',
  } = options;

  const dhan = await prepareDhanContext(symbols, config, fetchImpl);
  const instrumentMap = dhan?.instrumentMap ?? null;
  let done = 0;
  let errors = 0;

  const pairs = await mapPool(symbols, concurrency, async (symbol) => {
    try {
      const candles = await fetchDailyCandles(symbol, 'NSE', {
        range,
        fetchImpl,
        dhan,
        instrumentMap,
      });
      done += 1;
      if (onProgress) onProgress({ done, total: symbols.length, symbol, ok: true });
      return [symbol, candles];
    } catch {
      errors += 1;
      done += 1;
      if (onProgress) onProgress({ done, total: symbols.length, symbol, ok: false });
      return [symbol, null];
    }
  });

  const candlesBySymbol = new Map();
  for (const [symbol, candles] of pairs) {
    if (candles && candles.length >= 200) candlesBySymbol.set(symbol, candles);
  }
  return { candlesBySymbol, errors, dataSource: dhan ? 'dhan+yahoo' : 'yahoo' };
}

function buildBreadthReport({
  dates,
  indexCloses,
  candlesBySymbol,
  universe,
  dataSource,
  errors,
  scannedAt,
}) {
  const maps20 = [];
  const maps50 = [];
  const maps200 = [];
  for (const candles of candlesBySymbol.values()) {
    maps20.push(aboveSmaByDate(candles, 20));
    maps50.push(aboveSmaByDate(candles, 50));
    maps200.push(aboveSmaByDate(candles, 200));
  }
  const dma20Series = breadthSeriesFromMaps(dates, maps20);
  const dma50Series = breadthSeriesFromMaps(dates, maps50);
  const dma200Series = breadthSeriesFromMaps(dates, maps200);

  const cur20 = latestValue(dma20Series);
  const cur50 = latestValue(dma50Series);
  const cur200 = latestValue(dma200Series);

  const trend20 = detectTrend(dma20Series);
  const trend50 = detectTrend(dma50Series);
  const trend200 = detectTrend(dma200Series);

  const diagnosis = diagnosePosture({
    dma20: cur20.value,
    dma50: cur50.value,
    dma200: cur200.value,
    trend20,
    trend50,
    trend200,
  });

  // Keep last ~1 year of points for charts (trim nulls at start of 200DMA)
  const start = Math.max(0, dates.length - 260);
  const slice = (arr) => arr.slice(start).map((v) => (v == null ? null : Number(v.toFixed(2))));

  return {
    scannedAt,
    universe,
    stockCount: candlesBySymbol.size,
    errors,
    dataSource,
    asOf: dates[cur20.index] || dates[dates.length - 1] || null,
    gauges: {
      dma20: {
        label: '20 DMA — LEADERS',
        subtitle: 'Short-term health',
        value: cur20.value == null ? null : Number(cur20.value.toFixed(1)),
        trend: trend20,
        arrow: arrowForTrend(trend20),
      },
      dma50: {
        label: '50 DMA — CORE',
        subtitle: 'Medium-term health',
        value: cur50.value == null ? null : Number(cur50.value.toFixed(1)),
        trend: trend50,
        arrow: arrowForTrend(trend50),
      },
      dma200: {
        label: '200 DMA — FOUNDATION',
        subtitle: 'Long-term health',
        value: cur200.value == null ? null : Number(cur200.value.toFixed(1)),
        trend: trend200,
        arrow: arrowForTrend(trend200),
      },
    },
    diagnosis,
    series: {
      dates: dates.slice(start),
      index: slice(indexCloses),
      breadth20: slice(dma20Series),
      breadth50: slice(dma50Series),
      breadth200: slice(dma200Series),
    },
    rules: [
      { reading: '20 ↓, 50 →, 200 →', posture: 'STOP PRESSING', tone: 'warn' },
      { reading: '20 →, 50 ↓, 200 ↓', posture: 'REDUCE RISK', tone: 'danger' },
      { reading: '20 ↓, 50 ↓, 200 ↓', posture: 'SIT OUT', tone: 'danger' },
      { reading: '20, 50, 200 > 50%', posture: 'GREEN LIGHT — PRESS', tone: 'good' },
    ],
  };
}

async function computeMarketBreadth(options = {}) {
  const {
    universe = 'nifty50',
    fetchImpl = fetch,
    config = null,
    concurrency = 16,
    onProgress = null,
  } = options;

  const symbols = await resolveUniverse(universe, fetchImpl);
  const indexCandles = await fetchYahooDailyCandles(INDEX_YAHOO, 'US', '1y', fetchImpl);
  if (indexCandles.length < 200) throw new Error('Insufficient Nifty index history');

  const { candlesBySymbol, errors, dataSource } = await fetchUniverseCandles(symbols, {
    fetchImpl,
    config,
    concurrency,
    onProgress,
  });

  if (candlesBySymbol.size < 10) {
    throw new Error(`Too few stocks with enough history (${candlesBySymbol.size}). Try again later.`);
  }

  const { dates, indexCloses } = alignIndex(indexCandles);
  return buildBreadthReport({
    dates,
    indexCloses,
    candlesBySymbol,
    universe,
    dataSource,
    errors,
    scannedAt: new Date().toISOString(),
  });
}

function readBreadthCache() {
  try {
    if (!fs.existsSync(CACHE_FILE)) return null;
    return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function writeBreadthCache(report) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(CACHE_FILE, JSON.stringify(report));
}

function isCacheFresh(cache, universe, ttlMs = DEFAULT_CACHE_TTL_MS) {
  if (!cache || cache.universe !== universe || !cache.scannedAt) return false;
  return Date.now() - new Date(cache.scannedAt).getTime() < ttlMs;
}

/** In-flight refresh so concurrent API calls share one scan. */
let refreshPromise = null;
let refreshUniverse = null;

function isRefreshRunning(universe = null) {
  if (!refreshPromise) return false;
  if (universe == null) return true;
  return refreshUniverse === universe;
}

/**
 * Start a breadth recompute without awaiting (shared in-flight promise).
 * Returns the promise for optional awaiting.
 */
function startBreadthRefresh(options = {}) {
  const { universe = 'nifty50', ...rest } = options;
  if (refreshPromise && refreshUniverse === universe) return refreshPromise;
  refreshUniverse = universe;
  refreshPromise = computeMarketBreadth({ universe, concurrency: 16, ...rest })
    .then((report) => {
      writeBreadthCache(report);
      return report;
    })
    .finally(() => {
      refreshPromise = null;
      refreshUniverse = null;
    });
  return refreshPromise;
}

/**
 * Fast path: return cache immediately when possible.
 * - force=false + fresh cache → cache
 * - force=false + stale/missing cache → return stale if any, else await compute
 * - force=true + cache exists → return cache + kick background refresh (non-blocking)
 * - force=true + no cache → await compute
 */
async function getMarketBreadth(options = {}) {
  const {
    universe = 'nifty50',
    force = false,
    ttlMs = DEFAULT_CACHE_TTL_MS,
    background = true,
    ...rest
  } = options;

  const cached = readBreadthCache();
  const fresh = isCacheFresh(cached, universe, ttlMs);
  const sameUniverse = cached && cached.universe === universe;

  if (!force && fresh) {
    return { ...cached, fromCache: true, refreshing: isRefreshRunning(universe) };
  }

  // Prefer instant response from any same-universe cache
  if (sameUniverse && background) {
    if (force || !fresh) {
      startBreadthRefresh({ universe, ...rest });
    }
    return {
      ...cached,
      fromCache: true,
      refreshing: true,
      stale: !fresh,
    };
  }

  // No usable cache — must wait (first run)
  if (refreshPromise && refreshUniverse === universe) {
    const report = await refreshPromise;
    return { ...report, fromCache: false, refreshing: false };
  }

  const report = await startBreadthRefresh({ universe, ...rest });
  return { ...report, fromCache: false, refreshing: false };
}

module.exports = {
  computeSMA,
  alignIndex,
  aboveSmaByDate,
  breadthSeriesFromMaps,
  breadthSeries,
  detectTrend,
  diagnosePosture,
  arrowForTrend,
  buildBreadthReport,
  computeMarketBreadth,
  getMarketBreadth,
  startBreadthRefresh,
  isRefreshRunning,
  readBreadthCache,
  writeBreadthCache,
  isCacheFresh,
  resolveUniverse,
  fetchNifty50Symbols,
  UNIVERSE_SIZES,
  TREND_LOOKBACK,
  TREND_THRESHOLD_PP,
  CACHE_FILE,
  NIFTY50_CSV_URL,
  NIFTY500_CSV_URL,
};
