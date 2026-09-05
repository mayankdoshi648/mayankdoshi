const { computeEMA } = require('./indicators');
const { fetchYahooDailyCandles } = require('./darvaxData');

const NSE_HOME = 'https://www.nseindia.com';
const NSE_ALL_INDICES = 'https://www.nseindia.com/api/allIndices';

const HEADLINE = [
  { id: 'nifty50', nseName: 'NIFTY 50', label: 'Nifty 50' },
  { id: 'bankNifty', nseName: 'NIFTY BANK', label: 'Bank Nifty' },
  { id: 'indiaVix', nseName: 'INDIA VIX', label: 'India VIX' },
];

const SIZE_INDICES = [
  {
    id: 'largeCap',
    nseName: 'NIFTY 100',
    label: 'Large Cap',
    subtitle: 'Nifty 100',
    yahoo: '^CNX100',
  },
  {
    id: 'midCap',
    nseName: 'NIFTY MIDCAP 150',
    label: 'Mid Cap',
    subtitle: 'Nifty Midcap 150',
    yahoo: '^NSMIDCP',
  },
  {
    id: 'smallCap',
    nseName: 'NIFTY SMALLCAP 250',
    label: 'Small Cap',
    subtitle: 'Nifty Smallcap 250',
    yahoo: null,
  },
];

const SECTOR_INDICES = [
  { id: 'it', nseName: 'NIFTY IT', label: 'IT', yahoo: '^CNXIT' },
  { id: 'bank', nseName: 'NIFTY BANK', label: 'Bank', yahoo: '^NSEBANK' },
  { id: 'fin', nseName: 'NIFTY FINANCIAL SERVICES', label: 'Financial Services', yahoo: null },
  { id: 'auto', nseName: 'NIFTY AUTO', label: 'Auto', yahoo: '^CNXAUTO' },
  { id: 'pharma', nseName: 'NIFTY PHARMA', label: 'Pharma', yahoo: '^CNXPHARMA' },
  { id: 'fmcg', nseName: 'NIFTY FMCG', label: 'FMCG', yahoo: '^CNXFMCG' },
  { id: 'metal', nseName: 'NIFTY METAL', label: 'Metal', yahoo: '^CNXMETAL' },
  { id: 'energy', nseName: 'NIFTY ENERGY', label: 'Energy', yahoo: '^CNXENERGY' },
  { id: 'realty', nseName: 'NIFTY REALTY', label: 'Realty', yahoo: '^CNXREALTY' },
  { id: 'media', nseName: 'NIFTY MEDIA', label: 'Media', yahoo: '^CNXMEDIA' },
  { id: 'psuBank', nseName: 'NIFTY PSU BANK', label: 'PSU Bank', yahoo: '^CNXPSUBANK' },
  { id: 'privateBank', nseName: 'NIFTY PRIVATE BANK', label: 'Private Bank', yahoo: null },
  { id: 'infra', nseName: 'NIFTY INFRASTRUCTURE', label: 'Infra', yahoo: '^CNXINFRA' },
  { id: 'healthcare', nseName: 'NIFTY HEALTHCARE INDEX', label: 'Healthcare', yahoo: null },
  { id: 'consumerDurables', nseName: 'NIFTY CONSUMER DURABLES', label: 'Consumer Durables', yahoo: null },
  { id: 'oilGas', nseName: 'NIFTY OIL & GAS', label: 'Oil & Gas', yahoo: null },
  { id: 'chemicals', nseName: 'NIFTY CHEMICALS', label: 'Chemicals', yahoo: null },
];

const EMA_PERIODS = [20, 50, 200];
const OVERVIEW_CACHE_TTL_MS = 5 * 60 * 1000;

let cookieJar = '';
let overviewCache = null;
let overviewCacheAt = 0;
let overviewInflight = null;

function nseHeaders() {
  return {
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    Accept: 'application/json,text/plain,*/*',
    Referer: `${NSE_HOME}/`,
    Cookie: cookieJar,
  };
}

async function ensureNseSession(fetchImpl = fetch) {
  const home = await fetchImpl(NSE_HOME, {
    headers: { 'User-Agent': nseHeaders()['User-Agent'] },
    signal: AbortSignal.timeout(15000),
    redirect: 'follow',
  });
  const raw = typeof home.headers.getSetCookie === 'function'
    ? home.headers.getSetCookie()
    : [];
  if (raw.length) {
    cookieJar = raw.map((c) => c.split(';')[0]).join('; ');
    return;
  }
  const single = home.headers.get('set-cookie');
  if (single) {
    cookieJar = single.split(',').map((c) => c.split(';')[0].trim()).join('; ');
  }
}

async function fetchNseAllIndices(fetchImpl = fetch) {
  await ensureNseSession(fetchImpl);
  const resp = await fetchImpl(NSE_ALL_INDICES, {
    headers: nseHeaders(),
    signal: AbortSignal.timeout(20000),
  });
  if (!resp.ok) throw new Error(`NSE allIndices failed: HTTP ${resp.status}`);
  const body = await resp.json();
  const byName = new Map();
  for (const row of body?.data || []) {
    if (row?.index) byName.set(String(row.index).toUpperCase(), row);
  }
  return byName;
}

