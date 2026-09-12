# NSE F&O Intelligence Terminal (+ PowerBull / DarvaX)

Professional **mobile-first Indian NSE F&O market intelligence terminal**, built on the existing PowerBull Pro + DarvaX equity stack.

## Live demo (shareable · mobile)

| Host | Link | Mode |
|------|------|------|
| **Cloudflare Workers (preferred · free · live Dhan)** | Add GH secrets + run workflow — see [`docs/cloudflare-deploy.md`](docs/cloudflare-deploy.md) → `https://mayankdoshi.<subdomain>.workers.dev` | **Live F&O** — enter Client ID + Access Token in **More → Dhan API** |
| **GitHub Pages** | **https://mayankdoshi648.github.io/mayankdoshi/** | Labeled **MOCK** static UI (cannot hold Dhan secrets) |
| Vercel | https://mayankdoshi.vercel.app | Labeled **MOCK** static UI (cannot hold Dhan secrets) |
| Render blueprint | `render.yaml` (optional / paid) | Full Node + SQLite + equity WS |

Static hosts (GitHub Pages / Vercel) cannot store Dhan secrets. For a **bookmarkable permanent HTTPS URL** on phone + laptop **without Render**:

1. Follow **[`docs/cloudflare-deploy.md`](docs/cloudflare-deploy.md)**
2. Set secrets: `SESSION_SECRET`, optional `DHAN_CLIENT_ID` + `DHAN_ACCESS_TOKEN`
3. Share `https://mayankdoshi.<subdomain>.workers.dev` — **never put the access token in the URL**

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
| Dhan API | Client ID + Access token → live option chain (CF + Node); PIN/TOTP Node-only |
| WHY drawer | Explainable positioning checklist |
| Markets | Equity board (live on Node; demo on Cloudflare free) |
| Equity / DarvaX | Preserved on Node (`npm start`) |

## Architecture

See [`docs/fno-architecture.md`](docs/fno-architecture.md), [`docs/data-sources.md`](docs/data-sources.md), and [`docs/cloudflare-deploy.md`](docs/cloudflare-deploy.md).

Layers: **Providers → Normalize → Calculations → Service/Engines → API → UI**.

- **Dhan** (primary live): futures quotes + option chain (+ equity feed on Node)
- **NSE public** (secondary): indices / FII-DII via `nseDataService` / HybridProvider
- **Instrument mapping**: `backend/fno/instrumentMapping.js` + futures security map
- **Mock / static-demo** (explicitly labeled): GitHub Pages & Vercel, or `FNO_FORCE_MOCK=1`
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

### Cloudflare (free permanent URL)

```bash
npm run build:cloudflare
# then connect the repo in Cloudflare Pages — see docs/cloudflare-deploy.md
```

### Environment

| Variable | Purpose |
|----------|---------|
| `DHAN_CLIENT_ID` + `DHAN_ACCESS_TOKEN` | **Preferred** live path |
| `DHAN_CLIENT_ID` + `DHAN_PIN` + `DHAN_TOTP_SECRET` | Alternate on **Node only** |
| `SESSION_SECRET` | Encrypt credential cookies (required on Cloudflare) |
| `DEMO_MODE=true` | Force synthetic Markets equity quotes |
| `FNO_FORCE_MOCK=1` | Force labeled mock F&O data (UI/dev) |
| `PORT` | Default 3000 (Node) |

Never commit `.env`. Access tokens are never returned by `GET /api/fno/credentials/dhan`.

## Key API routes

- `GET /api/fno/ticker` — NIFTY / BANKNIFTY / FINNIFTY / MIDCPNIFTY / INDIA VIX
- `GET /api/fno/overview` — regime + options snapshot
- `GET /api/fno/option-chain/:underlying?expiry=`
- `GET /api/fno/scanner` · `/buildups` · `/smart-money` · `/sectors`
- `GET /api/fno/fii-dii` · `/alerts` · `/watchlist`
- `GET /api/fno/opportunity` · `/opportunity/:symbol`
- `GET /api/fno/instruments/resolve?symbol=&kind=` — centralized security-id mapping
- `GET|PUT|DELETE /api/fno/credentials/dhan` · `POST …/test`
- `GET /api/health` — Cloudflare/runtime probe
- `GET /api/dashboard` — equity Markets board
- Existing Node-only: `/api/signals`, `/api/darvax/*`, `/live`


**Daily Loop productivity pack:** paste-ready vault templates and the 15-workflow guide live in [`docs/obsidian-workflows/`](docs/obsidian-workflows/README.md). With the dashboard running, open the visual guide at [http://localhost:3000/obsidian-workflows.html](http://localhost:3000/obsidian-workflows.html).

## Market Breadth dashboard

Open **Market Breadth** in the app (More → Market Breadth, or `?tab=breadth`) to see:

- % of Nifty 50 / Nifty 500 stocks above 20 / 50 / 200 DMA
- Index vs breadth line charts (divergence view)
- Spirit-level gauges + posture diagnosis (STOP PRESSING / REDUCE RISK / SIT OUT / GREEN LIGHT)
- Headline indices + size/sector EMA strip

Data sources: **Yahoo Finance** (default, no keys) using the NSE Nifty 50/500 universe. If Dhan credentials are set, NSE EOD history is preferred automatically.

First refresh for Nifty 50 takes ~1–2 minutes; results cache for 6 hours under `data/breadth-cache.json`.

Node-only helpers: `/api/overview`, `/api/breadth`, `/api/breadth/status`, `POST /api/breadth/refresh`.


## Safety

- No naked BUY/SELL — interpretations always show evidence metrics
- Smart Money is a **PROXY**, not institutional identification
- Missing / unavailable fields stay `null` — never fabricated as live
- Mock responses always set `meta.isMock: true` and UI banner
- Shareable URL identifies the **app**, never the Dhan token

## Workshop learning resources

Curated study plan, GitHub repos, PDFs, and week-by-week notebook schedule for the Data Workshop & Algo Trading curriculum:

- [docs/LEARNING_RESOURCES.md](docs/LEARNING_RESOURCES.md) — full curriculum map
- [workshop/](workshop/) — Week 0 Python scripts (Fyers / Firstock / yfinance Nifty fetch)

