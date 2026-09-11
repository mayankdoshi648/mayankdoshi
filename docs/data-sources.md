# Data sources — PowerBull Pro

Inspected availability (do not fabricate). Engines consume **normalized** envelopes only.

## Metric matrix

| METRIC | DHAN | NSE | PRIMARY | FALLBACK |
|--------|------|-----|---------|----------|
| Index LTP / % | marketfeed (optional) | `allIndices` | **NSE** | labeled mock |
| Futures LTP / OHLC / Volume / OI / VWAP | `marketfeed/quote` + futures security map | — | **Dhan** | labeled mock |
| Equity LTP (Nifty50 board / WS) | WS + EQ marketfeed | — | **Dhan** | demo quotes |
| Option chain / IV / expiries | `/v2/optionchain` | not implemented | **Dhan** | labeled mock |
| PCR / max pain / EM | derived from chain | — | Dhan chain | mock chain |
| OI change (futures) | session Δ vs prior poll (no exchange prev OI in quote) | — | Dhan-derived | `null` until 2nd poll |
| FII/DII cash | not provided | public FII/DII | **NSE** | `null` + reason |
| FII futures long/short | — | not in public endpoint used | — | always `null` |
| Market breadth | EQ daily candles | Yahoo / index lists | Dhan/Yahoo | disk cache |
| Sector (F&O strength) | aggregate live futures rows | — | Dhan futures | mock |
| Sector (overview board) | — | allIndices (+ Yahoo EMA) | **NSE** | — |
| 52-week H/L | historical EQ helper | — | EQ path | `null` on live FO quotes |
| Relative volume | — | — | — | usually `null` live (never invent) |

## Instrument IDs (do not mix)

| Type | Resolver | Segment |
|------|----------|---------|
| Cash equity | `instrumentMap.js` (scrip master EQ) | `NSE_EQ` |
| Index option underlying | `dhanProvider.UNDERLYINGS` | `IDX_I` / `BSE_I` |
| Stock/index futures | `futuresSecurityMap.js` front-month FUT | `NSE_FNO` |
| Option contracts | chain response security ids | per leg |

## Connection states (UI)

- `DHAN CONNECTED` — token accepted + recent successful Dhan call
- `NSE CONNECTED` — recent successful NSE public call
- `PARTIAL DATA` — one source up, or mock fallback on a slice
- `DATA ERROR` — auth/feed failure
- `MARKET CLOSED` — outside 09:30–15:30 IST (equity WS idle by design)

## Hosting

- GitHub Pages / Vercel = **static demo only**
- Permanent live URL = long-lived Node host (Render/Railway/Fly/VPS) running `npm start`
