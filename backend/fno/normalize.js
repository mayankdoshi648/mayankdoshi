'use strict';

/**
 * Coerce to finite number or null — never invent missing numerics.
 * @param {*} v
 * @returns {number|null}
 */
function num(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * DataEnvelope: { data, meta: { asOf, source, isMock, stale, error } }
 * @param {*} data
 * @param {object} [meta]
 */
function dataEnvelope(data, meta = {}) {
  const out = {
    data,
    meta: {
      asOf: meta.asOf || new Date().toISOString(),
      source: meta.source || null,
      isMock: Boolean(meta.isMock),
      stale: Boolean(meta.stale),
      error: meta.error ?? null,
    },
  };
  if (meta.warning != null) out.meta.warning = meta.warning;
  return out;
}

/**
 * MarketQuote canonical shape.
 * @param {object} raw
 * @param {string} [source]
 */
function normalizeQuote(raw = {}, source = null) {
  const ohlc = raw.ohlc || {};
  const ltp = num(raw.ltp ?? raw.last_price ?? raw.last ?? raw.lastPrice);
  const prevClose = num(
    raw.prevClose ?? raw.previousClose ?? raw.previous_close_price ?? ohlc.close ?? raw.close,
  );
  let change = num(raw.change ?? raw.net_change ?? raw.variation);
  let changePct = num(raw.changePct ?? raw.percentChange ?? raw.pChange ?? raw.change_percent);
  if (change == null && ltp != null && prevClose != null) change = ltp - prevClose;
  if (changePct == null && change != null && prevClose != null && prevClose !== 0) {
    changePct = (change / prevClose) * 100;
  }

  const oi = num(raw.oi ?? raw.openInterest ?? raw.open_interest);
  const previousOi = num(raw.previousOi ?? raw.previous_oi ?? raw.prevOi);
  let oiChange = num(raw.oiChange ?? raw.oi_change);
  if (oiChange == null && oi != null && previousOi != null) oiChange = oi - previousOi;

  return {
    symbol: raw.symbol != null ? String(raw.symbol) : (raw.label != null ? String(raw.label) : ''),
    segment: raw.segment ?? raw.exchangeSegment ?? raw.seg ?? null,
    ltp,
    change,
    changePct,
    open: num(raw.open ?? ohlc.open),
    high: num(raw.high ?? ohlc.high ?? raw.dayHigh),
    low: num(raw.low ?? ohlc.low ?? raw.dayLow),
    prevClose,
    volume: num(raw.volume ?? raw.vol ?? raw.totalTradedVolume),
    vwap: num(raw.vwap ?? raw.average_price ?? raw.averagePrice),
    oi,
    oiChange,
    iv: num(raw.iv ?? raw.implied_volatility ?? raw.impliedVolatility),
    timestamp: raw.timestamp ?? raw.last_trade_time ?? raw.asOf ?? null,
    source: source ?? raw.source ?? null,
    stale: Boolean(raw.stale),
  };
}

/**
 * Normalize CE/PE option leg. Missing numerics → null.
 * @param {object} raw
 */
function normalizeOptionLeg(raw) {
  if (!raw || typeof raw !== 'object') {
    return {
      oi: null,
      previousOi: null,
      oiChange: null,
      volume: null,
      iv: null,
      ltp: null,
      change: null,
      bid: null,
      ask: null,
      averagePrice: null,
      securityId: null,
      greeks: null,
    };
  }

  const oi = num(raw.oi ?? raw.openInterest);
  const previousOi = num(raw.previousOi ?? raw.previous_oi ?? raw.prevOi);
  let oiChange = num(raw.oiChange ?? raw.oi_change);
  if (oiChange == null && oi != null && previousOi != null) oiChange = oi - previousOi;

  const ltp = num(raw.ltp ?? raw.last_price ?? raw.lastPrice);
  const prevClose = num(raw.previous_close_price ?? raw.prevClose ?? raw.previousClose);
  let change = num(raw.change ?? raw.net_change);
  if (change == null && ltp != null && prevClose != null) change = ltp - prevClose;

  const greeksRaw = raw.greeks && typeof raw.greeks === 'object' ? raw.greeks : null;
  const greeks = greeksRaw
    ? {
        delta: num(greeksRaw.delta),
        gamma: num(greeksRaw.gamma),
        theta: num(greeksRaw.theta),
        vega: num(greeksRaw.vega),
      }
    : null;

  const securityIdRaw = raw.securityId ?? raw.security_id;
  let securityId = null;
  if (securityIdRaw != null && securityIdRaw !== '') {
    const n = Number(securityIdRaw);
    securityId = Number.isFinite(n) ? n : String(securityIdRaw);
  }

  return {
    oi,
    previousOi,
    oiChange,
    volume: num(raw.volume),
    iv: num(raw.iv ?? raw.implied_volatility ?? raw.impliedVolatility),
    ltp,
    change,
    bid: num(raw.bid ?? raw.top_bid_price ?? raw.topBidPrice),
    ask: num(raw.ask ?? raw.top_ask_price ?? raw.topAskPrice),
    averagePrice: num(raw.averagePrice ?? raw.average_price),
    securityId,
    greeks,
  };
}

/**
 * OptionChainSnapshot skeleton from Dhan response. Strikes sorted ascending.
 * metrics/interpretation left empty for calculation engines.
 *
 * @param {object} dhanResponse
 * @param {{ underlying?: string, expiry?: string, asOf?: string, source?: string }} opts
 */
function normalizeOptionChain(dhanResponse, { underlying, expiry, asOf, source = 'dhan' } = {}) {
  const payload = dhanResponse?.data && (dhanResponse.data.oc != null || dhanResponse.data.last_price != null)
    ? dhanResponse.data
    : (dhanResponse || {});
  const oc = payload.oc || {};
  const spot = num(payload.last_price ?? payload.lastPrice ?? payload.spot);

  const strikes = Object.keys(oc)
    .map((k) => {
      const strike = num(k);
      if (strike == null) return null;
      const row = oc[k] || {};
      const hasCall = row.ce || row.call;
      const hasPut = row.pe || row.put;
      return {
        strike,
        call: hasCall ? normalizeOptionLeg(row.ce || row.call) : null,
        put: hasPut ? normalizeOptionLeg(row.pe || row.put) : null,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.strike - b.strike);

  let atm = null;
  if (spot != null && strikes.length) {
    let best = strikes[0];
    let bestDist = Math.abs(best.strike - spot);
    for (const s of strikes) {
      const d = Math.abs(s.strike - spot);
      if (d < bestDist) {
        best = s;
        bestDist = d;
      }
    }
    atm = best.strike;
  }

  return {
    underlying: underlying || null,
    expiry: expiry || null,
    spot,
    strikes,
    atm,
    metrics: {},
    interpretation: {},
    asOf: asOf || new Date().toISOString(),
    source,
  };
}

module.exports = {
  num,
  dataEnvelope,
  normalizeQuote,
  normalizeOptionLeg,
  normalizeOptionChain,
};
