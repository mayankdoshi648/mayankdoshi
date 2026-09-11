# NSE F&O Intelligence Terminal (+ PowerBull / DarvaX)

Professional **mobile-first Indian NSE F&O market intelligence terminal**, built on the existing PowerBull Pro + DarvaX equity stack.

## Live demo (shareable · mobile)

| Host | Link | Mode |
|------|------|------|
| **GitHub Pages** | **https://mayankdoshi648.github.io/mayankdoshi/** | Labeled **MOCK** static UI |
| Vercel | https://mayankdoshi.vercel.app | Labeled **MOCK** static UI |
| **Permanent live** | Deploy `render.yaml` (Render Web Service) | **Live** Express + Dhan + NSE |

Static hosts cannot store Dhan secrets or run WebSockets. For a **bookmarkable permanent HTTPS URL** that works on phone + laptop:

1. Open [Render](https://render.com) → New → Blueprint → this repo (`render.yaml`)
2. Set secrets: `DHAN_CLIENT_ID`, `DHAN_ACCESS_TOKEN` (or PIN + TOTP)
3. Copy the `https://….onrender.com` URL — that is your permanent link

Optional one-time bootstrap (token stripped from the address bar immediately):

`https://YOUR-HOST/?client_id=XXXX&token=YYYY`

Then the browser shows only `https://YOUR-HOST/`. Prefer platform env secrets for day-to-day use.

In-app: **More → Dhan API** or the header **connection pill** → Data Connections.

Data matrix: [`docs/data-sources.md`](docs/data-sources.md).

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
| Markets | Equity board: sector filter, rankings, 52-week range |
| Equity / DarvaX | Preserved live EMA/RSI + DarvaX scanner |

## Architecture

See [`docs/fno-architecture.md`](docs/fno-architecture.md) and [`docs/data-sources.md`](docs/data-sources.md).

Layers: **Providers → Normalize → Calculations → Service/Engines → API → UI**.

- **Dhan** (primary live): futures quotes + option chain + equity feed/Markets
- **NSE public** (secondary): indices / FII-DII cash
- **Mock / static-demo** (explicitly labeled): GitHub Pages & Vercel, or `FNO_FORCE_MOCK=1`
- **DEMO_MODE**: synthetic equity Markets quotes when Dhan creds are missing
- **Connection pill** + `/api/data-connections`: Dhan / NSE / WebSocket health without exposing tokens

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

### Vercel note

`vercel.json` deploys the **static `frontend/`** only (UI shell). The Express + SQLite + WebSocket backend is not serverless-compatible — run `npm start` (or your own Node host) for live API/feeds. Preview checks for linked Vercel projects should pass with this static config.

### Environment

| Variable | Purpose |
|----------|---------|
| `DHAN_CLIENT_ID` + `DHAN_ACCESS_TOKEN` | **Preferred** live path — paste access token from Dhan (no PIN/TOTP) |
| `DHAN_CLIENT_ID` + `DHAN_PIN` + `DHAN_TOTP_SECRET` | Alternate — auto-generate access tokens via TOTP |
| `DEMO_MODE=true` | Force synthetic Markets equity quotes |
| `FNO_FORCE_MOCK=1` | Force labeled mock F&O data (UI/dev) |
| `PORT` | Default 3000 |
| DarvaX / Telegram / Obsidian | Same as before (optional) |

**Server boots without Dhan** — terminal uses NSE public + labeled mock; Markets API falls back to demo quotes. Set `DHAN_*` in `.env` **or** enter them in **More → Dhan API** (optional write-back to `.env`).

Never commit `.env`. PIN / TOTP / access token are never returned by `GET /api/fno/credentials/dhan` (masked client id only).

## Key API routes

- `GET /api/fno/ticker` — NIFTY / BANKNIFTY / FINNIFTY / MIDCPNIFTY / INDIA VIX
- `GET /api/fno/overview` — regime + options snapshot
- `GET /api/fno/option-chain/:underlying?expiry=`
- `GET /api/fno/scanner` · `/buildups` · `/smart-money` · `/sectors`
- `GET /api/fno/fii-dii` · `/alerts` · `/watchlist`
- `GET /api/fno/opportunity` · `/opportunity/:symbol` — trade-readiness checklist
- `GET|PUT|DELETE /api/fno/credentials/dhan` · `POST …/test` — runtime Dhan API credentials
- `GET /api/dashboard` · `/dashboard/sectors` · `/dashboard/rankings` — equity Markets board
- `GET /api/auth/status` · `POST /api/auth/refresh` — Dhan token manager
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

DarvaX scan, Obsidian export, Telegram alerts, and manual-approval orders remain under **More → Legacy Desk**.

**Equity Markets:** **More → Equity Markets** (or `/?tab=markets`) — sector filters, rankings, and 52-week range via `/api/dashboard`.
