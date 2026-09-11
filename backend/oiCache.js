'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * Persist last-seen futures OI so oiChangePct survives process restarts.
 * Never stores tokens — only symbol → { oi, at }.
 */

function createOiCache({ filePath = path.join(process.cwd(), 'data', 'oi-cache.json') } = {}) {
  /** @type {Map<string, { oi: number, at: string }>} */
  let map = new Map();

  function load() {
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const json = JSON.parse(raw);
      map = new Map(Object.entries(json.symbols || {}));
    } catch {
      map = new Map();
    }
  }

  function save() {
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      const symbols = Object.fromEntries(map.entries());
      fs.writeFileSync(filePath, `${JSON.stringify({ updatedAt: new Date().toISOString(), symbols }, null, 2)}\n`);
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
