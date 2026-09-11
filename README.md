# NSE F&O Intelligence Terminal (+ PowerBull / DarvaX)

Professional **mobile-first Indian NSE F&O market intelligence terminal**, built on the existing PowerBull Pro + DarvaX equity stack.

## What you get

| Section | Purpose |
|---------|---------|
| Market Overview | Index ticker, explainable Market Regime score 0–100 |
| F&O Intelligence | Long/short buildup & covering scanners with transparent scores |
| Option Chain | ATM-aware chain, PCR, max pain, expected move + evidence panel |
| OI Analysis | Call/Put OI walls visualization |
| Smart Money Proxy | Behavioural proxy scores with mandatory WHY + disclaimer |
| Sector / Stock Scanner | Sector strength + F&O stock ranking/filters |
| FII/DII | Cash positioning (futures long/short left null when unavailable) |
| Alerts / Watchlist | Configurable thresholds; channel hooks prepared |
| Equity / DarvaX | Preserved live EMA/RSI signals + DarvaX scanner/orders |

## Architecture

See [`docs/fno-architecture.md`](docs/fno-architecture.md).

Layers: **Providers → Normalize → Calculations → Service/Engines → API → UI**.

- **Dhan** (optional): option chain + equity live feed
- **NSE public**: indices / FII-DII cash when reachable
- **Mock** (explicitly labeled): UI/dev when credentials or live calls unavailable

## Setup

```bash
git clone https://github.com/mayankdoshi648/mayankdoshi.git
cd mayankdoshi
git checkout cursor/fo-trading-terminal-368a   # or master after merge
npm install
cp .env.example .env
npm test
npm start
```

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

**Server boots without Dhan** — terminal uses NSE public + labeled mock. Set `DHAN_*` for live option chains.

Never commit `.env`. Credentials stay server-side only.

## Key API routes

- `GET /api/fno/ticker` — NIFTY / BANKNIFTY / FINNIFTY / MIDCPNIFTY / INDIA VIX
- `GET /api/fno/overview` — regime + options snapshot
- `GET /api/fno/option-chain/:underlying?expiry=`
- `GET /api/fno/scanner` · `/buildups` · `/smart-money` · `/sectors`
- `GET /api/fno/fii-dii` · `/alerts` · `/watchlist`
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
