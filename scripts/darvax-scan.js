#!/usr/bin/env node
/**
 * Daily DarvaX scanner — run via cron before market open.
 * Usage:
 *   node scripts/darvax-scan.js [--market=NSE|US|ALL] [--export-obsidian]
 */
require('dotenv').config();
const { openDb, saveDarvaxScanResults } = require('../backend/db');
const { scanMarket, runFullScan } = require('../backend/darvaxScanner');
const { loadConfig } = require('../backend/config');

function parseArgs() {
  const marketArg = process.argv.find((a) => a.startsWith('--market='));
  const market = marketArg ? marketArg.split('=')[1].toUpperCase() : 'ALL';
  const exportObsidian = process.argv.includes('--export-obsidian');
  return { market, exportObsidian };
}

async function main() {
  const { market, exportObsidian } = parseArgs();
  let config;
  try {
    config = loadConfig();
  } catch {
    config = null;
    console.warn('Dhan credentials not set — NSE scan will use Yahoo Finance fallback');
  }

  const style = process.env.DARVAX_STYLE || 'swing';
  const db = openDb();
  const scanDate = new Date().toISOString().slice(0, 10);
  const obsidianVaultPath = exportObsidian ? process.env.OBSIDIAN_VAULT_PATH : null;

  if (market === 'ALL') {
    const full = await runFullScan({
      style,
      config,
      obsidianVaultPath,
      obsidianMinScore: Number(process.env.OBSIDIAN_MIN_SCORE || 55),
      onProgress: ({ market: mkt, symbol, index, total, dataSource }) => {
        process.stdout.write(`\r  ${mkt} [${dataSource}] ${index}/${total} ${symbol}    `);
      },
    });
    console.log(`\nNSE: ${full.nse.results.length} (${full.nse.dataSource}), US: ${full.us.results.length} (${full.us.dataSource})`);
    saveDarvaxScanResults(db, scanDate, 'NSE', full.nse.results);
    saveDarvaxScanResults(db, scanDate, 'US', full.us.results);
    if (full.obsidian) {
      console.log(`Obsidian: exported ${full.obsidian.exportedCount} stocks → ${full.obsidian.dailyPath}`);
    }
    return;
  }

  console.log(`Scanning ${market}...`);
  const { results, errors, dataSource } = await scanMarket(market, {
    style,
    config,
    onProgress: ({ symbol, index, total }) => {
      process.stdout.write(`\r  ${market} [${dataSource}] ${index}/${total} ${symbol}    `);
    },
  });
  console.log(`\n  Saved ${results.length} results (${errors.length} errors) via ${dataSource}`);
  saveDarvaxScanResults(db, scanDate, market, results);
  const qualified = results.filter((r) => r.qualifies);
  console.log(`  Qualified (score≥55): ${qualified.length}`);
  qualified.slice(0, 5).forEach((r) => {
    console.log(`    ${r.symbol} score=${r.strengthScore} stage=${r.stage}`);
  });

  if (exportObsidian && obsidianVaultPath) {
    const { exportToObsidian } = require('../backend/obsidianExport');
    const payload = market === 'NSE'
      ? { nseResults: results, usResults: [] }
      : { nseResults: [], usResults: results };
    const obs = exportToObsidian({
      vaultPath: obsidianVaultPath,
      scanDate,
      ...payload,
      minScore: Number(process.env.OBSIDIAN_MIN_SCORE || 55),
    });
    console.log(`  Obsidian: ${obs.exportedCount} notes → ${obs.dailyPath}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
