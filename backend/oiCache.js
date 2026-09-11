'use strict';

/**
 * Persist last-seen futures OI so oiChangePct survives process restarts.
 * Never stores tokens — only symbol → { oi, at }.
 * On Cloudflare (POWERBULL_OI_MEMORY_ONLY=1) stays in-memory only.
 */

function createOiCache({
  filePath = null,
  memoryOnly = process.env.POWERBULL_OI_MEMORY_ONLY === '1'
    || process.env.POWERBULL_RUNTIME === 'cloudflare',
} = {}) {
  /** @type {Map<string, { oi: number, at: string }>} */
  let map = new Map();
  let resolvedPath = filePath;

  function ensurePath() {
    if (resolvedPath || memoryOnly) return resolvedPath;
    try {
      const path = require('node:path');
      resolvedPath = path.join(process.cwd(), 'data', 'oi-cache.json');
    } catch {
      resolvedPath = 'data/oi-cache.json';
    }
    return resolvedPath;
  }

  function load() {
    if (memoryOnly) {
      map = new Map();
      return;
    }
    try {
      const fs = require('node:fs');
      const raw = fs.readFileSync(ensurePath(), 'utf8');
      const json = JSON.parse(raw);
      map = new Map(Object.entries(json.symbols || {}));
    } catch {
      map = new Map();
    }
  }

  function save() {
    if (memoryOnly) return;
    try {
      const fs = require('node:fs');
      const path = require('node:path');
      const fp = ensurePath();
      fs.mkdirSync(path.dirname(fp), { recursive: true });
      const symbols = Object.fromEntries(map.entries());
      fs.writeFileSync(fp, `${JSON.stringify({ updatedAt: new Date().toISOString(), symbols }, null, 2)}\n`);
    } catch {
      /* ignore disk errors — in-memory still works */
    }
  }

  load();

  function get(symbol) {
    const hit = map.get(String(symbol).toUpperCase());
    return hit?.oi ?? null;
  }

  function setMany(rows) {
    let changed = false;
    for (const row of rows || []) {
      const symbol = String(row.symbol || '').toUpperCase();
      const oi = Number(row.oi);
      if (!symbol || !Number.isFinite(oi)) continue;
      const prev = map.get(symbol);
      if (!prev || prev.oi !== oi) {
        map.set(symbol, { oi, at: new Date().toISOString() });
        changed = true;
      }
    }
    if (changed) save();
  }

  function size() {
    return map.size;
  }

  return { get, setMany, size, load };
}

module.exports = { createOiCache };
