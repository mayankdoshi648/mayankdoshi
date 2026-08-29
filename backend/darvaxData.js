const { fetchDhanDailyCandles } = require('./dhanHistorical');

const YAHOO_CHART = 'https://query1.finance.yahoo.com/v8/finance/chart';

function yahooSymbol(symbol, market) {
  if (market === 'NSE') return symbol.includes('.') ? symbol : `${symbol}.NS`;
  return symbol.replace(/\.NS$/, '');
}

async function fetchYahooDailyCandles(symbol, market, range = '2y', fetchImpl = fetch) {
  const ySym = yahooSymbol(symbol, market);
  const url = `${YAHOO_CHART}/${encodeURIComponent(ySym)}?interval=1d&range=${range}`;
  const resp = await fetchImpl(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 PowerBullPro/1.0' },
    signal: AbortSignal.timeout(20000),
  });
  if (!resp.ok) throw new Error(`Yahoo chart failed for ${ySym}: HTTP ${resp.status}`);
  const body = await resp.json();
  const result = body.chart?.result?.[0];
  if (!result?.timestamp?.length) throw new Error(`No data for ${ySym}`);

  const quotes = result.indicators.quote[0];
  return result.timestamp.map((ts, i) => ({
    time: ts * 1000,
    open: quotes.open[i],
    high: quotes.high[i],
    low: quotes.low[i],
    close: quotes.close[i],
    volume: quotes.volume[i] || 0,
  })).filter((c) => c.close != null && c.open != null);
}

/**
 * Fetch daily candles — NSE via Dhan when credentials/map available, else Yahoo fallback.
 * US always uses Yahoo.
 */
async function fetchDailyCandles(symbol, market, options = {}) {
  const {
    range = '2y',
    fetchImpl = fetch,
    dhan = null,
    instrumentMap = null,
  } = typeof options === 'string' ? { range: options, fetchImpl: arguments[3] } : options;

  if (market === 'NSE' && dhan?.accessToken && dhan?.clientId && instrumentMap) {
    const securityId = instrumentMap.get(symbol);
    if (securityId) {
      try {
        const years = range === '1y' ? 1 : 2;
        return await fetchDhanDailyCandles({
          securityId,
          accessToken: dhan.accessToken,
          clientId: dhan.clientId,
          years,
        }, fetchImpl);
      } catch (err) {
        if (dhan.strict) throw err;
      }
    }
  }

  return fetchYahooDailyCandles(symbol, market, range, fetchImpl);
}

function computeRsPercentiles(results) {
  const sorted = [...results].sort((a, b) => (b.rsRaw ?? 0) - (a.rsRaw ?? 0));
  const n = sorted.length;
  const map = new Map();
  sorted.forEach((r, i) => {
    const pctile = n <= 1 ? 50 : ((n - 1 - i) / (n - 1)) * 100;
    map.set(r.symbol, pctile);
  });
  return map;
}

module.exports = {
  fetchDailyCandles,
  fetchYahooDailyCandles,
  yahooSymbol,
  computeRsPercentiles,
};
