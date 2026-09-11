# F&O Trading Intelligence Terminal — Architecture

## Current system (inspected)

| Layer | What exists | Status |
|-------|-------------|--------|
| Live equity feed | Dhan WS quote → candle aggregator → EMA/RSI signal engine | Working (Nifty 50 EQ) |
| DarvaX scanner | Box/Wyckoff strength score, NSE+US universes, Obsidian, Telegram | Working |
| Orders | Manual-approval Dhan CNC limit orders | Working |
| Persistence | SQLite: signals, darvax_scans, darvax_orders | Working |
| UI | Vanilla JS dark dashboard, 3 tabs | Working, not mobile-first |
| Auth | Dhan TOTP → access token via env (`DHAN_*`) | Secure (no hardcoding) |
| Breadth/Overview | Built on branch `cursor/market-breadth-dashboard-b028` | Imported as foundation |

**Gaps vs F&O terminal:** no option chain, OI classification, PCR/max pain/expected move, F&O scanners, FII/DII, smart-money proxy, alerts framework, watchlist, mobile bottom nav, provider abstraction.

## Proposed architecture

```
┌─────────────────────────────────────────────────────────────┐
│ UI (frontend) — presentational only                         │
│  Market Overview · F&O Intel · Option Chain · Scanners …    │
└──────────────────────────▲──────────────────────────────────┘
                           │ REST JSON (+ existing /live WS)
┌──────────────────────────┴──────────────────────────────────┐
│ API layer (Express) — /api/fno/*, /api/overview, /api/breadth│
│  caching · rate-limit awareness · stale/error envelopes     │
└──────────────────────────▲──────────────────────────────────┘
                           │
┌──────────────────────────┴──────────────────────────────────┐
│ Engines — compose normalized data + pure calculations       │
│  marketRegime · foScanner · optionChain · smartMoney        │
│  sectorIntel · fiiDii · alerts · watchlist                  │
└──────────────────────────▲──────────────────────────────────┘
                           │
┌──────────────────────────┴──────────────────────────────────┐
│ Calculations (pure, unit-tested)                            │
│  OI buildup · PCR · max pain · expected move · scores       │
└──────────────────────────▲──────────────────────────────────┘
                           │
┌──────────────────────────┴──────────────────────────────────┐
│ Normalization — canonical Quote / Chain / Futures shapes    │
└──────────────────────────▲──────────────────────────────────┘
                           │
┌──────────────────────────┴──────────────────────────────────┐
│ Providers (swappable)                                       │
│  DhanProvider · NsePublicProvider · MockProvider (labeled)  │
│  (future: FyersProvider)                                    │
└─────────────────────────────────────────────────────────────┘
```

## Data sources

| Data | Primary | Fallback | Notes |
|------|---------|----------|-------|
| Index quotes (NIFTY, BN, VIX, sectors) | NSE public `allIndices` | Mock (labeled) | No credentials |
| Market breadth | Yahoo/Dhan daily candles | Cache | Existing module |
| Option chain / IV / OI | Dhan `/v2/optionchain` | Mock (labeled) | 1 req / 3s |
| Futures quotes + OI | Dhan `/v2/marketfeed/quote` | Mock | Needs FNO security IDs |
| FII/DII | NSE public FII/DII APIs | Unavailable → explicit null | Never fabricate |
| Equity CMP for scanners | Dhan quote / Yahoo | Mock | |

## Assumptions (documented)

1. **Dhan optional for boot:** Terminal serves NSE overview without Dhan; F&O chain/scanners use labeled mock when `DHAN_*` missing.
2. **Smart Money = PROXY only:** UI and API explicitly say “proxy based on market behaviour”, not institutional identification.
3. **FII futures long/short:** If NSE does not expose futures positioning in the public endpoint used, fields remain `null` with reason — never inferred.
4. **Timezone:** All market-open logic remains IST (`marketWindow.js`); timestamps shown as ISO + IST label.
5. **Preserve existing tabs:** Live Signals, DarvaX, Track Record remain functional under “Legacy / Equity” nav group.
6. **SENSEX:** Included when BSE index data available via NSE/provider; otherwise marked unsupported for that session.

## Canonical models (normalized)

- `MarketQuote`: symbol, segment, ltp, change, changePct, open, high, low, prevClose, volume, vwap, oi, oiChange, iv, timestamp, source, stale
- `OptionStrike`: strike, call{}, put{} (oi, oiChange, volume, iv, ltp, change, bid, ask, greeks?)
- `OptionChainSnapshot`: underlying, expiry, spot, strikes[], atm, metrics{}, interpretation{}, asOf, source
- `FoInstrumentSignal`: symbol, sector, pricePct, oiPct, volume, rvol, vwapRelation, iv, buildup, score, why[]
- `RegimeReport`: label, score 0–100, confidence, factors[]
- `DataEnvelope`: `{ data, meta: { asOf, source, isMock, stale, error? } }`

## Security

- Credentials only via `.env` / `config.js` — never in frontend.
- Access tokens stay server-side; frontend calls `/api/*` only.
- Mock provider never claims to be live.