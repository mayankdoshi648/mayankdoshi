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
