# XAUUSD Renko + Supertrend EA (XM Global MT5)

An MQL5 Expert Advisor that automates a Renko + Supertrend strategy on
**XAUUSD** for **XM Global MetaTrader 5**.

MT5 has no native Renko chart type, so the EA builds Renko bricks
internally from live ticks (and from M1 history on startup) and computes
Supertrend on that brick series. The bricks, the Supertrend line, the
suggested-entry level and the live stop-loss level are all drawn on the
chart the EA is attached to.

## Strategy rules (as implemented)

- **Renko**: box size **$1** (input `InpBoxSize`). A reversal brick
  requires price to travel 2 boxes, classic Renko behaviour.
- **Supertrend (7, 3.1)** (`InpAtrPeriod`, `InpAtrMultiplier`) computed
  on the Renko bricks with Wilder's ATR.
- **Buy signal**: Supertrend flips green — i.e. a Renko brick closes
  above the line. The suggested entry is that brick's close.
  **Sell signal** is the mirror.
- **Entry slippage guard** (`InpMaxSlippage`, default **$1**): the trade
  is only taken while price is within $1 of the suggested entry. If the
  entry is missed (price ran away), the level stays **armed**: when
  price comes back to it, the trade triggers — as long as the
  Supertrend direction hasn't flipped in the meantime.
- **Exits / stop loss**:
  - Supertrend flip against the position closes it immediately.
  - Hard initial SL: **$6** from entry (`InpMaxStopLoss`).
  - Break-even: at **+$3** profit (`InpBreakevenMove`) the SL moves to
    the entry price.
  - Step trailing: after break-even, every further **+$2** move
    (`InpTrailStep`) lifts the SL by **$1** (`InpTrailAmount`).
    Example for a long from 2400.00: at 2403 SL → 2400.00, at 2405
    SL → 2401.00, at 2407 SL → 2402.00, and so on.

One position at a time; every rule above is an input so the numbers can
be changed later without touching code.

## Installation on XM Global MT5

1. Open MT5 → **File → Open Data Folder** → `MQL5/Experts/` and copy
   `XAUUSD_RenkoSupertrend_EA.mq5` there.
2. In MetaEditor (F4) open the file and **Compile** (F7) — it should
   compile with 0 errors.
3. In MT5 enable **Tools → Options → Expert Advisors → Allow algorithmic
   trading** (and the *Algo Trading* toolbar button).
4. Open an **XAUUSD** chart. Timeframe **M1** (the EA warms up from M1
   history; the Renko logic itself is tick-driven, so the chart
   timeframe does not change the strategy).
5. Drag the EA onto the chart, review the inputs, tick *Allow Algo
   Trading*, and click OK.
6. Optional, for a cleaner Renko view: right-click the chart →
   Properties → set candles/bars to "Line chart" with the line colour
   equal to the background, so only the drawn Renko bricks are visible.

## Inputs

| Group | Input | Default | Meaning |
|---|---|---|---|
| Renko | `InpBoxSize` | 1.0 | Renko box size in dollars |
| Renko | `InpWarmupM1Bars` | 3000 | M1 bars replayed at startup to seed Renko + Supertrend |
| Supertrend | `InpAtrPeriod` | 7 | ATR period |
| Supertrend | `InpAtrMultiplier` | 3.1 | ATR multiplier |
| Trading | `InpLots` | 0.01 | Order volume |
| Trading | `InpMaxSlippage` | 1.0 | Max distance ($) from suggested entry at which the trade may fill |
| Trading | `InpMaxStopLoss` | 6.0 | Initial hard SL distance ($) |
| Trading | `InpBreakevenMove` | 3.0 | Profit ($) that moves SL to entry |
| Trading | `InpTrailStep` | 2.0 | Extra profit ($) per trailing step |
| Trading | `InpTrailAmount` | 1.0 | SL improvement ($) per trailing step |
| Trading | `InpMagic` | 20260718 | Magic number identifying this EA's trades |
| Display | `InpDrawBricks` / `InpDrawSupertrend` | true | Toggle chart drawings |
| Display | `InpMaxBricksDrawn` | 300 | How many bricks/line segments stay on the chart |

## Backtesting

Use the MT5 Strategy Tester with model **"Every tick based on real
ticks"** — Renko brick formation depends on the tick path, so bar-based
models will give misleading results. Symbol XAUUSD, any chart timeframe.

## Notes and caveats

- The entry watcher is internal (no broker pending orders), so the EA
  must stay running — use a VPS or keep the terminal open. After a
  restart the EA rebuilds bricks from M1 history and re-arms the most
  recent signal's entry level if it is still flat.
- Because warmup uses M1 *closes* while live operation uses every tick,
  brick alignment immediately after a restart can differ slightly from
  an uninterrupted session.
- XAUUSD quotes differ between brokers (and XM account types differ in
  spread); the $ distances here are absolute price distances, so a
  ~$0.20–0.35 spread on gold is significant for a $1 box — verify
  behaviour on a demo account first.
- This is provided for your own trading experimentation. It is not
  financial advice; test on demo before risking real funds.