function pickQuote(byName, nseName) {
  const row = byName.get(String(nseName).toUpperCase());
  if (!row) return null;
  const last = Number(row.last);
  const prev = Number(row.previousClose);
  const pct = row.percentChange != null ? Number(row.percentChange) : null;
  const change = row.variation != null ? Number(row.variation) : null;
  return {
    last: Number.isFinite(last) ? last : null,
    previousClose: Number.isFinite(prev) ? prev : null,
    change: Number.isFinite(change) ? change : null,
    changePct: Number.isFinite(pct) ? pct : null,
  };
}

function directionFromPct(changePct) {
  if (changePct == null || Number.isNaN(changePct)) return 'flat';
  if (changePct > 0) return 'up';
  if (changePct < 0) return 'down';
  return 'flat';
}

function formatQuote(meta, quote) {
  const changePct = quote?.changePct == null ? null : Number(quote.changePct);
  const dir = directionFromPct(changePct);
  return {
    id: meta.id,
    label: meta.label,
    subtitle: meta.subtitle || null,
    last: quote?.last == null ? null : Number(quote.last),
    change: quote?.change == null ? null : Number(Number(quote.change).toFixed(2)),
    changePct: changePct == null ? null : Number(changePct.toFixed(2)),
    direction: dir,
    arrow: dir === 'up' ? '▲' : dir === 'down' ? '▼' : '◆',
  };
}

function emaStatusFromCloses(closes) {
  const status = {};
  for (const period of EMA_PERIODS) {
    const key = `ema${period}`;
    const series = computeEMA(closes, period);
    let ema = null;
    for (let i = series.length - 1; i >= 0; i--) {
      if (series[i] != null) {
        ema = series[i];
        break;
      }
    }
    const close = closes.length ? closes[closes.length - 1] : null;
    if (close == null || ema == null) {
      status[key] = { value: null, above: null, period };
      continue;
    }
    status[key] = {
      value: Number(ema.toFixed(2)),
      above: close > ema,
      period,
    };
  }
  const aboveCount = EMA_PERIODS.filter((p) => status[`ema${p}`].above === true).length;
  status.score = aboveCount;
  status.bias = aboveCount >= 2 ? 'bullish' : aboveCount === 0 ? 'bearish' : 'mixed';
  return status;
}

async function fetchEmaStatus(yahooSymbol, fetchImpl = fetch) {
  if (!yahooSymbol) return null;
  try {
    const candles = await fetchYahooDailyCandles(yahooSymbol, 'US', '2y', fetchImpl);
    if (!candles || candles.length < 30) return null;
    const closes = candles.map((c) => c.close).filter((v) => v != null);
    return emaStatusFromCloses(closes);
  } catch {
    return null;
  }
}

async function mapPool(items, concurrency, worker) {
  const out = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const i = next;
      next += 1;
      out[i] = await worker(items[i], i);
    }
  }
  const n = Math.min(concurrency, Math.max(items.length, 1));
  await Promise.all(Array.from({ length: n }, () => run()));
  return out;
}

async function computeMarketOverview(options = {}) {
  const { fetchImpl = fetch } = options;
  const byName = await fetchNseAllIndices(fetchImpl);

  const headline = HEADLINE.map((meta) => formatQuote(meta, pickQuote(byName, meta.nseName)));

  const uniqueYahoo = [...new Set(
    [...SIZE_INDICES, ...SECTOR_INDICES].map((m) => m.yahoo).filter(Boolean),
  )];
  const emaByYahoo = new Map();
  const emaResults = await mapPool(uniqueYahoo, 6, async (sym) => [
    sym,
    await fetchEmaStatus(sym, fetchImpl),
  ]);
  for (const [sym, ema] of emaResults) emaByYahoo.set(sym, ema);

  const size = SIZE_INDICES.map((meta) => ({
    ...formatQuote(meta, pickQuote(byName, meta.nseName)),
    ema: meta.yahoo ? (emaByYahoo.get(meta.yahoo) || null) : null,
  }));

  const sectors = SECTOR_INDICES.map((meta) => ({
    ...formatQuote(meta, pickQuote(byName, meta.nseName)),
    ema: meta.yahoo ? (emaByYahoo.get(meta.yahoo) || null) : null,
  }));

  return {
    scannedAt: new Date().toISOString(),
    source: 'nse+yahoo',
    headline,
    size,
    sectors,
  };
}

async function getMarketOverview(options = {}) {
  const { force = false, ttlMs = OVERVIEW_CACHE_TTL_MS, ...rest } = options;
  if (!force && overviewCache && Date.now() - overviewCacheAt < ttlMs) {
    return { ...overviewCache, fromCache: true };
  }
  if (overviewInflight) {
    const report = await overviewInflight;
    return { ...report, fromCache: false };
  }
  overviewInflight = computeMarketOverview(rest)
    .then((report) => {
      overviewCache = report;
      overviewCacheAt = Date.now();
      return report;
    })
    .finally(() => {
      overviewInflight = null;
    });
  const report = await overviewInflight;
  return { ...report, fromCache: false };
}

module.exports = {
  HEADLINE,
  SIZE_INDICES,
  SECTOR_INDICES,
  EMA_PERIODS,
  directionFromPct,
  formatQuote,
  emaStatusFromCloses,
  pickQuote,
  computeMarketOverview,
  getMarketOverview,
};
