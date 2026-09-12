// backend/stockDashboard.js — Indian stock market dashboard (Dhan + demo)
const fs = require('node:fs');
const path = require('node:path');
const { fetchDhanDailyCandles } = require('./dhanHistorical');
const { fetchOhlcQuotes, fetchFullQuotes, isRateLimitError } = require('./dhanQuotes');
const { compute52WeekStats } = require('./week52');
const { resolveDashboardUniverse, shortenSector, fetchIndexUniverse } = require('./sectorUniverse');

const CACHE_DIR = path.join(__dirname, '..', 'data');
const CACHE_FILE = path.join(CACHE_DIR, 'dashboard-cache.json');
const CACHE_VERSION = 2;
const QUOTE_TTL_MS = 60 * 1000;
/** Longer cache on CF / lite mode to avoid Dhan 429s. */
const QUOTE_TTL_LITE_MS = 180 * 1000;
const WEEK52_TTL_MS = 12 * 60 * 60 * 1000;

const RANKINGS = ['gainers', 'losers', 'near52wHigh', 'near52wLow', 'volume', 'all'];

function ensureCacheDir() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function readDiskCache() {
  try {
    if (!fs.existsSync(CACHE_FILE)) return null;
    const parsed = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    if (parsed?.version !== CACHE_VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeDiskCache(payload) {
  try {
    ensureCacheDir();
    fs.writeFileSync(CACHE_FILE, JSON.stringify({ version: CACHE_VERSION, ...payload }));
  } catch {
    /* ignore */
  }
}

function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function demoQuote(instrument) {
  const seed = hashSeed(instrument.symbol);
  const base = 100 + (seed % 4500);
  const changePct = ((seed % 900) - 450) / 100; // -4.5% .. +4.49%
  const prevClose = Math.round(base * 100) / 100;
  const ltp = Math.round(prevClose * (1 + changePct / 100) * 100) / 100;
  const high52 = Math.round(prevClose * (1.05 + (seed % 40) / 100) * 100) / 100;
  const low52 = Math.round(prevClose * (0.55 + (seed % 30) / 100) * 100) / 100;
  const stats = compute52WeekStats(
    [
      { high: high52, low: low52, close: prevClose },
      { high: high52 * 0.98, low: low52 * 1.02, close: ltp },
    ],
    ltp
  );
  // Force known high/low for demo determinism
  stats.high52 = high52;
  stats.low52 = low52;
  stats.pctFromHigh = Math.round(((ltp - high52) / high52) * 10000) / 100;
  stats.pctFromLow = Math.round(((ltp - low52) / low52) * 10000) / 100;
  const span = high52 - low52;
  stats.rangePosition = span > 0 ? Math.round(((ltp - low52) / span) * 10000) / 100 : null;
  stats.daysInWindow = 252;

  return {
    symbol: instrument.symbol,
    name: instrument.name,
    sector: instrument.sector,
    sectorShort: shortenSector(instrument.sector),
    securityId: instrument.securityId || `demo-${instrument.symbol}`,
    ltp,
    open: Math.round(prevClose * (1 + ((seed % 50) - 25) / 10000) * 100) / 100,
    high: Math.max(ltp, prevClose),
    low: Math.min(ltp, prevClose),
    prevClose,
    change: Math.round((ltp - prevClose) * 100) / 100,
    changePct: Math.round(changePct * 100) / 100,
    volume: 100000 + (seed % 5000000),
    ...stats,
  };
}

function buildDemoRows(instruments) {
  return instruments.map(demoQuote);
}

function sortRanked(rows, ranking) {
  const copy = [...rows];
  switch (ranking) {
    case 'gainers':
      return copy.sort((a, b) => (b.changePct ?? -Infinity) - (a.changePct ?? -Infinity));
    case 'losers':
      return copy.sort((a, b) => (a.changePct ?? Infinity) - (b.changePct ?? Infinity));
    case 'near52wHigh':
      return copy.sort((a, b) => (b.pctFromHigh ?? -Infinity) - (a.pctFromHigh ?? -Infinity));
    case 'near52wLow':
      return copy.sort((a, b) => (a.pctFromLow ?? Infinity) - (b.pctFromLow ?? Infinity));
    case 'volume':
      return copy.sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0));
    default:
      return copy.sort((a, b) => a.symbol.localeCompare(b.symbol));
  }
}

function filterSector(rows, sector) {
  if (!sector || sector === 'all') return rows;
  const needle = sector.toLowerCase();
  return rows.filter(
    (r) =>
      r.sector?.toLowerCase() === needle ||
      r.sectorShort?.toLowerCase() === needle
  );
}

function sectorSummary(rows) {
  const bySector = new Map();
  for (const row of rows) {
    const key = row.sector || 'Unknown';
    if (!bySector.has(key)) {
      bySector.set(key, {
        sector: key,
        sectorShort: row.sectorShort || shortenSector(key),
        count: 0,
        advancers: 0,
        decliners: 0,
        avgChangePct: 0,
        _sum: 0,
      });
    }
    const s = bySector.get(key);
    s.count += 1;
    const ch = row.changePct ?? 0;
    s._sum += ch;
    if (ch > 0) s.advancers += 1;
    else if (ch < 0) s.decliners += 1;
  }
  return [...bySector.values()]
    .map((s) => {
      const avgChangePct = s.count ? Math.round((s._sum / s.count) * 100) / 100 : 0;
      const { _sum, ...rest } = s;
      return { ...rest, avgChangePct };
    })
    .sort((a, b) => b.avgChangePct - a.avgChangePct);
}

function createStockDashboard({
  tokenManager,
  config,
  fetchImpl = fetch,
  demoMode = false,
  /** Skip per-symbol 52w history pulls (required on Cloudflare CPU limits). */
  skipWeek52 = false,
  /** Optional preloaded instruments: [{ symbol, name, sector, securityId }] */
  bundledUniverse = null,
}) {
  let memoryCache = null;
  let week52Cache = new Map(); // symbol -> { stats, at }
  let universeCache = null;
  let refreshInflight = null;

  function isDemo() {
    return demoMode || !tokenManager?.hasCredentials?.();
  }

  async function loadUniverse(universe = 'nifty50') {
    if (universeCache?.universe === universe && universeCache.instruments?.length) {
      return universeCache;
    }

    // Prefer bundled Nifty50 map when provided (Cloudflare — avoids 25MB scrip master).
    if (bundledUniverse?.instruments?.length && String(universe).toLowerCase().includes('nifty50')) {
      const instruments = bundledUniverse.instruments.map((row) => ({
        symbol: row.symbol,
        name: row.name || row.symbol,
        sector: row.sector || 'Unknown',
        securityId: String(row.securityId),
      }));
      universeCache = {
        universe,
        instruments,
        sectors: [...new Set(instruments.map((i) => i.sector))].sort(),
        missing: bundledUniverse.missing || [],
      };
      return universeCache;
    }

    if (isDemo()) {
      try {
        const rows = await fetchIndexUniverse(universe, fetchImpl);
        const instruments = rows.map((row) => ({
          symbol: row.symbol,
          name: row.name,
          sector: row.sector,
          securityId: `demo-${row.symbol}`,
        }));
        universeCache = {
          universe,
          instruments,
          sectors: [...new Set(instruments.map((i) => i.sector))].sort(),
          missing: [],
        };
        return universeCache;
      } catch {
        const fallback = require('./universe/nse500.json').slice(0, universe === 'nifty500' ? 100 : 50);
        const instruments = fallback.map((symbol, idx) => ({
          symbol,
          name: symbol,
          sector: ['Financial Services', 'Information Technology', 'Oil Gas & Consumable Fuels', 'Automobile and Auto Components', 'Healthcare'][idx % 5],
          securityId: `demo-${symbol}`,
        }));
        universeCache = {
          universe,
          instruments,
          sectors: [...new Set(instruments.map((i) => i.sector))].sort(),
          missing: [],
        };
        return universeCache;
      }
    }
    universeCache = await resolveDashboardUniverse(universe, fetchImpl);
    return universeCache;
  }

  async function loadWeek52ForInstrument(instrument, accessToken) {
    const cached = week52Cache.get(instrument.symbol);
    if (cached && Date.now() - cached.at < WEEK52_TTL_MS) return cached.stats;

    const candles = await fetchDhanDailyCandles({
      securityId: instrument.securityId,
      accessToken,
      clientId: config.clientId,
      years: 1,
    }, fetchImpl);
    const stats = compute52WeekStats(candles);
    week52Cache.set(instrument.symbol, { stats, at: Date.now() });
    return stats;
  }

  async function mapPool(items, concurrency, fn) {
    const results = new Array(items.length);
    let next = 0;
    async function worker() {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i], i);
      }
    }
    const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
    await Promise.all(workers);
    return results;
  }

  async function fetchLiveRows(universe) {
    const { instruments, missing } = await loadUniverse(universe);
    const { accessToken } = await tokenManager.getAccessToken();
    const securityIds = instruments.map((i) => i.securityId);

    // On Cloudflare (skipWeek52), use a single OHLC call — never full+ohlc fallback
    // (that doubled traffic and triggered Dhan 429 / code 805).
    let quotes;
    if (skipWeek52) {
      quotes = await fetchOhlcQuotes({
        accessToken,
        clientId: config.clientId,
        securityIds,
        fetchImpl,
      });
    } else {
      try {
        quotes = await fetchFullQuotes({
          accessToken,
          clientId: config.clientId,
          securityIds,
          fetchImpl,
        });
      } catch (err) {
        if (isRateLimitError(err)) throw err;
        quotes = await fetchOhlcQuotes({
          accessToken,
          clientId: config.clientId,
          securityIds,
          fetchImpl,
        });
      }
    }

    const week52List = skipWeek52
      ? instruments.map(() => ({
        high52: null,
        low52: null,
        pctFromHigh: null,
        pctFromLow: null,
        rangePosition: null,
        daysInWindow: 0,
      }))
      : await mapPool(instruments, 4, async (inst) => {
        try {
          return await loadWeek52ForInstrument(inst, accessToken);
        } catch (err) {
          return {
            high52: null,
            low52: null,
            pctFromHigh: null,
            pctFromLow: null,
            rangePosition: null,
            daysInWindow: 0,
            error: err.message,
          };
        }
      });

    const rows = instruments.map((inst, idx) => {
      const q = quotes.get(String(inst.securityId)) || {};
      const w = week52List[idx] || {};
      const ltp = q.ltp;
      // Recompute pct from current LTP when we have highs/lows
      const recomputed = (w.high52 != null && w.low52 != null && ltp != null)
        ? compute52WeekStats(
          [{ high: w.high52, low: w.low52, close: ltp }],
          ltp
        )
        : w;

      return {
        symbol: inst.symbol,
        name: inst.name,
        sector: inst.sector,
        sectorShort: shortenSector(inst.sector),
        securityId: inst.securityId,
        ltp: q.ltp ?? null,
        open: q.open ?? null,
        high: q.high ?? null,
        low: q.low ?? null,
        prevClose: q.prevClose ?? null,
        change: q.change ?? null,
        changePct: q.changePct ?? null,
        volume: q.volume ?? null,
        high52: recomputed.high52 ?? w.high52 ?? null,
        low52: recomputed.low52 ?? w.low52 ?? null,
        pctFromHigh: recomputed.pctFromHigh ?? w.pctFromHigh ?? null,
        pctFromLow: recomputed.pctFromLow ?? w.pctFromLow ?? null,
        rangePosition: recomputed.rangePosition ?? w.rangePosition ?? null,
        daysInWindow: w.daysInWindow ?? 0,
      };
    });

    return {
      universe,
      mode: 'live',
      scannedAt: new Date().toISOString(),
      count: rows.length,
      missing,
      rows,
      sectors: sectorSummary(rows),
      warning: skipWeek52
        ? 'Live Dhan OHLC quotes; 52-week history skipped on this host to stay within CPU limits.'
        : undefined,
    };
  }

  async function buildPayload(universe = 'nifty50') {
    if (isDemo()) {
      const { instruments, missing } = await loadUniverse(universe);
      const rows = buildDemoRows(instruments);
      return {
        universe,
        mode: 'demo',
        scannedAt: new Date().toISOString(),
        count: rows.length,
        missing,
        rows,
        sectors: sectorSummary(rows),
        warning: 'Running in demo mode — set DHAN_CLIENT_ID, DHAN_PIN, DHAN_TOTP_SECRET for live Dhan data.',
      };
    }
    return fetchLiveRows(universe);
  }

  async function refresh(universe = 'nifty50') {
    if (refreshInflight) return refreshInflight;
    refreshInflight = (async () => {
      try {
        const payload = await buildPayload(universe);
        memoryCache = { payload, at: Date.now(), universe };
        writeDiskCache(memoryCache);
        return payload;
      } catch (err) {
        // On Dhan 429, keep serving last good payload instead of hard-failing the UI.
        const cached = getCached(universe);
        if (cached?.payload && isRateLimitError(err)) {
          return {
            ...cached.payload,
            warning: `Dhan rate-limited (429). Showing last cached quotes. ${err.message}`.slice(0, 240),
            stale: true,
          };
        }
        throw err;
      } finally {
        refreshInflight = null;
      }
    })();
    return refreshInflight;
  }

  function getCached(universe = 'nifty50') {
    if (memoryCache?.universe === universe && memoryCache.payload) {
      if (isDemo() && memoryCache.payload.mode === 'live') return null;
      if (!isDemo() && memoryCache.payload.mode === 'demo') return null;
      return memoryCache;
    }
    const disk = readDiskCache();
    if (disk?.universe === universe && disk.payload) {
      if (isDemo() && disk.payload.mode === 'live') return null;
      if (!isDemo() && disk.payload.mode === 'demo') return null;
      memoryCache = disk;
      return disk;
    }
    return null;
  }

  async function getDashboard({
    universe = 'nifty50',
    sector = 'all',
    ranking = 'all',
    limit = 100,
    force = false,
  } = {}) {
    if (!RANKINGS.includes(ranking)) {
      throw Object.assign(new Error(`Invalid ranking: ${ranking}`), { status: 400 });
    }

    const cached = getCached(universe);
    const ttl = skipWeek52 ? QUOTE_TTL_LITE_MS : QUOTE_TTL_MS;
    const fresh = cached && Date.now() - cached.at < ttl;
    let payload;

    if (!force && fresh) {
      payload = cached.payload;
    } else if (!force && cached?.payload) {
      payload = cached.payload;
      // kick background refresh
      refresh(universe).catch(() => {});
    } else {
      payload = await refresh(universe);
    }

    let rows = filterSector(payload.rows, sector);
    rows = sortRanked(rows, ranking);
    const lim = Math.min(Math.max(Number(limit) || 100, 1), 500);
    rows = rows.slice(0, lim);

    return {
      ...payload,
      sector: sector || 'all',
      ranking,
      rows,
      count: rows.length,
      totalInUniverse: payload.rows.length,
      auth: tokenManager?.getStatus?.() || { mode: isDemo() ? 'demo' : 'unknown' },
      cacheAgeMs: cached ? Date.now() - cached.at : 0,
    };
  }

  async function getSectors(universe = 'nifty50') {
    const report = await getDashboard({ universe, ranking: 'all', limit: 500 });
    return {
      universe,
      mode: report.mode,
      scannedAt: report.scannedAt,
      sectors: report.sectors,
      warning: report.warning,
      auth: report.auth,
    };
  }

  async function getRankings(universe = 'nifty50', sector = 'all') {
    const base = await getDashboard({ universe, sector, ranking: 'all', limit: 500 });
    const top = (ranking, n = 10) => sortRanked(filterSector(base.rows, sector), ranking).slice(0, n);
    return {
      universe,
      sector,
      mode: base.mode,
      scannedAt: base.scannedAt,
      gainers: top('gainers'),
      losers: top('losers'),
      near52wHigh: top('near52wHigh'),
      near52wLow: top('near52wLow'),
      volume: top('volume'),
      warning: base.warning,
      auth: base.auth,
    };
  }

  return {
    getDashboard,
    getSectors,
    getRankings,
    refresh,
    isDemo,
    RANKINGS,
  };
}

module.exports = {
  createStockDashboard,
  computeSectorSummary: sectorSummary,
  sortRanked,
  filterSector,
  buildDemoRows,
  RANKINGS,
};
