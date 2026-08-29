#!/usr/bin/env node
/**
 * Rebuild backend/universe/nse500.json and us500.json from official sources.
 * Run: node scripts/build-universe.js
 */
const fs = require('node:fs');
const path = require('node:path');

const NIFTY500_URL = 'https://archives.nseindia.com/content/indices/ind_nifty500list.csv';
const SP500_URL = 'https://raw.githubusercontent.com/datasets/s-and-p-500-companies/master/data/constituents.csv';

function parseCsvSymbols(csvText, symbolHeader) {
  const lines = csvText.trim().split('\n');
  const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const idx = header.indexOf(symbolHeader.toLowerCase());
  if (idx < 0) throw new Error(`Column ${symbolHeader} not found in CSV header`);
  return lines.slice(1)
    .map((line) => {
      const cols = line.split(',');
      return cols[idx]?.trim();
    })
    .filter(Boolean);
}

async function main() {
  const fetchImpl = globalThis.fetch;
  const outDir = path.join(__dirname, '..', 'backend', 'universe');

  console.log('Fetching Nifty 500...');
  const nseResp = await fetchImpl(NIFTY500_URL, {
    headers: { 'User-Agent': 'Mozilla/5.0 PowerBullPro/1.0' },
    signal: AbortSignal.timeout(30000),
  });
  if (!nseResp.ok) throw new Error(`Nifty 500 fetch failed: ${nseResp.status}`);
  const nseSymbols = parseCsvSymbols(await nseResp.text(), 'Symbol');
  fs.writeFileSync(path.join(outDir, 'nse500.json'), `${JSON.stringify(nseSymbols, null, 2)}\n`);
  console.log(`  Wrote ${nseSymbols.length} NSE symbols`);

  console.log('Fetching S&P 500...');
  const usResp = await fetchImpl(SP500_URL, { signal: AbortSignal.timeout(30000) });
  if (!usResp.ok) throw new Error(`S&P 500 fetch failed: ${usResp.status}`);
  const usSymbols = parseCsvSymbols(await usResp.text(), 'Symbol');
  fs.writeFileSync(path.join(outDir, 'us500.json'), `${JSON.stringify(usSymbols, null, 2)}\n`);
  console.log(`  Wrote ${usSymbols.length} US symbols`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
