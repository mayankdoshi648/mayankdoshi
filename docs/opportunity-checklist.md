# Opportunity Checklist / Trade Readiness

Additive decision-support layer on top of the existing F&O scanner + Smart Money Proxy.

**Not buy/sell advice.** `READY` means predefined confirmations passed — not guaranteed profit.

## APIs

- `GET /api/fno/opportunity?filter=&sort=&dir=&limit=`
- `GET /api/fno/opportunity/:symbol`

## Scoring (0–100)

| Component | Weight |
|-----------|--------|
| Market context | 10 |
| Sector | 10 |
| Price action | 10 |
| OI / futures | 15 |
| Volume | 10 |
| VWAP | 10 |
| Options | 15 |
| Smart Money proxy | 10 |
| Multi-timeframe | 5 |
| Risk / extension | 5 |

Missing inputs are marked **UNAVAILABLE** and excluded from the available-weight denominator (never fabricated as PASS).

Confidence is separate from Opportunity Score (completeness, pass/fail mix, SM confidence, conflicts, extension).

## Grades

A+ / A / B / WATCH / AVOID — A+ also requires low conflict and acceptable extension (not score alone).

## Data reused

- `getFoScanner()` rows (price%, OI%, RVOL, VWAP, buildup, smartMoney)
- Market regime + index ticker from overview
- Sector strength map
- FII cash / positioning regime (index context only)
- Optional index option snapshot for index symbols

## Unavailable today (shown honestly)

Multi-TF candles, ATR, EMA distance, opening range, VWAP slope, stock-level FII, futures basis, stock-level expected move (unless index chain context).

## UI

Primary nav **Opp** → table, top lists, watch list, heatmap, full checklist drawer with What to Wait For + Invalidation.

Theme: topbar Auto / Night / Light.
