#!/usr/bin/env node
/**
 * Refresh backend/fno/data/futuresSecurityIds.json from Dhan scrip master.
 * Run periodically (or before expiry roll) so Cloudflare Workers keep live F&O ids
 * without downloading the 25MB CSV at request time.
 *
 * Usage: node scripts/refresh-futures-security-ids.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { parseFuturesSecurityMap, DHAN_SCRIP_MASTER_URL } = require('../backend/fno/futuresSecurityMap');
const { ALL_SECTOR_FO_SYMBOLS } = require('../backend/fno/universe/sectors');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const outFile = path.join(root, 'backend/fno/data/futuresSecurityIds.json');

const INDICES = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY', 'SENSEX'];

async function main() {
  const symbols = [...new Set([...INDICES, ...ALL_SECTOR_FO_SYMBOLS])].map((s) => String(s).toUpperCase());
  console.log(`Fetching ${DHAN_SCRIP_MASTER_URL} …`);
  const resp = await fetch(DHAN_SCRIP_MASTER_URL, { signal: AbortSignal.timeout(120_000) });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const csv = await resp.text();
  const map = parseFuturesSecurityMap(csv, { symbols });
  const underlyings = Object.fromEntries(map.entries());
  const missing = symbols.filter((s) => !underlyings[s]);
  const payload = {
    asOf: new Date().toISOString(),
    source: DHAN_SCRIP_MASTER_URL,
    count: Object.keys(underlyings).length,
    missing,
    underlyings,
  };
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`Wrote ${path.relative(root, outFile)} (${payload.count} symbols, ${missing.length} missing)`);
  if (missing.length) console.log('Missing:', missing.join(', '));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
