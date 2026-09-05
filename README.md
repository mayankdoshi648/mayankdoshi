# PowerBull Pro + DarvaX Scanner

Intraday EMA/RSI dashboard (Dhan live feed) plus **DarvaX box scanner** for NSE + US markets: strength scoring, Obsidian export, Telegram alerts, Screener.in fundamentals, and optional Dhan order flow.

## Laptop setup (start here)

### 1. Prerequisites

- **Node.js 22.5+** (`node -v`)
- Git
- Dhan account (for NSE historical data and orders)
- Obsidian vault path (optional, for second-brain export)
- Telegram bot (optional, for alerts)

### 2. Clone and install

```bash
git clone https://github.com/mayankdoshi648/mayankdoshi.git
cd mayankdoshi
git checkout cursor/darvax-engine-dashboard-213b
npm install
npm test
```

All DarvaX work is on branch `cursor/darvax-engine-dashboard-213b` ([PR #1](https://github.com/mayankdoshi648/mayankdoshi/pull/1)). After the PR is merged, use `master` instead.

### 3. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:

| Variable | Purpose |
|----------|---------|
| `DHAN_CLIENT_ID`, `DHAN_PIN`, `DHAN_TOTP_SECRET` | Dhan login + NSE EOD history |
| `OBSIDIAN_VAULT_PATH` | Full path to your Obsidian vault |
| `OBSIDIAN_MIN_SCORE` | Min score for Obsidian notes (default 55) |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Alerts via @BotFather + @userinfobot |
| `TELEGRAM_MIN_SCORE` | Alert threshold (default 85) |
| `DARVAX_AUTO_TRADE` | Keep `false` until paper-trading validates picks |

### 4. Run locally

**Dashboard** (DarvaX Scanner tab at http://localhost:3000):

```bash
npm start
```

**One-off daily scan** (~20 min for full Nifty 500 + S&P 500):

```bash
npm run darvax:scan -- --export-obsidian --telegram
```

**Weekday cron** (7:00 AM IST, Mon–Fri):

```bash
npm run cron:install
# logs: data/darvax-cron.log
# remove: npm run cron:remove
```

### 5. Obsidian output

When `OBSIDIAN_VAULT_PATH` is set, scans write:

```
03-Watchlists/
  YYYY-MM-DD.md
  YYYY-MM-DD-NSE.md
  YYYY-MM-DD-US.md
  stocks/
    YYYY-MM-DD-NSE-SYMBOL.md
```

### 6. Useful commands

```bash
npm run universe:build    # Rebuild Nifty 500 / S&P 500 symbol lists
npm run darvax:scan -- --market=NSE   # NSE only
npm run darvax:scan -- --market=US    # US only
```

## Market Breadth dashboard

Open **Market Breadth** in the app (http://localhost:3000) to see:

- % of Nifty 50 / Nifty 500 stocks above 20 / 50 / 200 DMA
- Index vs breadth line charts (divergence view)
- Spirit-level gauges + posture diagnosis (STOP PRESSING / REDUCE RISK / SIT OUT / GREEN LIGHT)

Data sources: **Yahoo Finance** (default, no keys) using the NSE Nifty 50/500 universe. If Dhan credentials are set, NSE EOD history is preferred automatically. Kotak Neo is not wired yet — use Yahoo/Dhan path above.

First refresh for Nifty 50 takes ~1–2 minutes; results cache for 6 hours under `data/breadth-cache.json`.

## Architecture (DarvaX)

- `backend/darvaxEngine.js` — Box rules, Wyckoff, patterns, strength score, stops
- `backend/darvaxScanner.js` — Universe scan, RS percentiles, fundamentals, Telegram
- `backend/darvaxData.js` — NSE via Dhan historical, US via Yahoo
- `backend/screenerFundamentals.js` — Screener.in scrape + score bonus
- `backend/telegramAlerts.js` — High-score / SUPER_TREND / BREAKOUT alerts
- `backend/obsidianExport.js` — Vault markdown export
- `backend/dhanOrders.js` — Manual-approval Dhan limit orders
- `frontend/` — Dashboard with DarvaX Scanner tab

## Safety

- Keep `DARVAX_AUTO_TRADE=false` initially; approve orders manually in the dashboard.
- Telegram and Obsidian are optional; scanner works with Yahoo fallback if Dhan creds are missing (NSE quality is better with Dhan).
