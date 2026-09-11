// backend/dhanQuotes.js — Dhan marketfeed LTP / OHLC / Quote helpers
const DHAN_OHLC_URL = 'https://api.dhan.co/v2/marketfeed/ohlc';
const DHAN_QUOTE_URL = 'https://api.dhan.co/v2/marketfeed/quote';
const DHAN_LTP_URL = 'https://api.dhan.co/v2/marketfeed/ltp';

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

async function postMarketFeed(url, { accessToken, clientId, securityIds, fetchImpl = fetch }) {
  const ids = securityIds.map((id) => Number(id) || id);
  const body = { NSE_EQ: ids };
  const resp = await fetchImpl(url, {
    method: 'POST',
    headers: authHeaders({ accessToken, clientId }),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Dhan marketfeed HTTP ${resp.status}: ${text.slice(0, 160)}`);
  }
  const json = await resp.json();
  if (json.status && json.status !== 'success') {
    throw new Error(`Dhan marketfeed status=${json.status}`);
  }
  return json.data?.NSE_EQ || {};
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
    change: netChange == null || !Number.isFinite(netChange) ? null : Math.round(netChange * 100) / 100,
    changePct: changePct == null || !Number.isFinite(changePct) ? null : Math.round(changePct * 100) / 100,
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
  chunk,
  normalizeQuote,
  fetchOhlcQuotes,
  fetchFullQuotes,
  postMarketFeed,
};
