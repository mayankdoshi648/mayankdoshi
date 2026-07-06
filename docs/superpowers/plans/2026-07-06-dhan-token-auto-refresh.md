# Dhan Token Auto-Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the manual daily Dhan access-token regeneration with an automatic fetch at server startup, using Dhan's TOTP-based `generateAccessToken` endpoint.

**Architecture:** New `backend/dhanAuth.js` module computes a live TOTP code (via `otplib`) and POSTs it with the trading PIN and client ID to Dhan's auth endpoint, returning a fresh access token. `server.js`'s `startIngestion()` calls this before connecting the feed. `config.js` swaps the `DHAN_ACCESS_TOKEN` env var for `DHAN_PIN` + `DHAN_TOTP_SECRET`.

**Tech Stack:** `otplib` (new dependency) for RFC 6238 TOTP generation. Node's built-in `fetch`. Tests use Node's built-in `node:test` runner, matching the rest of the project.

## Global Constraints

- Startup-only refresh — no background timer, no mid-session token swap while a live feed connection is active. The app is still restarted once per trading day.
- Dhan's `RenewToken` endpoint (extends an *existing* still-valid token) is out of scope — startup-only `generateAccessToken` already produces a fresh 24h token on every run.
- Auth endpoint: `POST https://auth.dhan.co/app/generateAccessToken?dhanClientId={id}&pin={pin}&totp={code}` — `code` is a live 6-digit TOTP computed from the account's TOTP secret via `otplib`, not cached.
- `DHAN_ACCESS_TOKEN` env var is dropped entirely — no fallback/override path. The token only ever exists in memory for the process lifetime.
- One-time TOTP enrollment on the user's Dhan account (web.dhan.co) is a manual prerequisite this app cannot automate — documented in `docs/dhan-setup.md`.
- Security: trading PIN + TOTP secret are higher-value secrets than a bare 24h token (a leaked PIN could authorize other account actions). `.env` is already gitignored; call this out explicitly in the setup doc.

---

## File Structure

```
powerbull-pro/
  package.json           (modify: add otplib dependency)
  .env.example           (modify: swap DHAN_ACCESS_TOKEN for DHAN_PIN + DHAN_TOTP_SECRET)
  docs/
    dhan-setup.md         (modify: TOTP enrollment steps, drop daily manual-token steps)
  backend/
    dhanAuth.js           (create)
    dhanAuth.test.js       (create)
    config.js             (modify)
    server.js             (modify)
```

---

### Task 1: Dhan TOTP-based access token fetcher

**Files:**
- Modify: `package.json` (add `otplib` dependency)
- Create: `backend/dhanAuth.js`
- Test: `backend/dhanAuth.test.js`

**Interfaces:**
- Produces: `fetchAccessToken({ clientId, pin, totpSecret }, fetchImpl = fetch): Promise<{ accessToken: string, expiryTime: string }>` — throws if the HTTP response is not OK, or if the response body has no `accessToken`.
- Consumed by: `server.js` (Task 3).

- [ ] **Step 1: Add otplib dependency**

Edit `package.json`'s `dependencies` block to:

```json
  "dependencies": {
    "dotenv": "^16.4.5",
    "express": "^4.21.0",
    "otplib": "^12.0.1",
    "ws": "^8.18.0"
  }
```

Run: `npm install`
Expected: `node_modules/otplib` created, no errors.

- [ ] **Step 2: Write the failing tests**

```js
// backend/dhanAuth.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { fetchAccessToken } = require('./dhanAuth');

const VALID_TOTP_SECRET = 'JBSWY3DPEHPK3PXP';

test('fetchAccessToken POSTs clientId, pin, and a 6-digit totp to the generateAccessToken endpoint', async () => {
  let capturedUrl;
  let capturedOptions;
  const fetchImpl = async (url, options) => {
    capturedUrl = url;
    capturedOptions = options;
    return {
      ok: true,
      json: async () => ({ accessToken: 'tok123', expiryTime: '2026-07-07T09:30:00Z', dhanClientId: '1000000001' }),
    };
  };

  const result = await fetchAccessToken(
    { clientId: '1000000001', pin: '123456', totpSecret: VALID_TOTP_SECRET },
    fetchImpl
  );

  const parsed = new URL(capturedUrl);
  assert.equal(parsed.origin + parsed.pathname, 'https://auth.dhan.co/app/generateAccessToken');
  assert.equal(parsed.searchParams.get('dhanClientId'), '1000000001');
  assert.equal(parsed.searchParams.get('pin'), '123456');
  assert.match(parsed.searchParams.get('totp'), /^\d{6}$/);
  assert.equal(capturedOptions.method, 'POST');
  assert.deepEqual(result, { accessToken: 'tok123', expiryTime: '2026-07-07T09:30:00Z' });
});

test('fetchAccessToken throws with the HTTP status when the response is not OK', async () => {
  const fetchImpl = async () => ({ ok: false, status: 401, statusText: 'Unauthorized' });
  await assert.rejects(
    () => fetchAccessToken({ clientId: 'x', pin: 'y', totpSecret: VALID_TOTP_SECRET }, fetchImpl),
    /401/
  );
});

test('fetchAccessToken throws when the response body has no accessToken', async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ foo: 'bar' }) });
  await assert.rejects(
    () => fetchAccessToken({ clientId: 'x', pin: 'y', totpSecret: VALID_TOTP_SECRET }, fetchImpl),
    /accessToken/
  );
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --test backend/dhanAuth.test.js`
Expected: FAIL — `Cannot find module './dhanAuth'`

