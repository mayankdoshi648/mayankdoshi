# CAS & Expiry Intelligence

Standalone **analytics / research** terminal for NSE Closing Auction Session (CAS) and expiry behaviour on **NIFTY** and **BANK NIFTY**.

> This application does **not** place, modify, or cancel orders.
> It is intentionally independent of any other trading dashboard in the parent git repo.

## Principles

- Never fabricate missing market data — show `UNAVAILABLE`
- Max Pain is **one input**, not the settlement price
- Market direction and CAS settlement pressure are **independent** outputs
- SEBI proposal CAS modes are labeled **SIMULATION**
- Dhan credentials stay server-side (encrypted at rest)

## Stack

| Layer | Tech |
|-------|------|
| Web | React + Vite + Tailwind + PWA |
| API | Express + TypeScript + better-sqlite3 |
| Shared | Pure calc engines + `CAS_CONFIG` |
| Data | DhanHQ market-data APIs only |

## Mobile link (shareable)

| Host | Link | Mode |
|------|------|------|
| **GitHub Pages** | **https://mayankdoshi648.github.io/mayankdoshi/cas/** | Labeled **MOCK** static PWA (no Dhan secrets) |

Bookmark that URL on your phone. Live Dhan quotes still need the local/Node API (`npm run dev` below).

## Quick start

```bash
cd cas-expiry-intelligence
cp .env.example .env
npm install
npm run dev:api    # http://localhost:8787
npm run dev:web    # http://localhost:5173
```

Open **Settings**, paste Dhan Client ID + Access Token, then use the Terminal.

## Scripts

```bash
npm run typecheck
npm test
npm run build
```

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Phases delivered in this scaffold

1. Monorepo + CAS_CONFIG + secure settings + live analytics shell  
2. VWAP / reference VWAP / basis / alignment  
3. Option chain metrics (PCR, Max Pain, walls)  
4. CAS clock / signal lock / settlement zone / CAS intelligence / risk  
5. History + backtest **scaffolds** (no fabricated history)  
6. Mobile-first dark terminal UI + PWA manifest  

## Safety

No Dhan order APIs are imported or called. `TRADING_APIS_DISABLED = true` in the Dhan client module.
