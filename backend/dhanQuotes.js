const { getMarketDataStore } = require('./marketData');
// backend/dhanQuotes.js — Dhan marketfeed LTP / OHLC / Quote helpers
const DHAN_OHLC_URL = 'https://api.dhan.co/v2/marketfeed/ohlc';
const DHAN_QUOTE_URL = 'https://api.dhan.co/v2/marketfeed/quote';
const DHAN_LTP_URL = 'https://api.dhan.co/v2/marketfeed/ltp';

/** Dhan marketfeed is aggressively rate-limited (HTTP 429 / code 805). */
const MIN_MARKETFEED_GAP_MS = 1200;
const MAX_429_RETRIES = 3;

let lastMarketfeedAt = 0;
let marketfeedQueue = Promise.resolve();

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function authHeaders({ accessToken, clientId }) {
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'access-token': accessToken,
    'client-id': String(clientId),
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimitError(err) {
  const msg = String(err?.message || err || '');
  return /\b429\b/.test(msg) || /too many requests/i.test(msg) || /\b805\b/.test(msg);
}

/**
 * Serialize marketfeed calls and space them out so Cloudflare + UI polling
 * do not trip Dhan's per-user rate limit.
 */
function enqueueMarketfeed(fn) {
  const run = marketfeedQueue.then(async () => {
    const wait = Math.max(0, MIN_MARKETFEED_GAP_MS - (Date.now() - lastMarketfeedAt));
    if (wait > 0) await sleep(wait);
    lastMarketfeedAt = Date.now();
    return fn();
  });
  marketfeedQueue = run.catch(() => {});
  return run;
}

async function postMarketFeed(url, { accessToken, clientId, securityIds, fetchImpl = fetch }) {
  const ids = securityIds.map((id) => Number(id) || id);
  const body = { NSE_EQ: ids };

  return enqueueMarketfeed(async () => {
    let lastErr;
    for (let attempt = 0; attempt <= MAX_429_RETRIES; attempt += 1) {
      const resp = await fetchImpl(url, {
        method: 'POST',
        headers: authHeaders({ accessToken, clientId }),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20000),
      });
      if (resp.ok) {
        const json = await resp.json();
        if (json.status && json.status !== 'success') {
          const failed = new Error(`Dhan marketfeed status=${json.status}`);
          if (isRateLimitError(JSON.stringify(json))) throw Object.assign(failed, { status: 429 });
          throw failed;
        }
        try { getMarketDataStore().recordDhan({ ok: true }); } catch (_) {}
        return json.data?.NSE_EQ || {};
      }
      const text = await resp.text().catch(() => '');
      lastErr = new Error(`Dhan marketfeed HTTP ${resp.status}: ${text.slice(0, 160)}`);
      lastErr.status = resp.status;
      if (resp.status === 429 && attempt < MAX_429_RETRIES) {
        // 2s, 4s, 8s — give Dhan room before retrying
        await sleep(2000 * (2 ** attempt));
        lastMarketfeedAt = Date.now();
        continue;
      }
      try {
        getMarketDataStore().recordDhan({
          ok: false,
          rateLimited: lastErr?.status === 429 || isRateLimitError(lastErr),
          error: lastErr,
        });
      } catch (_) {}
      throw lastErr;
    }
    throw lastErr;
  });
}

function normalizeQuote(securityId, raw) {
  if (!raw) return null;
  const ohlc = raw.ohlc || {};
  const lastPrice = Number(raw.last_price ?? raw.lastPrice);
  const prevClose = Number(ohlc.close);
  const open = Number(ohlc.open);
  const high = Number(ohlc.high);
  const low = Number(ohlc.low);
  const netChange = raw.net_change != null
    ? Number(raw.net_change)
    : (Number.isFinite(lastPrice) && Number.isFinite(prevClose) ? lastPrice - prevClose : null);
  const changePct = netChange != null && prevClose
    ? (netChange / prevClose) * 100
    : null;

  return {
    securityId: String(securityId),
    ltp: Number.isFinite(lastPrice) ? lastPrice : null,
    open: Number.isFinite(open) ? open : null,
    high: Number.isFinite(high) ? high : null,
    low: Number.isFinite(low) ? low : null,
    prevClose: Number.isFinite(prevClose) ? prevClose : null,
    change: netChange == null || !Number.isFinite(netChange) ? null : netChange,
    changePct: changePct == null || !Number.isFinite(changePct) ? null : changePct,
    volume: raw.volume != null ? Number(raw.volume) : null,
    averagePrice: raw.average_price != null ? Number(raw.average_price) : null,
  };
}

async function fetchOhlcQuotes({ accessToken, clientId, securityIds, fetchImpl = fetch, batchSize = 500 }) {
  const map = new Map();
  for (const batch of chunk(securityIds, batchSize)) {
    const data = await postMarketFeed(DHAN_OHLC_URL, {
      accessToken,
      clientId,
      securityIds: batch,
      fetchImpl,
    });
    for (const [sid, raw] of Object.entries(data)) {
      const q = normalizeQuote(sid, raw);
      if (q) map.set(String(sid), q);
    }
  }
  return map;
}

async function fetchFullQuotes({ accessToken, clientId, securityIds, fetchImpl = fetch, batchSize = 200 }) {
  const map = new Map();
  for (const batch of chunk(securityIds, batchSize)) {
    const data = await postMarketFeed(DHAN_QUOTE_URL, {
      accessToken,
      clientId,
      securityIds: batch,
      fetchImpl,
    });
    for (const [sid, raw] of Object.entries(data)) {
      const q = normalizeQuote(sid, raw);
      if (q) map.set(String(sid), q);
    }
  }
  return map;
}

module.exports = {
  DHAN_OHLC_URL,
  DHAN_QUOTE_URL,
  DHAN_LTP_URL,
  MIN_MARKETFEED_GAP_MS,
  chunk,
  normalizeQuote,
  fetchOhlcQuotes,
  fetchFullQuotes,
  postMarketFeed,
  isRateLimitError,
};
