#!/usr/bin/env node
/**
 * Daily DarvaX scanner — run via cron before market open.
 * Usage: node scripts/darvax-scan.js [--market NSE|US|ALL]
 */
require('dotenv').config();
const { openDb, saveDarvaxScanResults } = require('../backend/db');
const { scanMarket } = require('../backend/darvaxScanner');

async function main() {
  const arg = process.argv.find((a) => a.startsWith('--market='));
  const marketArg = arg ? arg.split('=')[1].toUpperCase() : 'ALL';
  const style = process.env.DARVAX_STYLE || 'swing';
  const db = openDb();
  const scanDate = new Date().toISOString().slice(0, 10);

  const markets = marketArg === 'ALL' ? ['NSE', 'US'] : [marketArg];
  for (const market of markets) {
    console.log(`Scanning ${market}...`);
    const { results, errors } = await scanMarket(market, {
      style,
      onProgress: ({ symbol, index, total }) => {
        process.stdout.write(`\r  ${market} ${index}/${total} ${symbol}    `);
      },
    });
    console.log(`\n  Saved ${results.length} results (${errors.length} errors)`);
    saveDarvaxScanResults(db, scanDate, market, results);
    const qualified = results.filter((r) => r.qualifies);
    console.log(`  Qualified (score≥55): ${qualified.length}`);
    qualified.slice(0, 5).forEach((r) => {
      console.log(`    ${r.symbol} score=${r.strengthScore} stage=${r.stage}`);
    });
  }
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
