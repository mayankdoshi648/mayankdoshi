#!/usr/bin/env node
/**
 * Daily DarvaX scanner
 * Usage:
 *   node scripts/darvax-scan.js [--market=NSE|US|ALL] [--export-obsidian] [--telegram]
 */
require('dotenv').config();
const { openDb, saveDarvaxScanResults } = require('../backend/db');
const { scanMarket, runFullScan } = require('../backend/darvaxScanner');
const { loadConfigOptional } = require('../backend/config');
const { enrichResultsWithFundamentals } = require('../backend/screenerFundamentals');
const { sendDarvaXAlerts } = require('../backend/telegramAlerts');
const { exportToObsidian } = require('../backend/obsidianExport');

function parseArgs() {
  const marketArg = process.argv.find((a) => a.startsWith('--market='));
  const market = marketArg ? marketArg.split('=')[1].toUpperCase() : 'ALL';
  return {
    market,
    exportObsidian: process.argv.includes('--export-obsidian'),
    telegram: process.argv.includes('--telegram'),
  };
}

async function main() {
  const { market, exportObsidian, telegram } = parseArgs();
  const config = loadConfigOptional();
  const style = process.env.DARVAX_STYLE || 'swing';
  const db = openDb();
  const scanDate = new Date().toISOString().slice(0, 10);
  const obsidianVaultPath = exportObsidian ? process.env.OBSIDIAN_VAULT_PATH : null;

  if (market === 'ALL') {
    const full = await runFullScan({
      style,
      config: config.clientId ? config : null,
      obsidianVaultPath,
      obsidianMinScore: Number(process.env.OBSIDIAN_MIN_SCORE || 55),
      sendTelegram: telegram,
      fundamentalsMaxFetch: config.fundamentalsMaxFetch ?? 30,
      onProgress: ({ market: mkt, symbol, index, total, dataSource }) => {
        process.stdout.write(`\r  ${mkt} [${dataSource}] ${index}/${total} ${symbol}    `);
      },
    });
    console.log(`\nNSE: ${full.nse.results.length} (${full.nse.dataSource}), US: ${full.us.results.length} (${full.us.dataSource})`);
    saveDarvaxScanResults(db, scanDate, 'NSE', full.nse.results);
    saveDarvaxScanResults(db, scanDate, 'US', full.us.results);
    if (full.obsidian) console.log(`Obsidian: ${full.obsidian.exportedCount} notes → ${full.obsidian.dailyPath}`);
    if (full.telegram?.sent) console.log(`Telegram: sent ${full.telegram.count} alerts`);
    return;
  }

  console.log(`Scanning ${market}...`);
  let { results, errors, dataSource } = await scanMarket(market, { style, config: config.clientId ? config : null });

  if (market === 'NSE') {
    results = await enrichResultsWithFundamentals(results, {
      minScore: 55,
      maxFetch: config.fundamentalsMaxFetch ?? 30,
    });
  }

  console.log(`\n  Saved ${results.length} results (${errors.length} errors) via ${dataSource}`);
  saveDarvaxScanResults(db, scanDate, market, results);

  if (telegram) {
    const tg = await sendDarvaXAlerts({
      scanDate,
      nseResults: market === 'NSE' ? results : [],
      usResults: market === 'US' ? results : [],
      config,
    });
    if (tg.sent) console.log(`  Telegram: ${tg.count} alerts sent`);
  }

  if (exportObsidian && obsidianVaultPath) {
    const payload = market === 'NSE'
      ? { nseResults: results, usResults: [] }
      : { nseResults: [], usResults: results };
    const obs = exportToObsidian({ vaultPath: obsidianVaultPath, scanDate, ...payload, minScore: 55 });
    console.log(`  Obsidian: ${obs.exportedCount} notes → ${obs.dailyPath}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
