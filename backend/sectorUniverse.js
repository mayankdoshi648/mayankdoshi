// backend/sectorUniverse.js — NSE constituents + industry (sector) mapping
const {
  loadDhanScripMaster,
  parseNifty50Csv,
  parseNifty500Csv,
  NIFTY500_CSV_URL,
} = require('./instrumentMap');

const NIFTY50_CSV_URL = 'https://archives.nseindia.com/content/indices/ind_nifty50list.csv';
const FETCH_TIMEOUT_MS = 20000;

function parseIndexCsvWithIndustry(csvText) {
  const lines = csvText.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const symbolIdx = header.indexOf('symbol');
  const industryIdx = header.indexOf('industry');
  const nameIdx = header.indexOf('company name');
  if (symbolIdx < 0) throw new Error('NSE index CSV missing Symbol column');

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    const symbol = (cols[symbolIdx] || '').trim();
    if (!symbol) continue;
    rows.push({
      symbol,
      name: nameIdx >= 0 ? (cols[nameIdx] || '').trim() : symbol,
      sector: industryIdx >= 0 ? (cols[industryIdx] || 'Unknown').trim() || 'Unknown' : 'Unknown',
    });
  }
  return rows;
}

async function fetchIndexUniverse(universe = 'nifty50', fetchImpl = fetch) {
  const url = universe === 'nifty500' ? NIFTY500_CSV_URL : NIFTY50_CSV_URL;
  const resp = await fetchImpl(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!resp.ok) throw new Error(`Failed to fetch ${universe} list: HTTP ${resp.status}`);
  return parseIndexCsvWithIndustry(await resp.text());
}

async function resolveDashboardUniverse(universe = 'nifty50', fetchImpl = fetch) {
  const [rows, scripMaster] = await Promise.all([
    fetchIndexUniverse(universe, fetchImpl),
    loadDhanScripMaster(fetchImpl),
  ]);

  const instruments = [];
  const missing = [];
  for (const row of rows) {
    const securityId = scripMaster.get(row.symbol);
    if (!securityId) {
      missing.push(row.symbol);
      continue;
    }
    instruments.push({
      symbol: row.symbol,
      name: row.name,
      sector: row.sector,
      securityId: String(securityId),
    });
  }

  const sectors = [...new Set(instruments.map((i) => i.sector))].sort();
  return { universe, instruments, sectors, missing };
}

function shortenSector(sector) {
  const map = {
    'Automobile and Auto Components': 'Auto',
    'Capital Goods': 'Capital Goods',
    Chemicals: 'Chemicals',
    Construction: 'Construction',
    'Construction Materials': 'Cement',
    'Consumer Durables': 'Durables',
    'Consumer Services': 'Consumer Svcs',
    Diversified: 'Diversified',
    'Fast Moving Consumer Goods': 'FMCG',
    'Financial Services': 'Financials',
    Healthcare: 'Healthcare',
    'Information Technology': 'IT',
    'Media Entertainment & Publication': 'Media',
    'Metals & Mining': 'Metals',
    'Oil Gas & Consumable Fuels': 'Oil & Gas',
    Power: 'Power',
    Realty: 'Realty',
    Services: 'Services',
    Telecommunication: 'Telecom',
    Textiles: 'Textiles',
  };
  return map[sector] || sector;
}

module.exports = {
  NIFTY50_CSV_URL,
  parseIndexCsvWithIndustry,
  fetchIndexUniverse,
  resolveDashboardUniverse,
  shortenSector,
  parseNifty50Csv,
  parseNifty500Csv,
};
