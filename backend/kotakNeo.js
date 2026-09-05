/**
 * Kotak Neo API client (quotes + optional TOTP/MPIN session).
 *
 * Quotes: Authorization = consumer access token (no full trade login required).
 * Docs: https://knweb.concepttrade.net/docs/
 *
 * Neo has no historical candle API — DMA/EMA still use Yahoo/Dhan.
 */

const crypto = require("crypto");

const LOGIN_BASE = "https://mis.kotaksecurities.com/login/1.0";
const QUOTES_BASE =
  "https://gw-napi.kotaksecurities.com/script-details/1.0/quotes/neosymbol";
const NEO_FIN_KEY = "neotradeapi";

/** Default Neo instrument tokens for common NSE indices (exchange_segment: nse_cm). */
const INDEX_TOKENS = {
  "Nifty 50": { instrument_token: "Nifty 50", exchange_segment: "nse_cm" },
  "Nifty Bank": { instrument_token: "Nifty Bank", exchange_segment: "nse_cm" },
  "India VIX": { instrument_token: "India VIX", exchange_segment: "nse_cm" },
  "Nifty 100": { instrument_token: "Nifty 100", exchange_segment: "nse_cm" },
  "Nifty Midcap 150": {
    instrument_token: "NIFTY MIDCAP 150",
    exchange_segment: "nse_cm",
  },
  "Nifty Smallcap 250": {
    instrument_token: "NIFTY SMLCAP 250",
    exchange_segment: "nse_cm",
  },
  "Nifty Auto": { instrument_token: "Nifty Auto", exchange_segment: "nse_cm" },
  "Nifty Financial Services": {
    instrument_token: "Nifty Fin Service",
    exchange_segment: "nse_cm",
  },
  "Nifty FMCG": { instrument_token: "Nifty FMCG", exchange_segment: "nse_cm" },
  "Nifty IT": { instrument_token: "Nifty IT", exchange_segment: "nse_cm" },
  "Nifty Media": { instrument_token: "Nifty Media", exchange_segment: "nse_cm" },
  "Nifty Metal": { instrument_token: "Nifty Metal", exchange_segment: "nse_cm" },
  "Nifty Pharma": {
    instrument_token: "Nifty Pharma",
    exchange_segment: "nse_cm",
  },
  "Nifty Realty": {
    instrument_token: "Nifty Realty",
    exchange_segment: "nse_cm",
  },
  "Nifty Energy": {
    instrument_token: "Nifty Energy",
    exchange_segment: "nse_cm",
  },
  "Nifty PSU Bank": {
    instrument_token: "Nifty PSU Bank",
    exchange_segment: "nse_cm",
  },
  "Nifty Private Bank": {
    instrument_token: "Nifty Pvt Bank",
    exchange_segment: "nse_cm",
  },
  "Nifty Infrastructure": {
    instrument_token: "Nifty Infra",
    exchange_segment: "nse_cm",
  },
  "Nifty Healthcare": {
    instrument_token: "Nifty Healthcare",
    exchange_segment: "nse_cm",
  },
  "Nifty Consumer Durables": {
    instrument_token: "Nifty Consr Durbl",
    exchange_segment: "nse_cm",
  },
  "Nifty Oil & Gas": {
    instrument_token: "Nifty Oil & Gas",
    exchange_segment: "nse_cm",
  },
  "Nifty Chemicals": {
    instrument_token: "Nifty Chemicals",
    exchange_segment: "nse_cm",
  },
};

function getEnv(name, fallback = "") {
  const v = process.env[name];
  return v == null || String(v).trim() === "" ? fallback : String(v).trim();
}

/** First non-empty env among aliases (supports older/local naming). */
function getEnvAny(names, fallback = "") {
  for (const name of names) {
    const v = getEnv(name);
    if (v) return v;
  }
  return fallback;
}

const CONSUMER_KEY_ALIASES = [
  "KOTAK_NEO_CONSUMER_KEY",
  "KOTAK_CONSUMER_KEY",
  "NEO_CONSUMER_KEY",
  "CONSUMER_KEY",
  "KOTAK_NEO_ACCESS_TOKEN",
  "KOTAK_ACCESS_TOKEN",
];

function getConsumerKey() {
  return getEnvAny(CONSUMER_KEY_ALIASES);
}

function isKotakConfigured() {
  return Boolean(getConsumerKey());
}

