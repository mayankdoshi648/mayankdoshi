const DHAN_HISTORICAL_URL = 'https://api.dhan.co/v2/charts/historical';

function dateRangeYears(years = 2) {
  const to = new Date();
  const from = new Date(to);
  from.setFullYear(from.getFullYear() - years);
  return {
    fromDate: from.toISOString().slice(0, 10),
    toDate: to.toISOString().slice(0, 10),
  };
}

function parseDhanHistoricalResponse(body) {
  if (!body?.timestamp?.length) return [];
  return body.timestamp.map((ts, i) => ({
    time: ts * 1000,
    open: body.open[i],
    high: body.high[i],
    low: body.low[i],
    close: body.close[i],
    volume: body.volume[i] || 0,
  })).filter((c) => c.close != null && c.open != null);
}

async function fetchDhanDailyCandles({
  securityId,
  accessToken,
  clientId,
  exchangeSegment = 'NSE_EQ',
  instrument = 'EQUITY',
  years = 2,
}, fetchImpl = fetch) {
  const { fromDate, toDate } = dateRangeYears(years);
  const resp = await fetchImpl(DHAN_HISTORICAL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'access-token': accessToken,
      'client-id': clientId,
    },
    body: JSON.stringify({
      securityId: String(securityId),
      exchangeSegment,
      instrument,
      expiryCode: 0,
      oi: false,
      fromDate,
      toDate,
    }),
    signal: AbortSignal.timeout(25000),
  });

  if (!resp.ok) {
    const errBody = await resp.text().catch(() => '');
    throw new Error(`Dhan historical ${securityId}: HTTP ${resp.status} ${errBody.slice(0, 120)}`);
  }
  const body = await resp.json();
  const candles = parseDhanHistoricalResponse(body);
  if (!candles.length) throw new Error(`Dhan historical ${securityId}: empty response`);
  return candles;
}

module.exports = {
  fetchDhanDailyCandles,
  parseDhanHistoricalResponse,
  dateRangeYears,
};