- [ ] **Step 4: Write implementation**

```js
// backend/dhanAuth.js
const { authenticator } = require('otplib');

const GENERATE_TOKEN_URL = 'https://auth.dhan.co/app/generateAccessToken';

async function fetchAccessToken({ clientId, pin, totpSecret }, fetchImpl = fetch) {
  const totp = authenticator.generate(totpSecret);
  const url = new URL(GENERATE_TOKEN_URL);
  url.searchParams.set('dhanClientId', clientId);
  url.searchParams.set('pin', pin);
  url.searchParams.set('totp', totp);

  const resp = await fetchImpl(url.toString(), { method: 'POST' });
  if (!resp.ok) {
    throw new Error(`Dhan generateAccessToken failed: HTTP ${resp.status}`);
  }
  const body = await resp.json();
  if (!body.accessToken) {
    throw new Error('Dhan generateAccessToken response missing accessToken');
  }
  return { accessToken: body.accessToken, expiryTime: body.expiryTime };
}

module.exports = { fetchAccessToken };
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test backend/dhanAuth.test.js`
Expected: 3 tests pass.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json backend/dhanAuth.js backend/dhanAuth.test.js
git commit -m "feat: add TOTP-based Dhan access token fetcher"
```

---

### Task 2: Config loader — swap access token for PIN + TOTP secret

**Files:**
- Modify: `backend/config.js`

**Interfaces:**
- Produces: `loadConfig(): { clientId, pin, totpSecret, port }` (throws if `DHAN_CLIENT_ID`, `DHAN_PIN`, or `DHAN_TOTP_SECRET` are missing). Replaces the old `{ clientId, accessToken, port }` shape.
- Consumed by: `server.js` (Task 3).

- [ ] **Step 1: Update config.js**

```js
// backend/config.js
require('dotenv').config();