function base32Decode(secret) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const cleaned = String(secret || "")
    .toUpperCase()
    .replace(/[^A-Z2-7]/g, "");
  let bits = "";
  for (const ch of cleaned) {
    const val = alphabet.indexOf(ch);
    if (val < 0) continue;
    bits += val.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

function generateTotp(secret, stepSeconds = 30, digits = 6) {
  const key = base32Decode(secret);
  const counter = Math.floor(Date.now() / 1000 / stepSeconds);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter & 0xffffffff, 4);
  const hmac = crypto.createHmac("sha1", key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(code % 10 ** digits).padStart(digits, "0");
}

function getTotpCode() {
  const oneShot = getEnv("KOTAK_NEO_TOTP");
  if (oneShot) return oneShot;
  const secret = getEnv("KOTAK_NEO_TOTP_SECRET");
  if (!secret) {
    throw new Error(
      "Set KOTAK_NEO_TOTP_SECRET (or KOTAK_NEO_TOTP) for Kotak Neo login"
    );
  }
  return generateTotp(secret);
}

async function neoFetch(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || 15000);
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...(options.headers || {}),
      },
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text };
    }
    if (!res.ok) {
      const msg =
        json?.message ||
        json?.error ||
        json?.raw ||
        `HTTP ${res.status} ${res.statusText}`;
      throw new Error(String(msg));
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Step 1+2: TOTP login then MPIN validate → session token.
 * Needed for orders/WS; quotes only need consumer key.
 */
async function createKotakSession() {
  const consumerKey = getConsumerKey();
  const mobile = getEnvAny(["KOTAK_NEO_MOBILE", "KOTAK_MOBILE", "MOBILE_NUMBER"]);
  const ucc = getEnvAny(["KOTAK_NEO_UCC", "KOTAK_UCC", "UCC"]);
  const mpin = getEnvAny(["KOTAK_NEO_MPIN", "KOTAK_MPIN", "MPIN"]);
  if (!consumerKey || !mobile || !ucc || !mpin) {
    throw new Error(
      "Kotak Neo login needs KOTAK_NEO_CONSUMER_KEY, KOTAK_NEO_MOBILE, KOTAK_NEO_UCC, KOTAK_NEO_MPIN"
    );
  }

  const totp = getTotpCode();
  const login = await neoFetch(`${LOGIN_BASE}/tradeApiLogin`, {
    method: "POST",
    headers: {
      Authorization: consumerKey,
      "Content-Type": "application/json",
      neo_fin_key: NEO_FIN_KEY,
    },
    body: JSON.stringify({ mobileNumber: mobile, ucc, totp }),
  });

  const viewToken = login?.data?.token;
  const sid = login?.data?.sid;
  if (!viewToken || !sid) {
    throw new Error(`Kotak Neo login incomplete: ${JSON.stringify(login)}`);
  }

  const validate = await neoFetch(`${LOGIN_BASE}/tradeApiValidate`, {
    method: "POST",
    headers: {
      Authorization: viewToken,
      sid,
      "Content-Type": "application/json",
      neo_fin_key: NEO_FIN_KEY,
    },
    body: JSON.stringify({ mpinn: mpin }),
  });

  const sessionToken = validate?.data?.token;
  const sessionSid = validate?.data?.sid;
  const baseUrl = validate?.data?.baseUrl || validate?.data?.base_url;
  if (!sessionToken || !sessionSid) {
    throw new Error(`Kotak Neo MPIN validate failed: ${JSON.stringify(validate)}`);
  }

  return {
    accessToken: sessionToken,
    sid: sessionSid,
    baseUrl: baseUrl ? `https://${String(baseUrl).replace(/^https?:\/\//, "")}` : null,
    raw: validate,
  };
}

function toNeoSymbol(token) {
  return `${token.exchange_segment}|${token.instrument_token}`;
}

function buildQuotesUrl(tokens, quoteType = "all") {
  const path = tokens.map(toNeoSymbol).join(",");
  return `${QUOTES_BASE}/${encodeURIComponent(path)}/${quoteType}`;
}

function asNumber(v) {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function normalizeQuoteProps(raw) {
  if (!raw || typeof raw !== "object") return null;
  const flat = { ...raw };
  if (raw.payload && typeof raw.payload === "object") Object.assign(flat, raw.payload);
  if (raw.data && typeof raw.data === "object" && !Array.isArray(raw.data)) {
    Object.assign(flat, raw.data);
  }

  const ltp = asNumber(
    flat.ltp ??
      flat.last_price ??
      flat.last_traded_price ??
      flat.LTP ??
      flat.lastPrice
  );
  const changePct = asNumber(
    flat.per_change ??
      flat.pChange ??
      flat.change_percent ??
      flat.percentChange ??
      flat.percentageChange
  );
  const change = asNumber(flat.change ?? flat.net_change ?? flat.absoluteChange);
  const prevClose = asNumber(
    flat.prev_close ?? flat.previous_close ?? flat.close_price ?? flat.prevClose
  );

  let pct = changePct;
  if (pct == null && ltp != null && prevClose != null && prevClose !== 0) {
    pct = ((ltp - prevClose) / prevClose) * 100;
  }

  if (ltp == null) return null;
  return {
    value: ltp,
    change: change != null ? change : prevClose != null ? ltp - prevClose : null,
    pChange: pct,
    previousClose: prevClose,
  };
}

function extractQuoteList(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.result)) return payload.result;
  if (Array.isArray(payload.quotes)) return payload.quotes;
  if (payload.data && typeof payload.data === "object" && !Array.isArray(payload.data)) {
    return Object.values(payload.data);
  }
  if (typeof payload === "object") {
    const values = Object.values(payload).filter((v) => v && typeof v === "object");
    if (values.length) return values;
  }
  return [payload];
}

