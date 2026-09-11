# Smart Money Proxy — Integration

## Architecture

Additive layer on the existing F&O terminal. No new market-data fetches.

| Need | Source |
|------|--------|
| Price / OI / RVol / VWAP / IV / PCR | `getFoScanner()` futures rows |
| Buildup class | `classifyBuildup` / `explainBuildup` |
| Sector strength | derived from scanner rows (`_sectorStatsFromRows`) |
| FII cash / futures | `getFiiDii()` (index-level only) |
| Option PCR / IV | scanner fields; chain for indices when present |
| Alerts / watchlist | existing engines + Smart Money rules |

## Scoring (−100…+100)

| Component | Cap | Role |
|-----------|-----|------|
| Price + OI | 30 | Buildup proxy (long/short buildup, covering, unwinding) scaled by magnitude |
| Volume | 15 | Relative volume confirmation (spike-capped) |
| VWAP | 15 | Price vs VWAP + slope confirmation |
| Options | 15 | PCR + call/put OI change **with** price context (never PCR alone) |
| Sector | 10 | Aligns / dampens; does not override stock signal |
| FII | 10 | Index only; missing → score 0, lower confidence |
| Momentum | 5 | Multi-TF persistence when available |

## Confidence (0…100) — independent of score magnitude

- Completeness of components (weighted)
- Confirming indicator count
- Conflict penalties
- Extreme RVol noise penalty
- Market-closed soft penalty
- Multi-TF alignment bonus

## APIs

- `GET /api/fno/smart-money?limit=N` — market strip, rankings, indices, rows
- `GET /api/fno/smart-money/:symbol` — explainable detail panel
- `GET /api/fno/smart-money/:symbol/history?range=1D|5D|10D|1M` — in-memory history

## Safeguards

- Explicit proxy disclaimer on every payload / UI surface
- Never fabricates FII or options data
- Does not emit BUY/SELL recommendations
- Conflicting signals reduce confidence and are surfaced

## Tests

`backend/fno/calculations/smartMoney.test.js` — classification, caps, RVol, VWAP, PCR/options, sector, FII, confidence, conflicts, multi-TF, rankings, alerts, missing data, extreme volume, market closed.