function loadConfig() {
  const required = ['DHAN_CLIENT_ID', 'DHAN_PIN', 'DHAN_TOTP_SECRET'];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required env vars: ${missing.join(', ')}. Copy .env.example to .env and fill it in.`);
  }
  return {
    clientId: process.env.DHAN_CLIENT_ID,
    pin: process.env.DHAN_PIN,
    totpSecret: process.env.DHAN_TOTP_SECRET,
    port: Number(process.env.PORT || 3000),
  };
}

module.exports = { loadConfig };
```

- [ ] **Step 2: Manual verification (no existing test file to run — config.js has none in this codebase)**

Run: `node -e "process.env.DHAN_CLIENT_ID='x'; require('./backend/config').loadConfig()"`
Expected: throws `Missing required env vars: DHAN_PIN, DHAN_TOTP_SECRET. Copy .env.example to .env and fill it in.`

Run: `node -e "process.env.DHAN_CLIENT_ID='x'; process.env.DHAN_PIN='1'; process.env.DHAN_TOTP_SECRET='2'; console.log(require('./backend/config').loadConfig())"`
Expected: prints `{ clientId: 'x', pin: '1', totpSecret: '2', port: 3000 }`

- [ ] **Step 3: Commit**

```bash
git add backend/config.js
git commit -m "feat: swap DHAN_ACCESS_TOKEN config for DHAN_PIN + DHAN_TOTP_SECRET"
```

---

### Task 3: Wire token fetch into server startup

**Files:**
- Modify: `backend/server.js`

**Interfaces:**
- Consumes: `fetchAccessToken` from `./dhanAuth` (Task 1); `loadConfig`'s new `{ clientId, pin, totpSecret, port }` shape (Task 2).

- [ ] **Step 1: Add the import**

In `backend/server.js`, change:

```js
const { createDhanFeed } = require('./dhanFeed');
const { resolveNifty50InstrumentMap } = require('./instrumentMap');
```

to:

```js
const { createDhanFeed } = require('./dhanFeed');
const { resolveNifty50InstrumentMap } = require('./instrumentMap');
const { fetchAccessToken } = require('./dhanAuth');
```

- [ ] **Step 2: Fetch the token at the top of startIngestion()**

Change:

```js
async function startIngestion() {
  const instrumentMap = await resolveNifty50InstrumentMap();
  const securityIdToSymbol = new Map();
  for (const [symbol, securityId] of instrumentMap) securityIdToSymbol.set(securityId, symbol);

  const feed = createDhanFeed({ clientId: config.clientId, accessToken: config.accessToken });
```

to:

```js
async function startIngestion() {
  const { accessToken } = await fetchAccessToken(config);

  const instrumentMap = await resolveNifty50InstrumentMap();
  const securityIdToSymbol = new Map();
  for (const [symbol, securityId] of instrumentMap) securityIdToSymbol.set(securityId, symbol);

  const feed = createDhanFeed({ clientId: config.clientId, accessToken });
```

- [ ] **Step 3: Surface token-fetch failures via connectionStatus**

Change:

```js
httpServer.listen(config.port, () => {
  console.log(`PowerBull Pro listening on http://localhost:${config.port}`);
  if (isMarketOpen()) {
    startIngestion().catch((err) => console.error('Ingestion failed to start:', err));
  } else {
    console.log('Market closed — ingestion will not start until 9:30 IST on a trading day. Restart the server during market hours.');
  }
});
```

to:

```js
httpServer.listen(config.port, () => {
  console.log(`PowerBull Pro listening on http://localhost:${config.port}`);
  if (isMarketOpen()) {
    startIngestion().catch((err) => {
      connectionStatus.setError(err);
      console.error('Ingestion failed to start:', err);
    });
  } else {
    console.log('Market closed — ingestion will not start until 9:30 IST on a trading day. Restart the server during market hours.');
  }
});
```

- [ ] **Step 4: Manual verification (server.js has no automated test in this codebase; it's exercised via the Task 14 smoke test in the original plan)**

Run: `node -e "require('./backend/server.js')"` with `.env` deliberately missing `DHAN_PIN`
Expected: process throws the `loadConfig` error from Task 2 immediately (before the HTTP server even starts listening), confirming the new required vars are enforced.

Then, with a real `.env` (see Task 4) and outside market hours:
Run: `npm start`
Expected: server starts and logs the "Market closed" message (unchanged behavior — `startIngestion`, and therefore `fetchAccessToken`, only runs when `isMarketOpen()` is true).

- [ ] **Step 5: Run the full test suite to confirm nothing else broke**

Run: `npm test`
Expected: all tests pass (existing suites are untouched by this change; `db.test.js`/`api.test.js`/etc. don't construct `config` objects with the old `accessToken` shape).

- [ ] **Step 6: Commit**

```bash
git add backend/server.js
git commit -m "feat: fetch Dhan access token at startup instead of reading it from env"
```

---

### Task 4: Update setup docs and .env.example

**Files:**
- Modify: `.env.example`
- Modify: `docs/dhan-setup.md`

**Interfaces:** None (documentation only).

- [ ] **Step 1: Update .env.example**

```
DHAN_CLIENT_ID=
DHAN_PIN=
DHAN_TOTP_SECRET=
PORT=3000
```

- [ ] **Step 2: Rewrite docs/dhan-setup.md**

```markdown
# Dhan Setup

This app fetches a fresh Dhan access token automatically at every startup,
using Dhan's TOTP-based `generateAccessToken` endpoint — no manual daily
token regeneration, and no OAuth redirect flow (this is a single-user
personal app).

## One-time setup

1. Log into https://web.dhan.co
2. Enable Two-Factor Authentication (TOTP) on your account if you haven't
   already — this is under your profile's security settings, and issues a
   TOTP secret (usually shown as a QR code plus a plain-text secret you can
   copy).
3. Copy your Client ID (`dhanClientId`), your trading PIN, and the TOTP
   secret into `.env` as `DHAN_CLIENT_ID`, `DHAN_PIN`, and
   `DHAN_TOTP_SECRET` (see `.env.example`).

**Security note:** your trading PIN and TOTP secret are higher-value
secrets than a bare 24h access token — a leaked PIN could authorize other
account actions, not just this app's read-only market feed access. `.env`
is already excluded via `.gitignore`; don't commit it or share it.

## Every trading day

Just run `npm start` before 9:30 IST. The server fetches a fresh access
token automatically at startup — no manual steps.
```

- [ ] **Step 3: Commit**

```bash
git add .env.example docs/dhan-setup.md
git commit -m "docs: update Dhan setup for automatic TOTP-based token refresh"
```

---

## Self-Review Notes

- **Spec coverage:** `dhanAuth.js` fetcher (Task 1), config swap (Task 2), server wiring + error surfacing via `connectionStatus.setError` (Task 3), docs/`.env.example` rewrite with security note (Task 4) — all sections of the design spec are covered. `RenewToken` and background-timer refresh are explicitly out of scope per the spec and are not implemented here.
- **Type consistency:** `fetchAccessToken({ clientId, pin, totpSecret }, fetchImpl)` (Task 1) matches the `config` object shape `{ clientId, pin, totpSecret, port }` produced by `loadConfig()` (Task 2) — `server.js` (Task 3) passes `config` directly into `fetchAccessToken(config)`, so the property names must line up, and they do.
- **No placeholders:** every step has complete, copy-pasteable code or exact commands with expected output.
