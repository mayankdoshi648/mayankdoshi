# CAS & Expiry Intelligence — Architecture

**Standalone application.** This monorepo does not import or depend on any other trading dashboard in the parent repository.

## Purpose

Analytics and research terminal for NSE Closing Auction Session (CAS), expiry behaviour, futures basis, and option-chain positioning.

**No order placement / modification / cancellation.**

Two independent outputs:

| Engine | Question | Example states |
|--------|----------|----------------|
| Market Direction | What is the underlying likely to do? | TREND UP, RANGE/PIN, NO EDGE |
| CAS / Settlement | Settlement-price pressure around close? | UPWARD SETTLEMENT PRESSURE, PINNING/MAGNET |

## Folder structure

```
cas-expiry-intelligence/
├── apps/
│   ├── api/                 # Express + TypeScript backend
│   │   └── src/
│   │       ├── config/      # CAS_CONFIG, SIGNAL_CONFIG, etc.
│   │       ├── db/          # SQLite schema + repository
│   │       ├── engines/     # Settlement, Market State, CAS, Risk, Signals
│   │       ├── routes/      # REST API
│   │       ├── services/    # Dhan client, cache, alignment, NSE helpers
│   │       └── middleware/
│   └── web/                 # React + Vite + Tailwind PWA
│       └── src/
│           ├── components/
│           ├── pages/
│           ├── hooks/
│           └── lib/
├── packages/
│   └── shared/              # Shared types + pure calc utils + configs
├── data/                    # SQLite database files
└── docs/
```

## Data flow

```
DhanHQ (quotes, OHLC, history, option chain, WS)
        │
        ▼
  Rate-limited client + cache + retry
        │
        ▼
  Timestamp Alignment Layer
        │
        ├──► Market Snapshot store (SQLite)
        ├──► Option Chain Snapshot store
        │
        ▼
  Engines (deterministic, configurable weights)
        │
        ├── Market State Engine
        ├── Settlement Zone Engine
        ├── CAS Intelligence Score
        ├── Signal Score (locked during CAS)
        └── CAS Risk Engine
        │
        ▼
  REST API  ──►  React Terminal UI
```

## Security model

- Dhan Client ID + Access Token entered in Settings UI only.
- Credentials encrypted at rest (AES-256-GCM) with `CREDENTIAL_SECRET`.
- Credentials never returned to the frontend in plaintext after save.
- No Dhan order / trade / position-modify endpoints are called.
- Backend only uses market-data APIs.

## CAS configuration model

All timings live in `CAS_CONFIG` (see `packages/shared/src/casConfig.ts`).

Modes:

1. **CURRENT_NSE** (default) — live regulatory reference timings
2. **SEBI_PROPOSAL_A** — simulation only
3. **SEBI_PROPOSAL_B** — simulation only

UI always labels non-default modes as **SIMULATION**.

## Database (SQLite → PostgreSQL-ready)

Tables: `settings`, `market_snapshots`, `option_chain_snapshots`, `cas_data`, `expiry_dates`, `backtest_runs`, `backtest_results`, `signal_events`.

Timestamps stored in UTC; UI converts to IST.

## API design (Phase 1+)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/health` | Service health |
| GET/PUT | `/api/settings/dhan` | Credential management |
| DELETE | `/api/settings/dhan` | Clear credentials |
| GET | `/api/instruments` | Supported underlyings |
| GET | `/api/instruments/:id/expiries` | Expiry list |
| GET | `/api/market/:id` | Spot + futures + health |
| GET | `/api/analytics/:id` | Full analytics bundle |
| GET | `/api/option-chain/:id` | Option chain slice |
| GET | `/api/cas/timeline` | Current CAS phase |
| GET | `/api/cas/history` | Historical CAS rows |
| GET | `/api/backtest` | Backtest results |

## Implementation phases

See README. Phase 1 = connection + shell + live spot/futures. Subsequent phases add engines, history, backtest, PWA polish.

## Quality principles

- Never fabricate missing data → show `UNAVAILABLE`
- Never treat Max Pain as settlement price
- Never conflate market direction with CAS settlement pressure
- Never present SEBI proposals as live NSE rules
- Never execute trades