function matchQuote(list, token) {
  const want = String(token.instrument_token).toLowerCase();
  const wantSym = toNeoSymbol(token).toLowerCase();
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const keys = [
      item.instrument_token,
      item.trading_symbol,
      item.symbol,
      item.pSymbol,
      item.neo_symbol,
      item.display_symbol,
      item.tok,
      item.ts,
    ]
      .filter(Boolean)
      .map((x) => String(x).toLowerCase());
    if (keys.some((k) => k === want || k === wantSym || k.includes(want))) {
      return item;
    }
  }
  return list.length === 1 ? list[0] : null;
}

/**
 * Fetch live quotes keyed by caller id.
 * @param {Array<{ id: string, instrument_token: string, exchange_segment?: string }>} entries
 * @returns {Promise<Map<string, { last: number, change: number|null, changePct: number|null, previousClose: number|null }>>}
 */
async function fetchKotakQuotesByIds(entries, options = {}) {
  if (!isKotakConfigured()) {
    throw new Error("KOTAK_NEO_CONSUMER_KEY is not set");
  }
  const consumerKey = getConsumerKey();
  const tokens = (entries || [])
    .filter((e) => e?.id && e?.instrument_token)
    .map((e) => ({
      id: e.id,
      token: {
        instrument_token: e.instrument_token,
        exchange_segment: e.exchange_segment || "nse_cm",
      },
    }));

  if (!tokens.length) return new Map();

  const uniqueTokens = [];
  const seen = new Set();
  for (const t of tokens) {
    const key = toNeoSymbol(t.token);
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueTokens.push(t.token);
  }

  const url = buildQuotesUrl(uniqueTokens, options.quoteType || "all");
  const fetchJson = options.fetchImpl || neoFetch;
  const payload = await fetchJson(url, {
    method: "GET",
    headers: { Authorization: consumerKey },
    timeoutMs: options.timeoutMs || 15000,
  });

  const list = extractQuoteList(payload);
  const out = new Map();
  for (const { id, token } of tokens) {
    const raw = matchQuote(list, token);
    const q = normalizeQuoteProps(raw);
    if (!q) continue;
    out.set(id, {
      last: q.value,
      change: q.change,
      changePct: q.pChange,
      previousClose: q.previousClose,
    });
  }
  return out;
}

/**
 * Fetch live quotes for Neo index tokens by friendly name.
 * @returns {Promise<Map<string, { value: number, change: number|null, pChange: number|null }>>}
 */
async function fetchKotakQuotes(indexNames, options = {}) {
  const names = indexNames || Object.keys(INDEX_TOKENS);
  const entries = names
    .map((n) => {
      const token = INDEX_TOKENS[n];
      if (!token) return null;
      return { id: n, ...token };
    })
    .filter(Boolean);

  const byId = await fetchKotakQuotesByIds(entries, options);
  const out = new Map();
  for (const [name, q] of byId) {
    out.set(name, {
      value: q.last,
      change: q.change,
      pChange: q.changePct,
      previousClose: q.previousClose,
    });
  }
  return out;
}

/** Overview strip + size + sector quotes via Kotak Neo (by INDEX_TOKENS names). */
async function fetchKotakOverviewQuotes(options = {}) {
  return fetchKotakQuotes(Object.keys(INDEX_TOKENS), options);
}

function getKotakStatus() {
  const configured = isKotakConfigured();
  const hasLogin =
    Boolean(getEnvAny(["KOTAK_NEO_MOBILE", "KOTAK_MOBILE", "MOBILE_NUMBER"])) &&
    Boolean(getEnvAny(["KOTAK_NEO_UCC", "KOTAK_UCC", "UCC"])) &&
    Boolean(getEnvAny(["KOTAK_NEO_MPIN", "KOTAK_MPIN", "MPIN"])) &&
    (Boolean(getEnvAny(["KOTAK_NEO_TOTP_SECRET", "KOTAK_TOTP_SECRET", "TOTP_SECRET"])) ||
      Boolean(getEnv("KOTAK_NEO_TOTP")));
  return {
    configured,
    quotesReady: configured,
    loginReady: configured && hasLogin,
    provider: configured ? "kotak-neo" : null,
  };
}

module.exports = {
  INDEX_TOKENS,
  isKotakConfigured,
  generateTotp,
  createKotakSession,
  fetchKotakQuotes,
  fetchKotakQuotesByIds,
  fetchKotakOverviewQuotes,
  getKotakStatus,
  buildQuotesUrl,
  normalizeQuoteProps,
  toNeoSymbol,
  extractQuoteList,
  matchQuote,
};
