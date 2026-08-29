const YAHOO_CHART = 'https://query1.finance.yahoo.com/v8/finance/chart';

function yahooSymbol(symbol, market) {
  if (market === 'NSE') return symbol.includes('.') ? symbol : `${symbol}.NS`;
  return symbol.replace(/\.NS$/, '');
}

async function fetchDailyCandles(symbol, market, range = '2y', fetchImpl = fetch) {
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

module.exports = { fetchDailyCandles, yahooSymbol, computeRsPercentiles };
