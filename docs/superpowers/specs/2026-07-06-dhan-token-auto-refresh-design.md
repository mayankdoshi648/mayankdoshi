# Dhan Token Auto-Refresh — Design Spec

## Purpose

Replace the manual daily Dhan access-token regeneration (log into web.dhan.co,
click generate, copy `DHAN_ACCESS_TOKEN` into `.env`) with an automatic fetch
at server startup, using Dhan's TOTP-based `generateAccessToken` endpoint.
This supersedes the "no OAuth flow, no token-refresh code" constraint in the
original plan (`docs/superpowers/plans/2026-07-05-powerbull-pro.md`) — that
was a deliberate simplicity trade-off at the time, now revisited because the
manual step is the one piece of daily friction left.

## Scope

- Startup-only refresh. The app is still restarted once per trading day (per
  `docs/dhan-setup.md`); no background timer, no mid-session token swap while
  a live feed connection is active.
- Dhan's `RenewToken` endpoint (extends an *existing* still-valid token) is
  out of scope — startup-only `generateAccessToken` already produces a fresh
  24h token on every run, so there's no case where extending a token instead
  of generating a new one is needed.
- One-time TOTP enrollment on the user's Dhan account is a manual prerequisite
  (documented in `docs/dhan-setup.md`), not something the app can automate.

## Auth Flow

`POST https://auth.dhan.co/app/generateAccessToken?dhanClientId={id}&pin={pin}&totp={code}`

- `code` is a live 6-digit TOTP computed from the account's TOTP secret via
  `otplib` (`authenticator.generate(secret)`), not stored/cached.
- Response: `{ accessToken, expiryTime, dhanClientId, dhanClientName }`.
  Only `accessToken` is consumed; `expiryTime` isn't checked (irrelevant for
  startup-only refresh — token is fresh every run).
- Non-2xx response or a body missing `accessToken` throws with a message
  including the HTTP status, so the existing `startIngestion().catch(...)`
  in `server.js` surfaces something actionable rather than a generic failure.

## New Module: `backend/dhanAuth.js`

- Produces: `fetchAccessToken({ clientId, pin, totpSecret }, fetchImpl = fetch): Promise<{ accessToken, expiryTime }>`.
- Consumed by: `server.js`, called once at the top of `startIngestion()`,
  before `createDhanFeed(...)`.

## Config Changes: `backend/config.js`

- `loadConfig()` now requires `DHAN_CLIENT_ID`, `DHAN_PIN`, `DHAN_TOTP_SECRET`.
- `DHAN_ACCESS_TOKEN` is dropped entirely — no fallback/override path. The
  token only ever exists in memory for the lifetime of the process.

## Server Wiring: `backend/server.js`

- `startIngestion()`:
  1. `const { accessToken } = await fetchAccessToken(config);`
  2. Pass `accessToken` into `createDhanFeed({ clientId: config.clientId, accessToken })` (unchanged signature otherwise).
- On failure, the existing `.catch((err) => console.error(...))` on
  `startIngestion()` gains one line: `connectionStatus.setError(err)` — so
  `/api/status` (`lastError`) and the dashboard banner reflect *why* ingestion
  never started, instead of just showing "disconnected" with no reason.

## Testing (TDD, matching existing project style)

`backend/dhanAuth.test.js`:
- Mocked `fetchImpl` asserts the request URL/query params (`dhanClientId`,
  `pin`, a 6-digit `totp`) are built correctly.
- Mocked 2xx response with `{accessToken, expiryTime}` resolves correctly.
- Mocked non-OK response rejects with an error message containing the HTTP
  status.
- TOTP *generation* itself isn't re-tested — that's `otplib`'s job; only that
  a 6-digit numeric string gets interpolated into the query string.

## Docs: `docs/dhan-setup.md` / `.env.example`

- Rewritten: one-time TOTP enrollment steps at web.dhan.co (enable 2FA,
  scan/copy the TOTP secret), trading PIN and TOTP secret go in `.env`
  (`DHAN_PIN`, `DHAN_TOTP_SECRET`) alongside `DHAN_CLIENT_ID`. No more daily
  manual token regeneration — just restart the server before market open.
- **Security note, called out explicitly in the setup doc:** the trading PIN
  and TOTP secret are higher-value secrets than a bare 24h token — a leaked
  PIN could authorize other account actions, not just this app's read-only
  feed access. `.gitignore` already excludes `.env`.

## Dependency

- Add `otplib` to `package.json` (`dependencies`).
