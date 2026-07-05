// backend/instrumentMap.js
const FETCH_TIMEOUT_MS = 15000;
const NIFTY50_CSV_URL = 'https://archives.nseindia.com/content/indices/ind_nifty50list.csv';
const DHAN_SCRIP_MASTER_URL = 'https://images.dhan.co/api-data/api-scrip-master.csv';

function parseNifty50Csv(csvText) {
  const lines = csvText.trim().split('\n');
  const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const symbolIdx = header.indexOf('symbol');
  return lines.slice(1).map((line) => line.split(',')[symbolIdx].trim());
}

function parseDhanScripMaster(csvText) {
  const lines = csvText.trim().split('\n');
  const header = lines[0].split(',');
  const exchIdx = header.indexOf('SEM_EXM_EXCH_ID');
  const segIdx = header.indexOf('SEM_SEGMENT');
  const seriesIdx = header.indexOf('SEM_SERIES');
  const symbolIdx = header.indexOf('SEM_TRADING_SYMBOL');
  const secIdIdx = header.indexOf('SEM_SMST_SECURITY_ID');

  const bySymbol = new Map();
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    if (cols[exchIdx] === 'NSE' && cols[segIdx] === 'E' && cols[seriesIdx] === 'EQ') {
      bySymbol.set(cols[symbolIdx], cols[secIdIdx]);
    }
  }
  return bySymbol;
}

async function resolveNifty50InstrumentMap(fetchImpl = fetch) {
  const csvResp = await fetchImpl(NIFTY50_CSV_URL, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!csvResp.ok) throw new Error(`Failed to fetch Nifty50 list: HTTP ${csvResp.status}`);
  const symbols = parseNifty50Csv(await csvResp.text());

  const scripResp = await fetchImpl(DHAN_SCRIP_MASTER_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!scripResp.ok) throw new Error(`Failed to fetch Dhan scrip master: HTTP ${scripResp.status}`);
  const bySymbol = parseDhanScripMaster(await scripResp.text());

  const map = new Map();
  for (const symbol of symbols) {
    const securityId = bySymbol.get(symbol);
    if (securityId) map.set(symbol, securityId);
  }
  return map;
}

module.exports = { resolveNifty50InstrumentMap, parseNifty50Csv, parseDhanScripMaster };
