const fs = require('node:fs');
const path = require('node:path');

const SCREENER_BASE = 'https://www.screener.in/company';
const CACHE_DIR = path.join(__dirname, '..', 'data', 'screener-cache');
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function parseNumber(str) {
  if (str == null || str === '') return null;
  const cleaned = String(str).replace(/,/g, '').replace(/[^\d.-]/g, '');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

function parsePercent(str) {
  if (str == null) return null;
  const n = parseNumber(String(str).replace('%', ''));
  return n;
}

function parseTopRatios(html) {
  const ratios = {};
  const block = html.match(/<ul id="top-ratios">([\s\S]*?)<\/ul>/);
  if (!block) return ratios;
  const re = /<span class="name">\s*([\s\S]*?)\s*<\/span>[\s\S]*?<span class="number">([^<]+)<\/span>/g;
  let m;
  while ((m = re.exec(block[1])) !== null) {
    const name = m[1].replace(/\s+/g, ' ').trim();
    const val = parseNumber(m[2]);
    if (name && val != null) ratios[name] = val;
  }
  return ratios;
}

function parseCompoundedTable(html, title, period = 'TTM') {
  const re = new RegExp(
    `<th colspan="2">${title}</th>[\\s\\S]*?<td>${period}:</td>\\s*<td>([^<]+)</td>`,
    'i',
  );
  const m = html.match(re);
  return m ? parsePercent(m[1]) : null;
}

function parseQuarterlyProfitVar(html) {
  const rowMatch = html.match(/Net Profit[\s\S]*?<\/button>[\s\S]*?<\/td>([\s\S]*?)<\/tr>/);
  if (!rowMatch) return null;
  const cells = [...rowMatch[1].matchAll(/<td[^>]*>\s*([\d,]+)\s*<\/td>/g)].map((m) => parseNumber(m[1]));
  if (cells.length < 2) return null;
  const latest = cells[cells.length - 1];
  const prev = cells[cells.length - 2];
  if (!latest || !prev) return null;
  return ((latest - prev) / Math.abs(prev)) * 100;
}

function parseScreenerHtml(html, symbol) {
  const top = parseTopRatios(html);
  const salesGrowthTtm = parseCompoundedTable(html, 'Compounded Sales Growth', 'TTM');
  const profitGrowthTtm = parseCompoundedTable(html, 'Compounded Profit Growth', 'TTM');
  const salesGrowth3y = parseCompoundedTable(html, 'Compounded Sales Growth', '3 Years');
  const profitGrowth3y = parseCompoundedTable(html, 'Compounded Profit Growth', '3 Years');
  const qtrProfitVar = parseQuarterlyProfitVar(html);

  return {
    symbol,
    roce: top.ROCE ?? null,
    roe: top.ROE ?? null,
    pe: top['Stock P/E'] ?? top['P/E'] ?? null,
    marketCapCr: top['Market Cap'] ?? null,
    salesGrowthTtm,
    profitGrowthTtm,
    salesGrowth3y,
    profitGrowth3y,
    qtrProfitVar,
    epsGrowthYoy: profitGrowthTtm ?? profitGrowth3y,
    revenueGrowthYoy: salesGrowthTtm ?? salesGrowth3y,
  };
}

function cachePath(symbol) {
  const day = new Date().toISOString().slice(0, 10);
  return path.join(CACHE_DIR, `${symbol}_${day}.json`);
}

function readCache(symbol) {
  try {
    const p = cachePath(symbol);
    if (!fs.existsSync(p)) return null;
    const stat = fs.statSync(p);
    if (Date.now() - stat.mtimeMs > CACHE_TTL_MS) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function writeCache(symbol, data) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(cachePath(symbol), JSON.stringify(data));
}

async function fetchScreenerFundamentals(symbol, fetchImpl = fetch) {
  const cached = readCache(symbol);
  if (cached) return cached;

  const url = `${SCREENER_BASE}/${encodeURIComponent(symbol)}/consolidated/`;
  const resp = await fetchImpl(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 PowerBullPro/1.0', Accept: 'text/html' },
    signal: AbortSignal.timeout(20000),
  });

  if (resp.status === 404) {
    const standalone = await fetchImpl(`${SCREENER_BASE}/${encodeURIComponent(symbol)}/`, {
      headers: { 'User-Agent': 'Mozilla/5.0 PowerBullPro/1.0' },
      signal: AbortSignal.timeout(20000),
    });
    if (!standalone.ok) throw new Error(`Screener.in: ${symbol} not found`);
    const html = await standalone.text();
    const data = parseScreenerHtml(html, symbol);
    writeCache(symbol, data);
    return data;
  }

  if (!resp.ok) throw new Error(`Screener.in ${symbol}: HTTP ${resp.status}`);
  const html = await resp.text();
  const data = parseScreenerHtml(html, symbol);
  writeCache(symbol, data);
  return data;
}

function applyFundamentalBonus(result, fundamentals) {
  if (!fundamentals) return result;
  let bonus = 0;
  const reasonsPass = [...(result.reasonsPass || [])];
  const reasonsFail = [...(result.reasonsFail || [])];

  if (fundamentals.roce != null && fundamentals.roce >= 15) {
    bonus += 3;
    reasonsPass.push(`✓ ROCE ${fundamentals.roce}% (Screener.in)`);
  } else if (fundamentals.roce != null) {
    reasonsFail.push(`✗ ROCE ${fundamentals.roce}% below 15%`);
  }

  if (fundamentals.salesGrowthTtm != null && fundamentals.salesGrowthTtm >= 15) {
    bonus += 3;
    reasonsPass.push(`✓ Sales growth TTM ${fundamentals.salesGrowthTtm}%`);
  }

  if (fundamentals.profitGrowthTtm != null && fundamentals.profitGrowthTtm >= 25) {
    bonus += 4;
    reasonsPass.push(`✓ Profit growth TTM ${fundamentals.profitGrowthTtm}%`);
  } else if (fundamentals.qtrProfitVar != null && fundamentals.qtrProfitVar >= 50) {
    bonus += 4;
    reasonsPass.push(`✓ Qtr profit var ${fundamentals.qtrProfitVar.toFixed(0)}%`);
  }

  const strengthScore = Math.min((result.strengthScore || 0) + bonus, 100);
  let tier = result.tier;
  if (strengthScore >= 85) tier = 'A+';
  else if (strengthScore >= 70) tier = 'A';
  else if (strengthScore >= 55) tier = 'B';
  else tier = 'Skip';

  return {
    ...result,
    strengthScore,
    tier,
    qualifies: strengthScore >= 55 && result.stage !== 'FAILED',
    fundamentals,
    reasonsPass,
    reasonsFail,
  };
}

async function enrichResultsWithFundamentals(results, {
  market = 'NSE',
  minScore = 55,
  maxFetch = 30,
  throttleMs = 800,
  fetchImpl = fetch,
} = {}) {
  const candidates = results
    .filter((r) => r.market === market && r.strengthScore >= minScore)
    .slice(0, maxFetch);

  const enriched = [...results];
  for (let i = 0; i < candidates.length; i++) {
    const item = candidates[i];
    try {
      const fundamentals = await fetchScreenerFundamentals(item.symbol, fetchImpl);
      const updated = applyFundamentalBonus(item, fundamentals);
      const idx = enriched.findIndex((r) => r.symbol === item.symbol && r.market === item.market);
      if (idx >= 0) enriched[idx] = updated;
    } catch {
      // skip failed fetches
    }
    if (i < candidates.length - 1) await new Promise((r) => setTimeout(r, throttleMs));
  }

  enriched.sort((a, b) => b.strengthScore - a.strengthScore);
  return enriched;
}

module.exports = {
  parseScreenerHtml,
  parseTopRatios,
  fetchScreenerFundamentals,
  applyFundamentalBonus,
  enrichResultsWithFundamentals,
};
