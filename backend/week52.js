// backend/week52.js — 52-week high/low calculations from daily candles

const TRADING_DAYS_52W = 252;

function sliceLastYear(candles, tradingDays = TRADING_DAYS_52W) {
  if (!Array.isArray(candles) || candles.length === 0) return [];
  return candles.slice(-tradingDays);
}

function compute52WeekStats(candles, ltp = null) {
  const window = sliceLastYear(candles);
  if (!window.length) {
    return {
      high52: null,
      low52: null,
      pctFromHigh: null,
      pctFromLow: null,
      rangePosition: null,
      daysInWindow: 0,
    };
  }

  let high52 = -Infinity;
  let low52 = Infinity;
  for (const c of window) {
    if (c.high != null && c.high > high52) high52 = c.high;
    if (c.low != null && c.low < low52) low52 = c.low;
  }

  if (!Number.isFinite(high52) || !Number.isFinite(low52)) {
    return {
      high52: null,
      low52: null,
      pctFromHigh: null,
      pctFromLow: null,
      rangePosition: null,
      daysInWindow: window.length,
    };
  }

  const price = ltp != null ? Number(ltp) : window[window.length - 1].close;
  const pctFromHigh = high52 > 0 ? ((price - high52) / high52) * 100 : null;
  const pctFromLow = low52 > 0 ? ((price - low52) / low52) * 100 : null;
  const span = high52 - low52;
  const rangePosition = span > 0 ? ((price - low52) / span) * 100 : null;

  return {
    high52: round2(high52),
    low52: round2(low52),
    pctFromHigh: pctFromHigh == null ? null : round2(pctFromHigh),
    pctFromLow: pctFromLow == null ? null : round2(pctFromLow),
    rangePosition: rangePosition == null ? null : round2(rangePosition),
    daysInWindow: window.length,
  };
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

module.exports = {
  TRADING_DAYS_52W,
  sliceLastYear,
  compute52WeekStats,
};
