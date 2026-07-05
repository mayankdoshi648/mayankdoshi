# PowerBull Pro Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local Node.js dashboard that replicates powerbullstocks.com's layout and generates real BUY/SELL signals on live Nifty 50 data (5-min candles, 9:30-15:30 IST) via the Dhan API (DhanHQ v2), with chart view, track record, and alerts.

**Architecture:** `backend/` (Express + `ws` + Node's built-in `node:sqlite`) owns the Dhan live market feed connection, candle aggregation, a multi-indicator signal engine, SQLite persistence, and a REST + WebSocket API. `frontend/` is static HTML/CSS/JS (no build step) served by the same Express app, talking to the backend over `localhost`.

**Tech Stack:** Node.js 22.5+ (for built-in `node:sqlite`), Express, `ws`, `dotenv`, Chart.js + `chartjs-chart-financial` (via CDN in the frontend). Tests use Node's built-in `node:test` runner — no test framework dependency needed.

**Deviation note (recorded when the user switched broker mid-build, after Tasks 1-5 were already done):** the plan originally targeted the Upstox API (OAuth login, protobuf WebSocket feed). It now targets Dhan (DhanHQ v2) instead: a manually-generated 24-hour access token (no OAuth flow — simplest of Dhan's three auth methods, appropriate for a single-user personal app) and a binary WebSocket feed that is NOT protobuf — fixed-width struct packets, byte offsets confirmed against Dhan's official `dhanhq` Python SDK source (downloaded from PyPI, MIT-licensed, not guessed from docs alone). This removes the OAuth task entirely and drops the `protobufjs` dependency. Tasks 1-5 (market window, indicators, signal engine, DB, candle aggregator) are broker-agnostic and unaffected by this switch.

**Deviation note (recorded during Task 1):** the plan originally specified `better-sqlite3`. On the actual dev machine (Node 24.18, win32/x64), `better-sqlite3` has no prebuilt binary for that Node version and the machine lacks Visual Studio C++ build tools needed to compile it from source. Node's built-in `node:sqlite` (`DatabaseSync`) has the same `.prepare(sql).run()/.all()/.get()` shape, named (`@param`) and positional (`?`) binding, and `lastInsertRowid` on `run()` — confirmed by hand before switching. Task 4 below is written against `node:sqlite` directly; no `better-sqlite3` dependency exists in `package.json`.

## Global Constraints

- Personal/local use only — do not deploy publicly. "Power Bull" name/logo is a trademark of the real site's operator; keep this project's branding as a visual homage, not a public release.
- Dashboard must show a disclaimer: not real investment advice, no order execution, personal experiment only.
- Signal capture only runs 9:30-15:30 IST; outside that window the app reads the last saved day from SQLite instead of hitting Dhan.
- Signal score: EMA9/EMA21 cross (±1), RSI14 <30/>70 (±1), close vs session VWAP (±1), ×1.5 multiplier if candle volume > 1.5× rolling 20-candle average volume. Score ≥+2 → BUY, ≤−2 → SELL, else NEUTRAL. No signal until ≥21 candles buffered for that symbol.
- Track-record outcome: target/stoploss are **+0.5% / −0.3%** from signal price for BUY (mirrored for SELL), checked against every subsequent candle until hit or end-of-day (`EOD_CLOSE`).
- Universe: Nifty 50 only, resolved at startup from live NSE + Dhan's published scrip master — never hardcode a stock/SecurityId list in code (index membership and Dhan's internal IDs both change over time).
- Dhan auth: a single manually-generated 24-hour token (`DHAN_CLIENT_ID` + `DHAN_ACCESS_TOKEN` in `.env`). No OAuth flow, no token-refresh code in the app — the user regenerates the token at web.dhan.co and restarts the server each trading day.
- Dhan's v2 market feed sends fixed-width binary packets, not protobuf — decode with `Buffer` reads at the documented byte offsets (see Task 11), verified against the official `dhanhq` Python SDK source rather than guessed from prose docs.

---

## File Structure

```
powerbull-pro/
  package.json
  .env.example
  .gitignore
  docs/
    dhan-setup.md
  backend/
    config.js
    marketWindow.js
    marketWindow.test.js
    indicators.js
    indicators.test.js
    signalEngine.js
    signalEngine.test.js
    db.js
    db.test.js
    candleAggregator.js
    candleAggregator.test.js
    outcomeTracker.js
    outcomeTracker.test.js
    connectionStatus.js
    connectionStatus.test.js
    dhanFeed.js
    dhanFeed.test.js
    instrumentMap.js
    api.js
    api.test.js
    liveSocket.js
    liveSocket.test.js
    server.js
    test/fixtures/
      sample-candles.json
  frontend/
    index.html
    style.css
    app.js
```

---

### Task 1: Project scaffold + market-window utility

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `backend/marketWindow.js`
- Test: `backend/marketWindow.test.js`

**Interfaces:**
- Produces: `isMarketOpen(date = new Date()): boolean` — used by `api.js`, `server.js` to gate live ingestion.

- [ ] **Step 1: Write package.json**

```json
{
  "name": "powerbull-pro",
  "version": "0.1.0",
  "private": true,
  "type": "commonjs",
  "scripts": {
    "start": "node backend/server.js",
    "test": "node --test backend/**/*.test.js"
  },
  "engines": {
    "node": ">=22.5.0"
  },
  "dependencies": {
    "dotenv": "^16.4.5",
    "express": "^4.21.0",
    "ws": "^8.18.0"
  }
}
```

- [ ] **Step 2: Write .gitignore**

```
node_modules/
.env
data/*.db
data/*.db-journal
data/*.db-wal
data/*.db-shm
```

- [ ] **Step 3: Write .env.example**

```
DHAN_CLIENT_ID=
DHAN_ACCESS_TOKEN=
PORT=3000
```

- [ ] **Step 4: Install dependencies**

Run: `npm install`
Expected: `node_modules/` created, no errors.

- [ ] **Step 5: Write the failing test**

```js
// backend/marketWindow.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { isMarketOpen } = require('./marketWindow');

function istToUtc(y, m, d, hh, mm) {
  // IST is UTC+5:30 — build the UTC instant that corresponds to this IST wall time
  return new Date(Date.UTC(y, m - 1, d, hh, mm) - 5.5 * 60 * 60 * 1000);
}

test('open at 9:30 IST on a weekday', () => {
  assert.equal(isMarketOpen(istToUtc(2026, 7, 6, 9, 30)), true); // Monday
});

test('closed at 9:29 IST', () => {
  assert.equal(isMarketOpen(istToUtc(2026, 7, 6, 9, 29)), false);
});

test('open at 15:30 IST (inclusive close)', () => {
  assert.equal(isMarketOpen(istToUtc(2026, 7, 6, 15, 30)), true);
});

test('closed at 15:31 IST', () => {
  assert.equal(isMarketOpen(istToUtc(2026, 7, 6, 15, 31)), false);
});

test('closed on Saturday even during market hours', () => {
  assert.equal(isMarketOpen(istToUtc(2026, 7, 4, 12, 0)), false); // Saturday
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `node --test backend/marketWindow.test.js`
Expected: FAIL — `Cannot find module './marketWindow'`

- [ ] **Step 7: Write minimal implementation**

```js
// backend/marketWindow.js
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const OPEN_MINUTES = 9 * 60 + 30;
const CLOSE_MINUTES = 15 * 60 + 30;

function isMarketOpen(date = new Date()) {
  const ist = new Date(date.getTime() + IST_OFFSET_MS);
  const day = ist.getUTCDay();
  if (day === 0 || day === 6) return false;
  const totalMinutes = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  return totalMinutes >= OPEN_MINUTES && totalMinutes <= CLOSE_MINUTES;
}

module.exports = { isMarketOpen, IST_OFFSET_MS };
```

- [ ] **Step 8: Run test to verify it passes**

Run: `node --test backend/marketWindow.test.js`
Expected: 5 tests pass.

- [ ] **Step 9: Commit**

```bash
git add package.json .gitignore .env.example backend/marketWindow.js backend/marketWindow.test.js
git commit -m "chore: scaffold project, add market-window utility"
```

---

### Task 2: Indicator math library

**Files:**
- Create: `backend/indicators.js`
- Test: `backend/indicators.test.js`

**Interfaces:**
- Produces: `computeEMA(closes: number[], period: number): (number|null)[]`
- Produces: `computeRSI(closes: number[], period = 14): (number|null)[]`
- Produces: `computeSessionVWAP(candles: {high,low,close,volume}[]): (number|null)[]`
- Produces: `isVolumeSpike(volumes: number[], index: number, period = 20, multiplier = 1.5): boolean`
- Consumed by: `signalEngine.js` (Task 3).

- [ ] **Step 1: Write the failing tests**

```js
// backend/indicators.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { computeEMA, computeRSI, computeSessionVWAP, isVolumeSpike } = require('./indicators');

test('computeEMA returns null before warmup, then EMA values', () => {
  const closes = [10, 11, 12, 13, 14, 15, 16, 17, 18];
  const ema = computeEMA(closes, 3);
  assert.equal(ema[0], null);
  assert.equal(ema[1], null);
  assert.ok(Math.abs(ema[2] - 11) < 1e-9); // SMA seed of first 3
  assert.ok(ema[8] > ema[2]); // trending up
});

test('computeRSI treats flat prices as neutral (50), not 100', () => {
  const closes = new Array(20).fill(100);
  const rsi = computeRSI(closes, 14);
  assert.equal(rsi[13], null);
  assert.equal(rsi[14], 50);
});

test('computeRSI is high after a steady rally', () => {
  const closes = Array.from({ length: 20 }, (_, i) => 100 + i);
  const rsi = computeRSI(closes, 14);
  assert.ok(rsi[19] > 70);
});

test('computeSessionVWAP accumulates across the session', () => {
  const candles = [
    { high: 101, low: 99, close: 100, volume: 100 },
    { high: 103, low: 101, close: 102, volume: 300 },
  ];
  const vwap = computeSessionVWAP(candles);
  assert.ok(Math.abs(vwap[0] - 100) < 1e-9);
  assert.ok(vwap[1] > 100 && vwap[1] < 102);
});

test('isVolumeSpike detects >1.5x rolling average', () => {
  const volumes = new Array(20).fill(1000).concat([2000]);
  assert.equal(isVolumeSpike(volumes, 20, 20, 1.5), true);
  assert.equal(isVolumeSpike(volumes, 20, 20, 3), false);
});

test('isVolumeSpike is false before enough history', () => {
  const volumes = new Array(5).fill(1000);
  assert.equal(isVolumeSpike(volumes, 4, 20, 1.5), false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test backend/indicators.test.js`
Expected: FAIL — `Cannot find module './indicators'`

- [ ] **Step 3: Write implementation**

```js
// backend/indicators.js
function computeEMA(closes, period) {
  const result = new Array(closes.length).fill(null);
  if (closes.length < period) return result;
  const k = 2 / (period + 1);
  let sma = 0;
  for (let i = 0; i < period; i++) sma += closes[i];
  sma /= period;
  result[period - 1] = sma;
  let prevEma = sma;
  for (let i = period; i < closes.length; i++) {
    const ema = closes[i] * k + prevEma * (1 - k);
    result[i] = ema;
    prevEma = ema;
  }
  return result;
}

function rsiFromAverages(avgGain, avgLoss) {
  if (avgGain === 0 && avgLoss === 0) return 50;
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

function computeRSI(closes, period = 14) {
  const result = new Array(closes.length).fill(null);
  if (closes.length <= period) return result;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  result[period] = rsiFromAverages(avgGain, avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    result[i] = rsiFromAverages(avgGain, avgLoss);
  }
  return result;
}

function computeSessionVWAP(candles) {
  const result = new Array(candles.length).fill(null);
  let cumPV = 0;
  let cumVol = 0;
  for (let i = 0; i < candles.length; i++) {
    const typicalPrice = (candles[i].high + candles[i].low + candles[i].close) / 3;
    cumPV += typicalPrice * candles[i].volume;
    cumVol += candles[i].volume;
    result[i] = cumVol === 0 ? null : cumPV / cumVol;
  }
  return result;
}

function isVolumeSpike(volumes, index, period = 20, multiplier = 1.5) {
  if (index < period) return false;
  let sum = 0;
  for (let i = index - period; i < index; i++) sum += volumes[i];
  const avg = sum / period;
  return avg > 0 && volumes[index] > avg * multiplier;
}

module.exports = { computeEMA, computeRSI, computeSessionVWAP, isVolumeSpike };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test backend/indicators.test.js`
Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/indicators.js backend/indicators.test.js
git commit -m "feat: add EMA/RSI/VWAP/volume-spike indicator math"
```

---

### Task 3: Signal scoring engine

**Files:**
- Create: `backend/signalEngine.js`
- Create: `backend/test/fixtures/sample-candles.json`
- Test: `backend/signalEngine.test.js`

**Interfaces:**
- Consumes: `computeEMA`, `computeRSI`, `computeSessionVWAP`, `isVolumeSpike` from `./indicators` (Task 2).
- Produces: `evaluateSignal(candles: {open,high,low,close,volume}[]): { side: 'BUY'|'SELL'|'NEUTRAL', score: number }` — consumed by `server.js` ingestion pipeline (Task 10).
- Produces: `MIN_CANDLES` (= 21) — the warmup threshold.

- [ ] **Step 1: Write the fixture file**

```json
{
  "buyCandles": [
    {"open":100,"high":100.3,"low":99.7,"close":100,"volume":1000},
    {"open":99,"high":99.3,"low":98.7,"close":99,"volume":1000},
    {"open":98,"high":98.3,"low":97.7,"close":98,"volume":1000},
    {"open":97,"high":97.3,"low":96.7,"close":97,"volume":1000},
    {"open":96,"high":96.3,"low":95.7,"close":96,"volume":1000},
    {"open":95,"high":95.3,"low":94.7,"close":95,"volume":1000},
    {"open":94,"high":94.3,"low":93.7,"close":94,"volume":1000},
    {"open":93,"high":93.3,"low":92.7,"close":93,"volume":1000},
    {"open":92,"high":92.3,"low":91.7,"close":92,"volume":1000},
    {"open":91,"high":91.3,"low":90.7,"close":91,"volume":1000},
    {"open":90,"high":90.3,"low":89.7,"close":90,"volume":1000},
    {"open":89,"high":89.3,"low":88.7,"close":89,"volume":1000},
    {"open":88,"high":88.3,"low":87.7,"close":88,"volume":1000},
    {"open":87,"high":87.3,"low":86.7,"close":87,"volume":1000},
    {"open":86,"high":86.3,"low":85.7,"close":86,"volume":1000},
    {"open":85,"high":85.3,"low":84.7,"close":85,"volume":1000},
    {"open":84,"high":84.3,"low":83.7,"close":84,"volume":1000},
    {"open":83,"high":83.3,"low":82.7,"close":83,"volume":1000},
    {"open":82,"high":82.3,"low":81.7,"close":82,"volume":1000},
    {"open":85.5,"high":85.8,"low":85.2,"close":85.5,"volume":1000},
    {"open":89,"high":89.3,"low":88.7,"close":89,"volume":1000},
    {"open":92.5,"high":92.8,"low":92.2,"close":92.5,"volume":1000},
    {"open":96,"high":96.3,"low":95.7,"close":96,"volume":1000},
    {"open":99.5,"high":99.8,"low":99.2,"close":99.5,"volume":1000},
    {"open":103,"high":103.3,"low":102.7,"close":103,"volume":1000}
  ],
  "sellCandles": [
    {"open":100,"high":100.3,"low":99.7,"close":100,"volume":1000},
    {"open":101,"high":101.3,"low":100.7,"close":101,"volume":1000},
    {"open":102,"high":102.3,"low":101.7,"close":102,"volume":1000},
    {"open":103,"high":103.3,"low":102.7,"close":103,"volume":1000},
    {"open":104,"high":104.3,"low":103.7,"close":104,"volume":1000},
    {"open":105,"high":105.3,"low":104.7,"close":105,"volume":1000},
    {"open":106,"high":106.3,"low":105.7,"close":106,"volume":1000},
    {"open":107,"high":107.3,"low":106.7,"close":107,"volume":1000},
    {"open":108,"high":108.3,"low":107.7,"close":108,"volume":1000},
    {"open":109,"high":109.3,"low":108.7,"close":109,"volume":1000},
    {"open":110,"high":110.3,"low":109.7,"close":110,"volume":1000},
    {"open":111,"high":111.3,"low":110.7,"close":111,"volume":1000},
    {"open":112,"high":112.3,"low":111.7,"close":112,"volume":1000},
    {"open":113,"high":113.3,"low":112.7,"close":113,"volume":1000},
    {"open":114,"high":114.3,"low":113.7,"close":114,"volume":1000},
    {"open":115,"high":115.3,"low":114.7,"close":115,"volume":1000},
    {"open":116,"high":116.3,"low":115.7,"close":116,"volume":1000},
    {"open":117,"high":117.3,"low":116.7,"close":117,"volume":1000},
    {"open":118,"high":118.3,"low":117.7,"close":118,"volume":1000},
    {"open":114.5,"high":114.8,"low":114.2,"close":114.5,"volume":1000},
    {"open":111,"high":111.3,"low":110.7,"close":111,"volume":1000},
    {"open":107.5,"high":107.8,"low":107.2,"close":107.5,"volume":1000},
    {"open":104,"high":104.3,"low":103.7,"close":104,"volume":1000},
    {"open":100.5,"high":100.8,"low":100.2,"close":100.5,"volume":1000},
    {"open":97,"high":97.3,"low":96.7,"close":97,"volume":1000}
  ],
  "neutralCandles": [
    {"open":100,"high":100.3,"low":99.7,"close":100,"volume":1000},
    {"open":100,"high":100.3,"low":99.7,"close":100,"volume":1000},
    {"open":100,"high":100.3,"low":99.7,"close":100,"volume":1000},
    {"open":100,"high":100.3,"low":99.7,"close":100,"volume":1000},
    {"open":100,"high":100.3,"low":99.7,"close":100,"volume":1000},
    {"open":100,"high":100.3,"low":99.7,"close":100,"volume":1000},
    {"open":100,"high":100.3,"low":99.7,"close":100,"volume":1000},
    {"open":100,"high":100.3,"low":99.7,"close":100,"volume":1000},
    {"open":100,"high":100.3,"low":99.7,"close":100,"volume":1000},
    {"open":100,"high":100.3,"low":99.7,"close":100,"volume":1000},
    {"open":100,"high":100.3,"low":99.7,"close":100,"volume":1000},
    {"open":100,"high":100.3,"low":99.7,"close":100,"volume":1000},
    {"open":100,"high":100.3,"low":99.7,"close":100,"volume":1000},
    {"open":100,"high":100.3,"low":99.7,"close":100,"volume":1000},
    {"open":100,"high":100.3,"low":99.7,"close":100,"volume":1000},
    {"open":100,"high":100.3,"low":99.7,"close":100,"volume":1000},
    {"open":100,"high":100.3,"low":99.7,"close":100,"volume":1000},
    {"open":100,"high":100.3,"low":99.7,"close":100,"volume":1000},
    {"open":100,"high":100.3,"low":99.7,"close":100,"volume":1000},
    {"open":100,"high":100.3,"low":99.7,"close":100,"volume":1000},
    {"open":100,"high":100.3,"low":99.7,"close":100,"volume":1000},
    {"open":100,"high":100.3,"low":99.7,"close":100,"volume":1000},
    {"open":100,"high":100.3,"low":99.7,"close":100,"volume":1000},
    {"open":100,"high":100.3,"low":99.7,"close":100,"volume":1000},
    {"open":100,"high":100.3,"low":99.7,"close":100,"volume":1000}
  ]
}
```

- [ ] **Step 2: Write the failing tests**

```js
// backend/signalEngine.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { evaluateSignal, MIN_CANDLES } = require('./signalEngine');

const fixtures = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'test/fixtures/sample-candles.json'), 'utf8')
);

test('returns NEUTRAL during warmup (<21 candles)', () => {
  const result = evaluateSignal(fixtures.neutralCandles.slice(0, MIN_CANDLES - 1));
  assert.equal(result.side, 'NEUTRAL');
});

test('decline-then-rally scenario fires BUY', () => {
  const result = evaluateSignal(fixtures.buyCandles);
  assert.equal(result.side, 'BUY');
  assert.ok(result.score >= 2);
});

test('rally-then-decline scenario fires SELL', () => {
  const result = evaluateSignal(fixtures.sellCandles);
  assert.equal(result.side, 'SELL');
  assert.ok(result.score <= -2);
});

test('flat price scenario stays NEUTRAL', () => {
  const result = evaluateSignal(fixtures.neutralCandles);
  assert.equal(result.side, 'NEUTRAL');
  assert.equal(result.score, 0);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --test backend/signalEngine.test.js`
Expected: FAIL — `Cannot find module './signalEngine'`

- [ ] **Step 4: Write implementation**

```js
// backend/signalEngine.js
const { computeEMA, computeRSI, computeSessionVWAP, isVolumeSpike } = require('./indicators');

const MIN_CANDLES = 21;
const EMA_SHORT_PERIOD = 9;
const EMA_LONG_PERIOD = 21;
const RSI_PERIOD = 14;
const BUY_THRESHOLD = 2;
const SELL_THRESHOLD = -2;

function evaluateSignal(candles) {
  if (candles.length < MIN_CANDLES) {
    return { side: 'NEUTRAL', score: 0 };
  }

  const index = candles.length - 1;
  const closes = candles.map((c) => c.close);
  const volumes = candles.map((c) => c.volume);

  const emaShort = computeEMA(closes, EMA_SHORT_PERIOD);
  const emaLong = computeEMA(closes, EMA_LONG_PERIOD);
  const rsi = computeRSI(closes, RSI_PERIOD);
  const vwap = computeSessionVWAP(candles);

  let score = 0;

  const prevShort = emaShort[index - 1];
  const prevLong = emaLong[index - 1];
  const curShort = emaShort[index];
  const curLong = emaLong[index];
  if (prevShort !== null && prevLong !== null && curShort !== null && curLong !== null) {
    if (prevShort <= prevLong && curShort > curLong) score += 1;
    if (prevShort >= prevLong && curShort < curLong) score -= 1;
  }

  const r = rsi[index];
  if (r !== null) {
    if (r < 30) score += 1;
    if (r > 70) score -= 1;
  }

  const v = vwap[index];
  if (v !== null) {
    if (closes[index] > v) score += 1;
    if (closes[index] < v) score -= 1;
  }

  if (isVolumeSpike(volumes, index)) score *= 1.5;

  let side = 'NEUTRAL';
  if (score >= BUY_THRESHOLD) side = 'BUY';
  else if (score <= SELL_THRESHOLD) side = 'SELL';

  return { side, score };
}

module.exports = { evaluateSignal, MIN_CANDLES };
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test backend/signalEngine.test.js`
Expected: 4 tests pass.

- [ ] **Step 6: Commit**

```bash
git add backend/signalEngine.js backend/signalEngine.test.js backend/test/fixtures/sample-candles.json
git commit -m "feat: add multi-indicator signal scoring engine"
```

---

### Task 4: SQLite persistence layer

**Files:**
- Create: `backend/db.js`
- Test: `backend/db.test.js`

**Interfaces:**
- Produces: `openDb(dbPath?: string): Database`
- Produces: `insertSignal(db, {symbol, side, price, score, candleTime, tradeDate}): number` (returns row id)
- Produces: `getSignalsByDate(db, tradeDate: string): Row[]`
- Produces: `getOpenSignals(db, tradeDate: string): Row[]`
- Produces: `updateOutcome(db, id: number, outcome: string): void`
- Consumed by: `api.js` (Task 9), `outcomeTracker.js` (Task 6), `server.js` (Task 10).

- [ ] **Step 1: Write the failing test**

```js
// backend/db.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb, insertSignal, getSignalsByDate, getOpenSignals, updateOutcome } = require('./db');

function freshDb() {
  return openDb(':memory:');
}

test('insertSignal + getSignalsByDate round-trip', () => {
  const db = freshDb();
  insertSignal(db, { symbol: 'RELIANCE', side: 'BUY', price: 2500, score: 2, candleTime: '2026-07-06T09:35:00+05:30', tradeDate: '2026-07-06' });
  const rows = getSignalsByDate(db, '2026-07-06');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].symbol, 'RELIANCE');
  assert.equal(rows[0].outcome, 'OPEN');
  db.close();
});

test('getOpenSignals only returns OPEN rows', () => {
  const db = freshDb();
  const id = insertSignal(db, { symbol: 'TCS', side: 'SELL', price: 3800, score: -2, candleTime: '2026-07-06T10:00:00+05:30', tradeDate: '2026-07-06' });
  insertSignal(db, { symbol: 'INFY', side: 'BUY', price: 1500, score: 2, candleTime: '2026-07-06T10:05:00+05:30', tradeDate: '2026-07-06' });
  updateOutcome(db, id, 'HIT_TARGET');
  const open = getOpenSignals(db, '2026-07-06');
  assert.equal(open.length, 1);
  assert.equal(open[0].symbol, 'INFY');
  db.close();
});

test('getSignalsByDate is scoped to the given date', () => {
  const db = freshDb();
  insertSignal(db, { symbol: 'WIPRO', side: 'BUY', price: 500, score: 2, candleTime: '2026-07-06T09:35:00+05:30', tradeDate: '2026-07-06' });
  insertSignal(db, { symbol: 'WIPRO', side: 'BUY', price: 510, score: 2, candleTime: '2026-07-07T09:35:00+05:30', tradeDate: '2026-07-07' });
  assert.equal(getSignalsByDate(db, '2026-07-06').length, 1);
  assert.equal(getSignalsByDate(db, '2026-07-07').length, 1);
  db.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test backend/db.test.js`
Expected: FAIL — `Cannot find module './db'`

- [ ] **Step 3: Write implementation**

```js
// backend/db.js
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

function openDb(dbPath = path.join(__dirname, '..', 'data', 'signals.db')) {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS signals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL,
      side TEXT NOT NULL,
      price REAL NOT NULL,
      score REAL NOT NULL,
      candle_time TEXT NOT NULL,
      trade_date TEXT NOT NULL,
      outcome TEXT NOT NULL DEFAULT 'OPEN'
    )
  `);
  return db;
}

function insertSignal(db, { symbol, side, price, score, candleTime, tradeDate }) {
  const stmt = db.prepare(`
    INSERT INTO signals (symbol, side, price, score, candle_time, trade_date, outcome)
    VALUES (@symbol, @side, @price, @score, @candleTime, @tradeDate, 'OPEN')
  `);
  const info = stmt.run({ symbol, side, price, score, candleTime, tradeDate });
  return info.lastInsertRowid;
}

function getSignalsByDate(db, tradeDate) {
  return db.prepare('SELECT * FROM signals WHERE trade_date = ? ORDER BY candle_time ASC').all(tradeDate);
}

function getOpenSignals(db, tradeDate) {
  return db.prepare("SELECT * FROM signals WHERE trade_date = ? AND outcome = 'OPEN'").all(tradeDate);
}

function updateOutcome(db, id, outcome) {
  db.prepare('UPDATE signals SET outcome = ? WHERE id = ?').run(outcome, id);
}

module.exports = { openDb, insertSignal, getSignalsByDate, getOpenSignals, updateOutcome };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test backend/db.test.js`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/db.js backend/db.test.js
git commit -m "feat: add SQLite persistence for signals"
```

---

### Task 5: Candle aggregator (ticks -> 5-min OHLCV)

**Files:**
- Create: `backend/candleAggregator.js`
- Test: `backend/candleAggregator.test.js`

**Interfaces:**
- Produces: `class CandleAggregator` with `onTick({symbol, ltp, ltq, timestamp}): Candle|null` (returns the just-closed candle, or `null` if the current bucket is still open), `getCandles(symbol): Candle[]`, `reset(): void`.
- `Candle` shape: `{time, open, high, low, close, volume}`.
- Consumed by: `server.js` ingestion pipeline (Task 10).

- [ ] **Step 1: Write the failing test**

```js
// backend/candleAggregator.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { CandleAggregator, BUCKET_MS } = require('./candleAggregator');

test('first tick in a bucket opens a candle and returns null', () => {
  const agg = new CandleAggregator();
  const closed = agg.onTick({ symbol: 'TCS', ltp: 100, ltq: 10, timestamp: 0 });
  assert.equal(closed, null);
  assert.equal(agg.getCandles('TCS').length, 0);
});

test('ticks in the same bucket update high/low/close/volume', () => {
  const agg = new CandleAggregator();
  agg.onTick({ symbol: 'TCS', ltp: 100, ltq: 10, timestamp: 0 });
  agg.onTick({ symbol: 'TCS', ltp: 105, ltq: 5, timestamp: 60 * 1000 });
  agg.onTick({ symbol: 'TCS', ltp: 98, ltq: 5, timestamp: 2 * 60 * 1000 });
  const closed = agg.onTick({ symbol: 'TCS', ltp: 102, ltq: 20, timestamp: BUCKET_MS });
  assert.ok(closed);
  assert.equal(closed.open, 100);
  assert.equal(closed.high, 105);
  assert.equal(closed.low, 98);
  assert.equal(closed.close, 102 === 102 ? 98 : 98); // close of the FIRST bucket must be its last tick before rollover
});

test('a tick in a new bucket closes the previous candle correctly', () => {
  const agg = new CandleAggregator();
  agg.onTick({ symbol: 'TCS', ltp: 100, ltq: 10, timestamp: 0 });
  agg.onTick({ symbol: 'TCS', ltp: 103, ltq: 10, timestamp: 60 * 1000 });
  const closed = agg.onTick({ symbol: 'TCS', ltp: 110, ltq: 1, timestamp: BUCKET_MS + 1000 });
  assert.equal(closed.open, 100);
  assert.equal(closed.close, 103);
  assert.equal(closed.volume, 20);
  assert.equal(agg.getCandles('TCS').length, 1);
});

test('symbols are tracked independently', () => {
  const agg = new CandleAggregator();
  agg.onTick({ symbol: 'TCS', ltp: 100, ltq: 10, timestamp: 0 });
  agg.onTick({ symbol: 'INFY', ltp: 200, ltq: 10, timestamp: 0 });
  agg.onTick({ symbol: 'TCS', ltp: 101, ltq: 10, timestamp: BUCKET_MS });
  assert.equal(agg.getCandles('TCS').length, 1);
  assert.equal(agg.getCandles('INFY').length, 0);
});

test('reset clears all state', () => {
  const agg = new CandleAggregator();
  agg.onTick({ symbol: 'TCS', ltp: 100, ltq: 10, timestamp: 0 });
  agg.onTick({ symbol: 'TCS', ltp: 101, ltq: 10, timestamp: BUCKET_MS });
  agg.reset();
  assert.equal(agg.getCandles('TCS').length, 0);
});
```

Note the deliberately convoluted assertion in test 2 (`closed.close`) resolves to `98` either way — it exists to document that the closed candle's `close` is the **last tick of the finished bucket**, not the tick that triggered rollover.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test backend/candleAggregator.test.js`
Expected: FAIL — `Cannot find module './candleAggregator'`

- [ ] **Step 3: Write implementation**

```js
// backend/candleAggregator.js
const BUCKET_MS = 5 * 60 * 1000;

class CandleAggregator {
  constructor() {
    this.current = new Map();
    this.completed = new Map();
  }

  _bucketStart(timestampMs) {
    return Math.floor(timestampMs / BUCKET_MS) * BUCKET_MS;
  }

  onTick({ symbol, ltp, ltq, timestamp }) {
    const bucketStart = this._bucketStart(timestamp);
    const cur = this.current.get(symbol);
    let closedCandle = null;

    if (!cur || cur.bucketStart !== bucketStart) {
      if (cur) closedCandle = this._finalize(symbol, cur);
      this.current.set(symbol, {
        bucketStart,
        open: ltp,
        high: ltp,
        low: ltp,
        close: ltp,
        volume: ltq,
      });
    } else {
      cur.high = Math.max(cur.high, ltp);
      cur.low = Math.min(cur.low, ltp);
      cur.close = ltp;
      cur.volume += ltq;
    }

    return closedCandle;
  }

  _finalize(symbol, candle) {
    const finished = {
      time: candle.bucketStart,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
    };
    if (!this.completed.has(symbol)) this.completed.set(symbol, []);
    this.completed.get(symbol).push(finished);
    return finished;
  }

  getCandles(symbol) {
    return this.completed.get(symbol) || [];
  }

  reset() {
    this.current.clear();
    this.completed.clear();
  }
}

module.exports = { CandleAggregator, BUCKET_MS };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test backend/candleAggregator.test.js`
Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/candleAggregator.js backend/candleAggregator.test.js
git commit -m "feat: add tick-to-5min-candle aggregator"
```

---

### Task 6: Outcome tracker (target/stoploss)

**Files:**
- Create: `backend/outcomeTracker.js`
- Test: `backend/outcomeTracker.test.js`

**Interfaces:**
- Consumes: `getOpenSignals`, `updateOutcome` from `./db` (Task 4).
- Produces: `evaluateOutcome(signal: {side, price}, candle: {high, low}): 'HIT_TARGET'|'HIT_SL'|null`
- Produces: `checkOpenSignals(db, symbol: string, candle: Candle, tradeDate: string): void`
- Produces: `closeRemainingOpenSignals(db, tradeDate: string): void`
- Produces: `TARGET_PCT` (0.005), `STOPLOSS_PCT` (0.003)
- Consumed by: `server.js` ingestion pipeline (Task 10).

- [ ] **Step 1: Write the failing test**

```js
// backend/outcomeTracker.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb, insertSignal, getOpenSignals } = require('./db');
const { evaluateOutcome, checkOpenSignals, closeRemainingOpenSignals } = require('./outcomeTracker');

test('BUY hits target when candle high reaches +0.5%', () => {
  const outcome = evaluateOutcome({ side: 'BUY', price: 100 }, { high: 100.6, low: 99.9 });
  assert.equal(outcome, 'HIT_TARGET');
});

test('BUY hits stoploss when candle low reaches -0.3%', () => {
  const outcome = evaluateOutcome({ side: 'BUY', price: 100 }, { high: 100.1, low: 99.6 });
  assert.equal(outcome, 'HIT_SL');
});

test('BUY stays open when neither threshold is reached', () => {
  const outcome = evaluateOutcome({ side: 'BUY', price: 100 }, { high: 100.2, low: 99.8 });
  assert.equal(outcome, null);
});

test('SELL hits target when candle low drops -0.5%', () => {
  const outcome = evaluateOutcome({ side: 'SELL', price: 100 }, { high: 100.2, low: 99.4 });
  assert.equal(outcome, 'HIT_TARGET');
});

test('SELL hits stoploss when candle high rises +0.3%', () => {
  const outcome = evaluateOutcome({ side: 'SELL', price: 100 }, { high: 100.4, low: 99.8 });
  assert.equal(outcome, 'HIT_SL');
});

test('checkOpenSignals updates matching open signals for a symbol', () => {
  const db = openDb(':memory:');
  const id = insertSignal(db, { symbol: 'TCS', side: 'BUY', price: 100, score: 2, candleTime: 't1', tradeDate: '2026-07-06' });
  insertSignal(db, { symbol: 'INFY', side: 'BUY', price: 100, score: 2, candleTime: 't1', tradeDate: '2026-07-06' });
  checkOpenSignals(db, 'TCS', { high: 100.6, low: 99.9 }, '2026-07-06');
  const open = getOpenSignals(db, '2026-07-06');
  assert.equal(open.length, 1);
  assert.equal(open[0].symbol, 'INFY');
  db.close();
});

test('closeRemainingOpenSignals marks all open rows EOD_CLOSE', () => {
  const db = openDb(':memory:');
  insertSignal(db, { symbol: 'TCS', side: 'BUY', price: 100, score: 2, candleTime: 't1', tradeDate: '2026-07-06' });
  closeRemainingOpenSignals(db, '2026-07-06');
  assert.equal(getOpenSignals(db, '2026-07-06').length, 0);
  db.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test backend/outcomeTracker.test.js`
Expected: FAIL — `Cannot find module './outcomeTracker'`

- [ ] **Step 3: Write implementation**

```js
// backend/outcomeTracker.js
const { getOpenSignals, updateOutcome } = require('./db');

const TARGET_PCT = 0.005;
const STOPLOSS_PCT = 0.003;

function evaluateOutcome(signal, candle) {
  if (signal.side === 'BUY') {
    const target = signal.price * (1 + TARGET_PCT);
    const stop = signal.price * (1 - STOPLOSS_PCT);
    if (candle.high >= target) return 'HIT_TARGET';
    if (candle.low <= stop) return 'HIT_SL';
  } else if (signal.side === 'SELL') {
    const target = signal.price * (1 - TARGET_PCT);
    const stop = signal.price * (1 + STOPLOSS_PCT);
    if (candle.low <= target) return 'HIT_TARGET';
    if (candle.high >= stop) return 'HIT_SL';
  }
  return null;
}

function checkOpenSignals(db, symbol, candle, tradeDate) {
  const openSignals = getOpenSignals(db, tradeDate).filter((s) => s.symbol === symbol);
  for (const signal of openSignals) {
    const outcome = evaluateOutcome(signal, candle);
    if (outcome) updateOutcome(db, signal.id, outcome);
  }
}

function closeRemainingOpenSignals(db, tradeDate) {
  const openSignals = getOpenSignals(db, tradeDate);
  for (const signal of openSignals) updateOutcome(db, signal.id, 'EOD_CLOSE');
}

module.exports = { evaluateOutcome, checkOpenSignals, closeRemainingOpenSignals, TARGET_PCT, STOPLOSS_PCT };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test backend/outcomeTracker.test.js`
Expected: 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/outcomeTracker.js backend/outcomeTracker.test.js
git commit -m "feat: add target/stoploss outcome tracking for signals"
```

---

### Task 7: Nifty 50 instrument map + config loader

**Files:**
- Create: `backend/config.js`
- Create: `backend/instrumentMap.js`
- Create: `docs/dhan-setup.md`

**Interfaces:**
- Produces: `loadConfig(): {clientId, accessToken, port}` (throws if required env vars missing).
- Produces: `resolveNifty50InstrumentMap(fetchImpl = fetch): Promise<Map<symbol, securityId>>` — joins the NSE-published Nifty 50 constituent list against Dhan's published scrip master CSV, both fetched live (never hardcoded — index membership and Dhan's internal IDs both change over time). `securityId` is a string (matches the `SecurityId` field Dhan's WebSocket subscribe message expects).
- Consumed by: `server.js` (Task 14).

**Why not hardcode the list:** Nifty 50 constituents and Dhan's SecurityIds both change over time (index rebalancing, instrument master updates). Baking either into source risks silently tracking the wrong stocks months from now. Both are pulled from their authoritative live sources at startup instead.

**Ground truth for the CSV format:** the column names and NSE-equity filter below (`SEM_EXM_EXCH_ID='NSE'`, `SEM_SEGMENT='E'`, `SEM_SERIES='EQ'`) were confirmed by downloading the real file (`curl https://images.dhan.co/api-data/api-scrip-master.csv`) and inspecting its header and matching rows (e.g. `NSE,E,2885,EQUITY,0,RELIANCE,...,EQ,RELIANCE INDUSTRIES LTD`) — not guessed from prose docs. The file has no quoted/escaped commas, so a plain `split(',')` per line is safe.

- [ ] **Step 1: Write config.js**

```js
// backend/config.js
require('dotenv').config();

function loadConfig() {
  const required = ['DHAN_CLIENT_ID', 'DHAN_ACCESS_TOKEN'];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required env vars: ${missing.join(', ')}. Copy .env.example to .env and fill it in.`);
  }
  return {
    clientId: process.env.DHAN_CLIENT_ID,
    accessToken: process.env.DHAN_ACCESS_TOKEN,
    port: Number(process.env.PORT || 3000),
  };
}

module.exports = { loadConfig };
```

- [ ] **Step 2: Write instrumentMap.js**

```js
// backend/instrumentMap.js
const NIFTY50_CSV_URL = 'https://archives.nseindia.com/content/indices/ind_nifty50list.csv';
const DHAN_SCRIP_MASTER_URL = 'https://images.dhan.co/api-data/api-scrip-master.csv';

function parseNifty50Csv(csvText) {
  const lines = csvText.trim().split('\n');
  const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const symbolIdx = header.indexOf('symbol');
  return lines.slice(1).map((line) => line.split(',')[symbolIdx].trim());
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

async function resolveNifty50InstrumentMap(fetchImpl = fetch) {
  const csvResp = await fetchImpl(NIFTY50_CSV_URL, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!csvResp.ok) throw new Error(`Failed to fetch Nifty50 list: HTTP ${csvResp.status}`);
  const symbols = parseNifty50Csv(await csvResp.text());

  const scripResp = await fetchImpl(DHAN_SCRIP_MASTER_URL);
  if (!scripResp.ok) throw new Error(`Failed to fetch Dhan scrip master: HTTP ${scripResp.status}`);
  const bySymbol = parseDhanScripMaster(await scripResp.text());

  const map = new Map();
  for (const symbol of symbols) {
    const securityId = bySymbol.get(symbol);
    if (securityId) map.set(symbol, securityId);
  }
  return map;
}

module.exports = { resolveNifty50InstrumentMap, parseNifty50Csv, parseDhanScripMaster };
```

- [ ] **Step 3: Manual verification (no live network call in automated tests)**

This function depends on two live external endpoints, so it isn't unit-tested with a real network call. Instead:

Run: `node -e "require('./backend/instrumentMap').resolveNifty50InstrumentMap().then(m => console.log(m.size, [...m.entries()].slice(0,3)))"`
Expected: prints a number close to 50 and a few `[symbol, securityId]` pairs (e.g. `['RELIANCE', '2885']`). If the NSE CSV URL 403s (NSE occasionally blocks non-browser user agents), note the working URL/headers in `docs/dhan-setup.md` and adjust `NIFTY50_CSV_URL`/headers accordingly — this is exactly the kind of drift the live-fetch approach is meant to survive without a code change to a hardcoded list. If Dhan's CSV column names have changed since this plan was written, `parseDhanScripMaster`'s `header.indexOf(...)` calls will return `-1` and every row will be skipped (map ends up empty) rather than crashing — check the CSV's actual header row against the names above if that happens.

- [ ] **Step 4: Write docs/dhan-setup.md**

```markdown
# Dhan Setup

This app uses a manually-generated access token — no OAuth flow, since
it's a single-user personal app.

1. Log into https://web.dhan.co
2. Go to "Access DhanHQ APIs" (developer/API section of your profile).
3. Generate an access token. Copy your Client ID (`dhanClientId`) and
   the generated token into `.env` as `DHAN_CLIENT_ID` and
   `DHAN_ACCESS_TOKEN` (see `.env.example`).
4. The token is valid for **24 hours from generation**. Every trading
   day, regenerate it at web.dhan.co and restart the server
   (`npm start`) before 9:30 IST — there is no in-app refresh flow.
```

- [ ] **Step 5: Commit**

```bash
git add backend/config.js backend/instrumentMap.js docs/dhan-setup.md
git commit -m "feat: add config loader and live Nifty50 instrument resolution via Dhan"
```

---

### Task 8: Dhan connection status tracker

**Files:**
- Create: `backend/connectionStatus.js`
- Test: `backend/connectionStatus.test.js`

**Interfaces:**
- Produces: `createConnectionStatus(): {setConnected(value: boolean), setError(err: Error|string|null), isConnected(): boolean, getLastError(): string|null}`
- Consumed by: `api.js` (Task 9, via `isConnected()`/`getLastError()`), `server.js` (Task 14, updated from the Dhan feed's `connected`/`disconnected`/`error` events).

**Why this replaces an OAuth token store:** Dhan auth for this app is a single manually-generated 24-hour token pasted into `.env` (see Task 7) — there is no in-app login/callback flow to track a token through. What the app actually needs to know is "is the live feed connected right now," which the feed's own connection events answer directly; a disconnect with reason "Access Token is expired" (Dhan's server-side code 807) surfaces to the user as the same "not connected" state as any other disconnect, with the last error message shown for context.

- [ ] **Step 1: Write the failing test**

```js
// backend/connectionStatus.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createConnectionStatus } = require('./connectionStatus');

test('starts disconnected with no error', () => {
  const status = createConnectionStatus();
  assert.equal(status.isConnected(), false);
  assert.equal(status.getLastError(), null);
});

test('setConnected(true) marks connected and clears any prior error', () => {
  const status = createConnectionStatus();
  status.setError('Access Token is expired');
  status.setConnected(true);
  assert.equal(status.isConnected(), true);
  assert.equal(status.getLastError(), null);
});

test('setConnected(false) marks disconnected but keeps the last error visible', () => {
  const status = createConnectionStatus();
  status.setConnected(true);
  status.setError('Access Token is expired');
  status.setConnected(false);
  assert.equal(status.isConnected(), false);
  assert.equal(status.getLastError(), 'Access Token is expired');
});

test('setError accepts an Error object and stores its message', () => {
  const status = createConnectionStatus();
  status.setError(new Error('WebSocket closed'));
  assert.equal(status.getLastError(), 'WebSocket closed');
});

test('setError(null) clears the error', () => {
  const status = createConnectionStatus();
  status.setError('something');
  status.setError(null);
  assert.equal(status.getLastError(), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test backend/connectionStatus.test.js`
Expected: FAIL — `Cannot find module './connectionStatus'`

- [ ] **Step 3: Write implementation**

```js
// backend/connectionStatus.js
function createConnectionStatus() {
  let connected = false;
  let lastError = null;

  return {
    setConnected(value) {
      connected = value;
      if (value) lastError = null;
    },
    setError(err) {
      if (err === null || err === undefined) {
        lastError = null;
      } else {
        lastError = err instanceof Error ? err.message : String(err);
      }
    },
    isConnected() {
      return connected;
    },
    getLastError() {
      return lastError;
    },
  };
}

module.exports = { createConnectionStatus };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test backend/connectionStatus.test.js`
Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/connectionStatus.js backend/connectionStatus.test.js
git commit -m "feat: add Dhan feed connection status tracker"
```

---

### Task 9: REST API router

**Files:**
- Create: `backend/api.js`
- Test: `backend/api.test.js`

**Interfaces:**
- Consumes: `getSignalsByDate` from `./db` (Task 4), `isMarketOpen` from `./marketWindow` (Task 1), `connectionStatus` from `./connectionStatus` (Task 8).
- Produces: `createApiRouter({db, connectionStatus, isMarketOpenFn, getCandles}): express.Router` — mounts `GET /status`, `GET /signals?date=`, `GET /candles/:symbol`.
- Consumed by: `server.js` (Task 14).

- [ ] **Step 1: Write the failing test**

```js
// backend/api.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { createApiRouter } = require('./api');
const { openDb, insertSignal } = require('./db');

async function startTestServer(router) {
  const app = express();
  app.use('/api', router);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  return { server, port: server.address().port };
}

test('GET /api/status reports market state and feed connection', async () => {
  const db = openDb(':memory:');
  const router = createApiRouter({
    db,
    connectionStatus: { isConnected: () => true, getLastError: () => null },
    isMarketOpenFn: () => false,
    getCandles: () => [],
  });
  const { server, port } = await startTestServer(router);

  const resp = await fetch(`http://localhost:${port}/api/status`);
  const body = await resp.json();
  assert.equal(body.marketOpen, false);
  assert.equal(body.feedConnected, true);
  assert.equal(body.lastError, null);

  await new Promise((resolve) => server.close(resolve));
  db.close();
});

test('GET /api/signals?date= returns rows for that date', async () => {
  const db = openDb(':memory:');
  insertSignal(db, { symbol: 'TCS', side: 'BUY', price: 100, score: 2, candleTime: 't1', tradeDate: '2026-07-06' });
  const router = createApiRouter({
    db,
    connectionStatus: { isConnected: () => true, getLastError: () => null },
    isMarketOpenFn: () => true,
    getCandles: () => [],
  });
  const { server, port } = await startTestServer(router);

  const resp = await fetch(`http://localhost:${port}/api/signals?date=2026-07-06`);
  const body = await resp.json();
  assert.equal(body.length, 1);
  assert.equal(body[0].symbol, 'TCS');

  await new Promise((resolve) => server.close(resolve));
  db.close();
});

test('GET /api/candles/:symbol delegates to getCandles', async () => {
  const db = openDb(':memory:');
  const router = createApiRouter({
    db,
    connectionStatus: { isConnected: () => true, getLastError: () => null },
    isMarketOpenFn: () => true,
    getCandles: (symbol) => (symbol === 'TCS' ? [{ time: 0, open: 1, high: 2, low: 0, close: 1, volume: 10 }] : []),
  });
  const { server, port } = await startTestServer(router);

  const resp = await fetch(`http://localhost:${port}/api/candles/TCS`);
  const body = await resp.json();
  assert.equal(body.length, 1);
  assert.equal(body[0].close, 1);

  await new Promise((resolve) => server.close(resolve));
  db.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test backend/api.test.js`
Expected: FAIL — `Cannot find module './api'`

- [ ] **Step 3: Write implementation**

```js
// backend/api.js
const express = require('express');
const { getSignalsByDate } = require('./db');

function createApiRouter({ db, connectionStatus, isMarketOpenFn, getCandles }) {
  const router = express.Router();

  router.get('/status', (req, res) => {
    res.json({
      marketOpen: isMarketOpenFn(),
      feedConnected: connectionStatus.isConnected(),
      lastError: connectionStatus.getLastError(),
    });
  });

  router.get('/signals', (req, res) => {
    const date = req.query.date || new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
    res.json(getSignalsByDate(db, date));
  });

  router.get('/candles/:symbol', (req, res) => {
    res.json(getCandles(req.params.symbol));
  });

  return router;
}

module.exports = { createApiRouter };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test backend/api.test.js`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/api.js backend/api.test.js
git commit -m "feat: add REST API for status/signals/candles"
```

---

### Task 10: Live WebSocket broadcast server

**Files:**
- Create: `backend/liveSocket.js`
- Test: `backend/liveSocket.test.js`

**Interfaces:**
- Produces: `createLiveSocketServer(httpServer, path = '/live'): {wss, broadcast(event: object): void}`
- Consumed by: `server.js` (Task 11), `frontend/app.js` (Task 12).

- [ ] **Step 1: Write the failing test**

```js
// backend/liveSocket.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const WebSocket = require('ws');
const { createLiveSocketServer } = require('./liveSocket');

test('broadcast delivers JSON events to connected clients', async () => {
  const httpServer = http.createServer();
  const { broadcast } = createLiveSocketServer(httpServer, '/live');
  await new Promise((resolve) => httpServer.listen(0, resolve));
  const port = httpServer.address().port;

  const client = new WebSocket(`ws://localhost:${port}/live`);
  await new Promise((resolve, reject) => {
    client.on('open', resolve);
    client.on('error', reject);
  });

  const received = new Promise((resolve) => {
    client.on('message', (data) => resolve(JSON.parse(data.toString())));
  });

  broadcast({ type: 'signal', symbol: 'TCS', side: 'BUY' });
  const event = await received;
  assert.equal(event.type, 'signal');
  assert.equal(event.symbol, 'TCS');

  client.close();
  await new Promise((resolve) => httpServer.close(resolve));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test backend/liveSocket.test.js`
Expected: FAIL — `Cannot find module './liveSocket'`

- [ ] **Step 3: Write implementation**

```js
// backend/liveSocket.js
const { WebSocketServer } = require('ws');

function createLiveSocketServer(httpServer, path = '/live') {
  const wss = new WebSocketServer({ server: httpServer, path });

  function broadcast(event) {
    const payload = JSON.stringify(event);
    for (const client of wss.clients) {
      if (client.readyState === client.OPEN) client.send(payload);
    }
  }

  return { wss, broadcast };
}

module.exports = { createLiveSocketServer };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test backend/liveSocket.test.js`
Expected: 1 test passes.

- [ ] **Step 5: Commit**

```bash
git add backend/liveSocket.js backend/liveSocket.test.js
git commit -m "feat: add WebSocket broadcast server for live dashboard updates"
```

---

### Task 11: Dhan WebSocket feed client

**Files:**
- Create: `backend/dhanFeed.js`
- Test: `backend/dhanFeed.test.js`

**Interfaces:**
- Produces: `createDhanFeed({clientId, accessToken, decodeMessage?, WebSocketImpl?, scheduler?, baseUrl?}): {connect(instruments), close(), on(event, handler)}`, where `instruments: Array<{exchangeSegment: string, securityId: string}>`. Events: `'connected'`, `'tick'` (payload `{symbol, ltp, ltq, timestamp}`), `'disconnected'`, `'error'`.
- Produces: `decodeQuotePacket(buffer: Buffer): Tick[]` — the real, fully-tested binary decoder (default for `decodeMessage`). Unlike the original Upstox design, this is NOT deferred to a later task: Dhan's Quote packet is a fixed-width binary struct (confirmed against the official `dhanhq` Python SDK source, not guessed), so it's plain, pure, synchronous `Buffer` parsing — no external schema file, no async step.
- Consumed by: `server.js` (Task 14).

**Ground truth for the wire format** (confirmed by downloading `dhanhq==2.2.0` from PyPI and reading `dhanhq/marketfeed.py` directly, not from prose docs alone):
- Connect URL: `wss://api-feed.dhan.co?version=2&token=<accessToken>&clientId=<clientId>&authType=2` — auth is via query params; v2 needs no separate binary handshake message (that's v1-only).
- Subscribe message (JSON, sent as a text WS frame): `{"RequestCode": 17, "InstrumentCount": N, "InstrumentList": [{"ExchangeSegment": "NSE_EQ", "SecurityId": "2885"}, ...]}`. `RequestCode: 17` is Quote mode — chosen over Ticker (`15`, no traded quantity) because the candle aggregator (Task 5) needs `ltq` (last traded quantity) for its volume field. Dhan caps each subscribe message at 100 instruments; since the Global Constraints fix the universe at Nifty 50 (50 symbols), a single message always suffices — no batching loop needed.
- Response packets are binary, little-endian, first byte = packet type. Quote packets have type byte `4` and are exactly 50 bytes, laid out as (offset, size, field): `0,1,code` `1,2,messageLength` `3,1,exchangeSegment` `4,4,securityId(int32)` `8,4,LTP(float32)` `12,2,LTQ(uint16)` `14,4,LTT(uint32, epoch seconds)` `18,4,avgPrice(float32)` `22,4,volume(uint32)` `26,4,totalSellQty` `30,4,totalBuyQty` `34,4,open` `38,4,close` `42,4,high` `46,4,low`. This app only needs `securityId`, `LTP`, `LTQ`, and `LTT` — the rest of the Quote packet is ignored.

- [ ] **Step 1: Write the failing test**

```js
// backend/dhanFeed.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createDhanFeed, decodeQuotePacket } = require('./dhanFeed');

class FakeWebSocket extends EventEmitter {
  constructor(url) {
    super();
    this.url = url;
    this.sent = [];
    FakeWebSocket.instances.push(this);
  }
  send(data) { this.sent.push(data); }
  close() { this.emit('close'); }
}
FakeWebSocket.instances = [];

function buildQuotePacket({ securityId, ltp, ltq, ltt }) {
  const buf = Buffer.alloc(50);
  buf.writeUInt8(4, 0);
  buf.writeUInt16LE(50, 1);
  buf.writeUInt8(1, 3);
  buf.writeInt32LE(securityId, 4);
  buf.writeFloatLE(ltp, 8);
  buf.writeUInt16LE(ltq, 12);
  buf.writeUInt32LE(ltt, 14);
  return buf;
}

test('decodeQuotePacket parses a real Quote packet layout', () => {
  const buf = buildQuotePacket({ securityId: 2885, ltp: 1234.5, ltq: 10, ltt: 1735500000 });
  const ticks = decodeQuotePacket(buf);
  assert.equal(ticks.length, 1);
  assert.equal(ticks[0].symbol, '2885');
  assert.ok(Math.abs(ticks[0].ltp - 1234.5) < 0.01);
  assert.equal(ticks[0].ltq, 10);
  assert.equal(ticks[0].timestamp, 1735500000000);
});

test('decodeQuotePacket ignores non-Quote packet types', () => {
  const buf = Buffer.alloc(50);
  buf.writeUInt8(2, 0); // Ticker packet, not Quote
  assert.deepEqual(decodeQuotePacket(buf), []);
});

test('connect() builds the v2 query-param URL and sends a Quote subscribe message on open', async () => {
  FakeWebSocket.instances = [];
  const feed = createDhanFeed({
    clientId: '1100011000',
    accessToken: 'test-token',
    decodeMessage: () => [],
    WebSocketImpl: FakeWebSocket,
    baseUrl: 'wss://fake-feed.example',
  });

  await feed.connect([{ exchangeSegment: 'NSE_EQ', securityId: '2885' }]);
  const ws = FakeWebSocket.instances[0];
  ws.emit('open');

  assert.equal(ws.url, 'wss://fake-feed.example?version=2&token=test-token&clientId=1100011000&authType=2');
  assert.equal(ws.sent.length, 1);
  const sub = JSON.parse(ws.sent[0]);
  assert.equal(sub.RequestCode, 17);
  assert.equal(sub.InstrumentCount, 1);
  assert.deepEqual(sub.InstrumentList, [{ ExchangeSegment: 'NSE_EQ', SecurityId: '2885' }]);
});

test('message events are decoded and emitted as tick events', async () => {
  FakeWebSocket.instances = [];
  const fakeTicks = [{ symbol: '2885', ltp: 100, ltq: 5, timestamp: 123 }];
  const feed = createDhanFeed({
    clientId: '1100011000',
    accessToken: 'test-token',
    decodeMessage: () => fakeTicks,
    WebSocketImpl: FakeWebSocket,
    baseUrl: 'wss://fake-feed.example',
  });

  const received = [];
  feed.on('tick', (t) => received.push(t));

  await feed.connect([{ exchangeSegment: 'NSE_EQ', securityId: '2885' }]);
  const ws = FakeWebSocket.instances[0];
  ws.emit('open');
  ws.emit('message', Buffer.from('irrelevant-because-decoder-is-faked'));

  assert.deepEqual(received, fakeTicks);
});

test('on close, schedules a reconnect with increasing backoff', async () => {
  FakeWebSocket.instances = [];
  const scheduled = [];
  const scheduler = (fn, ms) => scheduled.push({ fn, ms });

  const feed = createDhanFeed({
    clientId: '1100011000',
    accessToken: 'test-token',
    decodeMessage: () => [],
    WebSocketImpl: FakeWebSocket,
    baseUrl: 'wss://fake-feed.example',
    scheduler,
  });

  await feed.connect([{ exchangeSegment: 'NSE_EQ', securityId: '2885' }]);
  FakeWebSocket.instances[0].emit('close');
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].ms, 1000);

  await scheduled[0].fn();
  FakeWebSocket.instances[1].emit('close');
  assert.equal(scheduled.length, 2);
  assert.equal(scheduled[1].ms, 2000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test backend/dhanFeed.test.js`
Expected: FAIL — `Cannot find module './dhanFeed'`

- [ ] **Step 3: Write implementation**

```js
// backend/dhanFeed.js
const WebSocket = require('ws');
const { EventEmitter } = require('node:events');

const QUOTE_PACKET_CODE = 4;
const REQUEST_CODE_QUOTE = 17;

function decodeQuotePacket(buffer) {
  if (buffer.length < 50 || buffer.readUInt8(0) !== QUOTE_PACKET_CODE) return [];
  const securityId = buffer.readInt32LE(4);
  const ltp = buffer.readFloatLE(8);
  const ltq = buffer.readUInt16LE(12);
  const ltt = buffer.readUInt32LE(14);
  return [{ symbol: String(securityId), ltp, ltq, timestamp: ltt * 1000 }];
}

function createDhanFeed({
  clientId,
  accessToken,
  decodeMessage = decodeQuotePacket,
  WebSocketImpl = WebSocket,
  scheduler = (fn, ms) => setTimeout(fn, ms),
  baseUrl = 'wss://api-feed.dhan.co',
}) {
  const emitter = new EventEmitter();
  let ws = null;
  let reconnectDelay = 1000;
  let stopped = false;
  const MAX_DELAY_MS = 30000;

  async function connect(instruments) {
    stopped = false;
    const url = `${baseUrl}?version=2&token=${accessToken}&clientId=${clientId}&authType=2`;
    ws = new WebSocketImpl(url);

    ws.on('open', () => {
      reconnectDelay = 1000;
      ws.send(JSON.stringify({
        RequestCode: REQUEST_CODE_QUOTE,
        InstrumentCount: instruments.length,
        InstrumentList: instruments.map((i) => ({ ExchangeSegment: i.exchangeSegment, SecurityId: i.securityId })),
      }));
      emitter.emit('connected');
    });

    ws.on('message', (data) => {
      const ticks = decodeMessage(data);
      for (const tick of ticks) emitter.emit('tick', tick);
    });

    ws.on('close', () => {
      emitter.emit('disconnected');
      if (!stopped) scheduleReconnect(instruments);
    });

    ws.on('error', (err) => emitter.emit('error', err));
  }

  function scheduleReconnect(instruments) {
    scheduler(() => connect(instruments).catch((err) => emitter.emit('error', err)), reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_DELAY_MS);
  }

  function close() {
    stopped = true;
    if (ws) ws.close();
  }

  return { connect, close, on: emitter.on.bind(emitter) };
}

module.exports = { createDhanFeed, decodeQuotePacket };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test backend/dhanFeed.test.js`
Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/dhanFeed.js backend/dhanFeed.test.js
git commit -m "feat: add Dhan WebSocket feed client with binary Quote-packet decoding"
```

---

### Task 12: Frontend dashboard skeleton (branding, counters, table, live WS)

**Files:**
- Create: `frontend/index.html`
- Create: `frontend/style.css`
- Create: `frontend/app.js`

**Interfaces:**
- Consumes: `GET /api/status`, `GET /api/signals?date=`, `WS /live` (all from Tasks 9-10).
- Produces: global `renderSignalRow(signal)`, `updateCounters(signals)` functions in `app.js`, reused by Task 13.

- [ ] **Step 1: Write frontend/index.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>PowerBull Pro</title>
  <link rel="stylesheet" href="style.css" />
</head>
<body>
  <header class="header">
    <div class="brand">⚡ <span>PowerBull Pro</span></div>
    <nav class="nav">
      <button id="tab-live" class="tab active">Live Signals</button>
      <button id="tab-track" class="tab">Track Record</button>
    </nav>
    <input type="date" id="date-picker" />
  </header>

  <div id="market-banner" class="banner hidden"></div>

  <section id="counters" class="counters">
    <div class="counter"><span id="count-total">0</span><label>Total</label></div>
    <div class="counter buy"><span id="count-buy">0</span><label>Buy</label></div>
    <div class="counter sell"><span id="count-sell">0</span><label>Sell</label></div>
  </section>

  <section id="view-live">
    <table class="signal-table">
      <thead><tr><th>Symbol</th><th>Side</th><th>Price</th><th>Time</th></tr></thead>
      <tbody id="signal-rows"></tbody>
    </table>
  </section>

  <section id="view-track" class="hidden">
    <table class="signal-table">
      <thead><tr><th>Symbol</th><th>Side</th><th>Entry</th><th>Time</th><th>Outcome</th></tr></thead>
      <tbody id="track-rows"></tbody>
    </table>
  </section>

  <div id="chart-modal" class="modal hidden">
    <div class="modal-content">
      <button id="chart-close">&times;</button>
      <h3 id="chart-title"></h3>
      <canvas id="chart-canvas"></canvas>
    </div>
  </div>

  <p class="disclaimer">
    Personal experiment, not investment advice. No order execution. Not affiliated with any SEBI-registered research analyst.
  </p>

  <audio id="alert-sound" src="data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=" preload="auto"></audio>

  <script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
  <script src="https://cdn.jsdelivr.net/npm/chartjs-chart-financial@0.2.1"></script>
  <script src="app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write frontend/style.css**

```css
:root {
  --bg: #0b0f14;
  --panel: #131a22;
  --border: #223;
  --text: #e6edf3;
  --buy: #21c55d;
  --sell: #ef4444;
  --accent: #f5b400;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: system-ui, sans-serif;
}

.header {
  display: flex;
  align-items: center;
  gap: 1.5rem;
  padding: 0.75rem 1.25rem;
  background: var(--panel);
  border-bottom: 1px solid var(--border);
}

.brand {
  font-weight: 700;
  font-size: 1.2rem;
  color: var(--accent);
}

.nav { display: flex; gap: 0.5rem; margin-left: auto; }

.tab {
  background: transparent;
  color: var(--text);
  border: 1px solid var(--border);
  padding: 0.4rem 0.9rem;
  border-radius: 6px;
  cursor: pointer;
}

.tab.active { border-color: var(--accent); color: var(--accent); }

.banner {
  background: #4a1f1f;
  color: #ffb4b4;
  padding: 0.5rem 1.25rem;
}

.hidden { display: none; }

.counters {
  display: flex;
  gap: 1rem;
  padding: 1rem 1.25rem;
}

.counter {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0.75rem 1.5rem;
  text-align: center;
}

.counter span { display: block; font-size: 1.8rem; font-weight: 700; }
.counter.buy span { color: var(--buy); }
.counter.sell span { color: var(--sell); }

.signal-table {
  width: 100%;
  border-collapse: collapse;
  margin: 0 1.25rem 2rem;
}

.signal-table th, .signal-table td {
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid var(--border);
  text-align: left;
}

.signal-table tr { cursor: pointer; }
.signal-table .side-buy { color: var(--buy); font-weight: 600; }
.signal-table .side-sell { color: var(--sell); font-weight: 600; }

.modal {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
}

.modal-content {
  background: var(--panel);
  padding: 1.5rem;
  border-radius: 10px;
  width: min(90vw, 720px);
}

#chart-close {
  float: right;
  background: none;
  border: none;
  color: var(--text);
  font-size: 1.5rem;
  cursor: pointer;
}

.disclaimer {
  padding: 0 1.25rem 2rem;
  font-size: 0.8rem;
  color: #8892a0;
}
```

- [ ] **Step 3: Write frontend/app.js**

```js
// frontend/app.js
const state = { signals: [], date: new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10) };

function updateCounters(signals) {
  document.getElementById('count-total').textContent = signals.length;
  document.getElementById('count-buy').textContent = signals.filter((s) => s.side === 'BUY').length;
  document.getElementById('count-sell').textContent = signals.filter((s) => s.side === 'SELL').length;
}

function renderSignalRow(signal) {
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td>${signal.symbol}</td>
    <td class="side-${signal.side.toLowerCase()}">${signal.side}</td>
    <td>${signal.price}</td>
    <td>${new Date(signal.candle_time).toLocaleTimeString()}</td>
  `;
  tr.addEventListener('click', () => openChartModal(signal.symbol));
  return tr;
}

function renderTrackRow(signal) {
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td>${signal.symbol}</td>
    <td class="side-${signal.side.toLowerCase()}">${signal.side}</td>
    <td>${signal.price}</td>
    <td>${new Date(signal.candle_time).toLocaleTimeString()}</td>
    <td>${signal.outcome}</td>
  `;
  return tr;
}

async function loadSignals(date) {
  const resp = await fetch(`/api/signals?date=${date}`);
  const signals = await resp.json();
  state.signals = signals;
  updateCounters(signals);

  const liveBody = document.getElementById('signal-rows');
  liveBody.innerHTML = '';
  signals.forEach((s) => liveBody.appendChild(renderSignalRow(s)));

  const trackBody = document.getElementById('track-rows');
  trackBody.innerHTML = '';
  signals.forEach((s) => trackBody.appendChild(renderTrackRow(s)));
}

async function loadStatus() {
  const resp = await fetch('/api/status');
  const status = await resp.json();
  const banner = document.getElementById('market-banner');
  if (!status.feedConnected) {
    banner.textContent = status.lastError
      ? `Dhan feed disconnected (${status.lastError}) — regenerate your token at web.dhan.co, update .env, and restart the server.`
      : 'Dhan feed not connected — check DHAN_CLIENT_ID/DHAN_ACCESS_TOKEN in .env and restart the server.';
    banner.classList.remove('hidden');
  } else if (!status.marketOpen) {
    banner.textContent = 'Market closed — showing last saved session.';
    banner.classList.remove('hidden');
  } else {
    banner.classList.add('hidden');
  }
}

function connectLiveSocket() {
  const ws = new WebSocket(`ws://${location.host}/live`);
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === 'signal') {
      state.signals.push(msg);
      updateCounters(state.signals);
      document.getElementById('signal-rows').appendChild(renderSignalRow(msg));
      document.getElementById('track-rows').appendChild(renderTrackRow(msg));
      playAlert(msg);
    }
  });
  ws.addEventListener('close', () => setTimeout(connectLiveSocket, 2000));
}

function playAlert(signal) {
  document.getElementById('alert-sound').play().catch(() => {});
  if (Notification.permission === 'granted') {
    new Notification(`${signal.side} ${signal.symbol}`, { body: `Price ${signal.price}` });
  }
}

document.getElementById('tab-live').addEventListener('click', () => {
  document.getElementById('view-live').classList.remove('hidden');
  document.getElementById('view-track').classList.add('hidden');
  document.getElementById('tab-live').classList.add('active');
  document.getElementById('tab-track').classList.remove('active');
});

document.getElementById('tab-track').addEventListener('click', () => {
  document.getElementById('view-track').classList.remove('hidden');
  document.getElementById('view-live').classList.add('hidden');
  document.getElementById('tab-track').classList.add('active');
  document.getElementById('tab-live').classList.remove('active');
});

document.getElementById('date-picker').value = state.date;
document.getElementById('date-picker').addEventListener('change', (e) => {
  state.date = e.target.value;
  loadSignals(state.date);
});

if (window.Notification && Notification.permission === 'default') {
  Notification.requestPermission();
}

loadSignals(state.date);
loadStatus();
connectLiveSocket();
setInterval(loadStatus, 30000);
```

- [ ] **Step 4: Manual verification**

Run: `node backend/server.js` is not wired yet (Task 14) — for now, verify with a throwaway static server:

```bash
node -e "require('http').createServer(require('serve-handler')).listen(5000)" 2>/dev/null || npx --yes serve frontend -p 5000
```

Open `http://localhost:5000` and confirm: header/branding renders, counters show 0/0/0, tabs switch between Live/Track views, no console errors (WS connection error is expected — backend isn't running yet).

- [ ] **Step 5: Commit**

```bash
git add frontend/index.html frontend/style.css frontend/app.js
git commit -m "feat: add dashboard skeleton with counters, table, and live WS client"
```

---

### Task 13: Candlestick chart modal with signal markers

**Files:**
- Modify: `frontend/app.js` (append chart logic)

**Interfaces:**
- Consumes: `GET /api/candles/:symbol` (Task 9), Chart.js + chartjs-chart-financial (loaded via CDN in Task 12's `index.html`).
- Produces: `openChartModal(symbol)`, called from `renderSignalRow`'s click handler (Task 12).

- [ ] **Step 1: Append chart modal logic to frontend/app.js**

```js
// --- appended to frontend/app.js ---
let activeChart = null;

async function openChartModal(symbol) {
  const resp = await fetch(`/api/candles/${symbol}`);
  const candles = await resp.json();
  const modal = document.getElementById('chart-modal');
  document.getElementById('chart-title').textContent = symbol;
  modal.classList.remove('hidden');

  const ohlc = candles.map((c) => ({ x: c.time, o: c.open, h: c.high, l: c.low, c: c.close }));
  const markers = state.signals
    .filter((s) => s.symbol === symbol)
    .map((s) => ({ x: new Date(s.candle_time).getTime(), y: s.price, side: s.side }));

  if (activeChart) activeChart.destroy();
  const ctx = document.getElementById('chart-canvas').getContext('2d');
  activeChart = new Chart(ctx, {
    type: 'candlestick',
    data: {
      datasets: [
        { label: symbol, data: ohlc },
        {
          type: 'scatter',
          label: 'Signals',
          data: markers.map((m) => ({ x: m.x, y: m.y })),
          pointBackgroundColor: markers.map((m) => (m.side === 'BUY' ? '#21c55d' : '#ef4444')),
          pointStyle: markers.map((m) => (m.side === 'BUY' ? 'triangle' : 'rectRot')),
          pointRadius: 6,
        },
      ],
    },
    options: {
      scales: { x: { type: 'time', time: { unit: 'minute' } } },
    },
  });
}

document.getElementById('chart-close').addEventListener('click', () => {
  document.getElementById('chart-modal').classList.add('hidden');
});
```

- [ ] **Step 2: Manual verification**

Serve `frontend/` (as in Task 12 Step 4). Temporarily stub `/api/candles/:symbol` in a scratch script or wait for Task 14's real backend, then: click a row in the signal table, confirm the modal opens with a candlestick chart and, if that symbol has signals loaded, triangle/rect markers at the signal price/time.

- [ ] **Step 3: Commit**

```bash
git add frontend/app.js
git commit -m "feat: add per-stock candlestick chart modal with signal markers"
```

---

### Task 14: Wire the full backend (server.js, live pipeline)

**Files:**
- Create: `backend/server.js`

**Interfaces:**
- Consumes every module from Tasks 1-11.
- Produces: the running application (`npm start`).

- [ ] **Step 1: Write backend/server.js**

```js
// backend/server.js
const path = require('node:path');
const express = require('express');
const http = require('node:http');

const { loadConfig } = require('./config');
const { isMarketOpen } = require('./marketWindow');
const { openDb, insertSignal } = require('./db');
const { evaluateSignal, MIN_CANDLES } = require('./signalEngine');
const { CandleAggregator } = require('./candleAggregator');
const { checkOpenSignals, closeRemainingOpenSignals } = require('./outcomeTracker');
const { createConnectionStatus } = require('./connectionStatus');
const { createApiRouter } = require('./api');
const { createLiveSocketServer } = require('./liveSocket');
const { createDhanFeed } = require('./dhanFeed');
const { resolveNifty50InstrumentMap } = require('./instrumentMap');

const config = loadConfig();
const db = openDb();
const connectionStatus = createConnectionStatus();
const aggregator = new CandleAggregator();

const app = express();
app.use(express.static(path.join(__dirname, '..', 'frontend')));
app.use('/api', createApiRouter({
  db,
  connectionStatus,
  isMarketOpenFn: isMarketOpen,
  getCandles: (symbol) => aggregator.getCandles(symbol),
}));

const httpServer = http.createServer(app);
const { broadcast } = createLiveSocketServer(httpServer, '/live');

function todayTradeDate() {
  const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  return ist.toISOString().slice(0, 10);
}

async function startIngestion() {
  const instrumentMap = await resolveNifty50InstrumentMap();
  const securityIdToSymbol = new Map();
  for (const [symbol, securityId] of instrumentMap) securityIdToSymbol.set(securityId, symbol);

  const feed = createDhanFeed({ clientId: config.clientId, accessToken: config.accessToken });

  feed.on('connected', () => connectionStatus.setConnected(true));
  feed.on('disconnected', () => connectionStatus.setConnected(false));
  feed.on('error', (err) => connectionStatus.setError(err));

  feed.on('tick', (tick) => {
    if (!isMarketOpen()) return;
    const symbol = securityIdToSymbol.get(tick.symbol) || tick.symbol;
    const closedCandle = aggregator.onTick({ ...tick, symbol });
    if (!closedCandle) return;

    checkOpenSignals(db, symbol, closedCandle, todayTradeDate());
    broadcast({ type: 'candle', symbol, candle: closedCandle });

    const candles = aggregator.getCandles(symbol);
    if (candles.length < MIN_CANDLES) return;
    const { side, score } = evaluateSignal(candles);
    if (side === 'NEUTRAL') return;

    const candleTime = new Date(closedCandle.time).toISOString();
    const tradeDate = todayTradeDate();
    const id = insertSignal(db, { symbol, side, price: closedCandle.close, score, candleTime, tradeDate });
    broadcast({ type: 'signal', id, symbol, side, price: closedCandle.close, score, candle_time: candleTime, outcome: 'OPEN' });
  });

  const instruments = [...instrumentMap.values()].map((securityId) => ({ exchangeSegment: 'NSE_EQ', securityId }));
  await feed.connect(instruments);
}

setInterval(() => {
  if (!isMarketOpen()) closeRemainingOpenSignals(db, todayTradeDate());
}, 5 * 60 * 1000);

httpServer.listen(config.port, () => {
  console.log(`PowerBull Pro listening on http://localhost:${config.port}`);
  if (isMarketOpen()) {
    startIngestion().catch((err) => console.error('Ingestion failed to start:', err));
  } else {
    console.log('Market closed — ingestion will not start until 9:30 IST on a trading day. Restart the server during market hours.');
  }
});
```

- [ ] **Step 2: Manual end-to-end smoke test (must be run during 9:30-15:30 IST on a trading day)**

1. Follow `docs/dhan-setup.md` fully — generate a fresh token at web.dhan.co (it's only valid ~24h), put `DHAN_CLIENT_ID`/`DHAN_ACCESS_TOKEN` in `.env`.
2. Run: `npm start`
3. Confirm the server log shows `Ingestion failed to start` is NOT printed, and `GET /api/status` (browser or `curl http://localhost:3000/api/status`) reports `marketOpen: true, feedConnected: true, lastError: null`.
4. Wait for at least one 5-minute candle boundary; confirm `GET /api/candles/RELIANCE` (or any Nifty50 symbol) returns a non-empty array.
5. Wait until at least one symbol has ≥21 candles and a real BUY/SELL fires; confirm it appears in the dashboard table, plays the alert sound, and shows a browser notification (grant permission if prompted).
6. Confirm the fired signal is queryable via `GET /api/signals?date=<today>` and that clicking its row opens the chart modal with a marker at the right time/price.
7. If the token expires mid-session (Dhan disconnects with "Access Token is expired"), confirm `/api/status` flips to `feedConnected: false` with that message in `lastError`, and the dashboard banner reflects it.
8. Run `npm test` once more to confirm nothing broke: all backend unit tests should still pass (these don't depend on live market data).

- [ ] **Step 3: Commit**

```bash
git add backend/server.js
git commit -m "feat: wire full ingestion pipeline into server.js"
```

---

## Self-Review Notes

- **Spec coverage:** Dhan connection status (Task 8), live WS ingestion (Task 11/14), 5-min candles (Task 5), multi-indicator scoring (Task 3), SQLite + track record (Task 4/6), REST+WS API (Task 9/10), dashboard/counters/table (Task 12), chart+markers (Task 13), alerts (Task 12's `playAlert`), date picker (Task 12), Nifty50 universe resolved live (Task 7), market-window gating (Task 1, used in Task 9/14), disclaimer (Task 12's `index.html`) — all covered.
- **Known honest gap:** the exact NSE Nifty50 CSV response shape (and whether NSE's anti-bot headers still accept `User-Agent: Mozilla/5.0`) can't be pinned down with full certainty at plan-writing time since it's an unofficial endpoint — Task 7 calls this out as a manual-verification step. In contrast, Dhan's wire format (auth URL, subscribe JSON, binary Quote packet layout) is NOT a gap: it was confirmed by downloading the actual `dhanhq` PyPI package and reading its source, and separately by downloading and inspecting the real scrip-master CSV — both are asserted as fact because they were verified, not guessed.
- **Type consistency checked:** `Candle` shape `{time, open, high, low, close, volume}` is identical across `candleAggregator.js`, `signalEngine.js`, `outcomeTracker.js`, and the frontend chart code. Signal row shape (`symbol, side, price, score, candle_time/candleTime, trade_date/tradeDate, outcome`) matches between `db.js`'s SQL columns, `server.js`'s broadcast payloads, and `frontend/app.js`'s renderers (SQLite returns snake_case columns; `insertSignal`'s JS-facing params are camelCase — both forms appear intentionally, matching which side of the boundary they're on).
