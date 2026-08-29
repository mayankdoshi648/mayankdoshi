// backend/instrumentMap.js
const FETCH_TIMEOUT_MS = 15000;
const NIFTY50_CSV_URL = 'https://archives.nseindia.com/content/indices/ind_nifty50list.csv';
const NIFTY500_CSV_URL = 'https://archives.nseindia.com/content/indices/ind_nifty500list.csv';
const DHAN_SCRIP_MASTER_URL = 'https://images.dhan.co/api-data/api-scrip-master.csv';

function parseIndexCsv(csvText) {
  const lines = csvText.trim().split('\n');
  const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const symbolIdx = header.indexOf('symbol');
  return lines.slice(1).map((line) => line.split(',')[symbolIdx].trim());
}

function parseNifty50Csv(csvText) {
  return parseIndexCsv(csvText);
}

function parseNifty500Csv(csvText) {
  return parseIndexCsv(csvText);
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

async function loadDhanScripMaster(fetchImpl = fetch) {
  const scripResp = await fetchImpl(DHAN_SCRIP_MASTER_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!scripResp.ok) throw new Error(`Failed to fetch Dhan scrip master: HTTP ${scripResp.status}`);
  return parseDhanScripMaster(await scripResp.text());
}

async function resolveInstrumentMap(symbols, fetchImpl = fetch) {
  const bySymbol = await loadDhanScripMaster(fetchImpl);
  const map = new Map();
  for (const symbol of symbols) {
    const securityId = bySymbol.get(symbol);
    if (securityId) map.set(symbol, securityId);
  }
  return map;
}

async function resolveNifty50InstrumentMap(fetchImpl = fetch) {
  const csvResp = await fetchImpl(NIFTY50_CSV_URL, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!csvResp.ok) throw new Error(`Failed to fetch Nifty50 list: HTTP ${csvResp.status}`);
  const symbols = parseNifty50Csv(await csvResp.text());
  return resolveInstrumentMap(symbols, fetchImpl);
}

async function resolveNseInstrumentMap(symbols, fetchImpl = fetch) {
  return resolveInstrumentMap(symbols, fetchImpl);
}

module.exports = {
  resolveNifty50InstrumentMap,
  resolveNseInstrumentMap,
  resolveInstrumentMap,
  loadDhanScripMaster,
  parseNifty50Csv,
  parseNifty500Csv,
  parseDhanScripMaster,
  NIFTY500_CSV_URL,
};
