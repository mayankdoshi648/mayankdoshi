# NSE F&O Intelligence Terminal (+ PowerBull / DarvaX)

Professional **mobile-first Indian NSE F&O market intelligence terminal**, built on the existing PowerBull Pro + DarvaX equity stack.

## Live demo (shareable · mobile)

| Host | Link |
|------|------|
| **GitHub Pages** | **https://mayankdoshi648.github.io/mayankdoshi/** |
| Vercel | https://mayankdoshi.vercel.app |

On static hosts the app runs in **labeled MOCK / static-demo mode** (full UI + Smart Money WHY panel). For live Dhan/NSE feeds, run the Node server locally (`npm start`), then open **More → Dhan API** and enter Client ID / PIN / TOTP (or set `DHAN_*` in `.env`).

> First-time GitHub Pages: after merge, open **Repo → Settings → Pages → Source = GitHub Actions**, then re-run the **Deploy GitHub Pages** workflow if needed.

## What you get

| Section | Purpose |
|---------|---------|
| Home | Regime + Smart Money + options + sectors + alerts |
| F&O | Long/short buildup scanners |
| Options | Chain, PCR, max pain, expected move |
| Scan | Smart Money Proxy rankings |
| Opp | Opportunity checklist / trade readiness |
| Heatmap | Sector Smart Money → stock drill-down |
| Dhan API | In-app Client ID / PIN / TOTP → live option chain (Node server only) |
| WHY drawer | Explainable positioning checklist |
| Equity / DarvaX | Preserved live EMA/RSI + DarvaX scanner |

## Architecture

See [`docs/fno-architecture.md`](docs/fno-architecture.md).

Layers: **Providers → Normalize → Calculations → Service/Engines → API → UI**.

- **Dhan** (optional): option chain + equity live feed
- **NSE public**: indices / FII-DII cash when reachable
- **Mock / static-demo** (explicitly labeled): shareable GitHub Pages & Vercel, or local `FNO_FORCE_MOCK=1`

## Setup

```bash
git clone https://github.com/mayankdoshi648/mayankdoshi.git
cd mayankdoshi
git checkout master
npm install
cp .env.example .env
npm test
FNO_FORCE_MOCK=1 npm start
```

Open **http://localhost:3000**

Open http://localhost:3000

### Vercel note

`vercel.json` deploys the **static `frontend/`** only (UI shell). The Express + SQLite + WebSocket backend is not serverless-compatible — run `npm start` (or your own Node host) for live API/feeds. Preview checks for linked Vercel projects should pass with this static config.

### Environment

| Variable | Purpose |
|----------|---------|
| `DHAN_CLIENT_ID`, `DHAN_PIN`, `DHAN_TOTP_SECRET` | Live Dhan option chain + equity feed |
| `FNO_FORCE_MOCK=1` | Force labeled mock F&O data (UI/dev) |
| `PORT` | Default 3000 |
| DarvaX / Telegram / Obsidian | Same as before (optional) |

**Server boots without Dhan** — terminal uses NSE public + labeled mock. Set `DHAN_*` in `.env` **or** enter them in **More → Dhan API** (optional write-back to `.env`).

Never commit `.env`. PIN / TOTP are never returned by `GET /api/fno/credentials/dhan` (masked client id only).

## Key API routes

- `GET /api/fno/ticker` — NIFTY / BANKNIFTY / FINNIFTY / MIDCPNIFTY / INDIA VIX
- `GET /api/fno/overview` — regime + options snapshot
- `GET /api/fno/option-chain/:underlying?expiry=`
- `GET /api/fno/scanner` · `/buildups` · `/smart-money` · `/sectors`
- `GET /api/fno/fii-dii` · `/alerts` · `/watchlist`
- `GET /api/fno/opportunity` · `/opportunity/:symbol` — trade-readiness checklist
- `GET|PUT|DELETE /api/fno/credentials/dhan` · `POST …/test` — runtime Dhan API credentials
- Existing: `/api/signals`, `/api/darvax/*`, `/api/overview`, `/api/breadth`

## Calculations (unit-tested)

OI buildup classification, PCR, max pain, expected move  
`spot × (IV/100) × √(DTE/365)`, market regime score, smart-money proxy, sector strength.

## Safety

- No naked BUY/SELL — interpretations always show evidence metrics
- Smart Money is a **PROXY**, not institutional identification
- Missing / unavailable fields stay `null` — never fabricated as live
- Mock responses always set `meta.isMock: true` and UI banner

## Legacy DarvaX

DarvaX scan, Obsidian export, Telegram alerts, and manual-approval orders remain under **Equity / DarvaX** in the terminal.
