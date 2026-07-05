# PowerBull Pro — Design Spec

## Purpose

Local intraday stock-signal dashboard modeled on powerbullstocks.com (a SEBI-RA
site currently in "launching soon" state showing live buy/sell signal counts).
This project replicates the visual layout and adds real functioning signal
generation on live Nifty 50 data via the Dhan API (DhanHQ v2), running locally.

**Legal note:** "Power Bull" name/logo is a registered trademark of the real
site's SEBI-registered operator. This build is for personal/local use only —
not to be published or hosted publicly. Dashboard must carry a disclaimer:
not real investment advice, personal experiment only, no order execution.

## Architecture

Two pieces in one repo:

- `backend/` — Node.js + Express + `ws`. Owns the Dhan live market feed
  connection, candle aggregation, signal engine, SQLite persistence,
  and a REST + WebSocket API for the frontend.
- `frontend/` — single dashboard (HTML/CSS/JS, dark theme, Chart.js),
  visually close to the real site's layout. Talks to backend only over
  localhost REST/WS. No build step — plain static files served by Express.

## Dhan Integration

- Auth is a manually-generated 24-hour access token: log into
  web.dhan.co → "Access DhanHQ APIs" → generate token, copy `dhanClientId`
  and the token into `.env` (`DHAN_CLIENT_ID`, `DHAN_ACCESS_TOKEN`). No
  OAuth redirect flow — this is a personal/single-user app, so the
  simplest of Dhan's three auth methods applies. The token expires every
  ~24 hours; the dashboard surfaces a "Reconnect: regenerate your Dhan
  token" banner whenever the live feed is disconnected, since Dhan itself
  reports token expiry as a WebSocket disconnect (reason code 807), not
  as a separate validity check.
- Live prices via Dhan's v2 market feed WebSocket
  (`wss://api-feed.dhan.co?version=2&token=...&clientId=...&authType=2`
  — auth is via query params, no separate handshake message), subscribed
  in **Quote mode** (`RequestCode: 17`) for all Nifty 50 instruments —
  Quote mode carries last-traded-price *and* last-traded-quantity, which
  Ticker mode (`RequestCode: 15`) omits and this app's candle aggregator
  needs. Responses are fixed-width binary packets (documented byte
  offsets, little-endian) — no protobuf, decoded directly with Node's
  `Buffer` reads.
- Instrument identifiers (`SecurityId` per `ExchangeSegment`) are
  resolved at startup by joining NSE's live Nifty 50 constituent list
  against Dhan's published scrip master CSV
  (`https://images.dhan.co/api-data/api-scrip-master.csv`) on trading
  symbol — never hardcoded, since both the index membership and Dhan's
  internal IDs can change over time.

## Candle Aggregation

- Server buckets incoming ticks into 5-minute OHLCV candles per symbol,
  in-memory, only while `9:30 <= now <= 15:30 IST`.
- Outside that window the dashboard shows a "Market closed" state and
  displays the last completed trading day's data (read from SQLite).
- Each symbol keeps a rolling buffer of candles for the current day
  (enough for EMA21/RSI14/VWAP calc — needs ≥21 candles before first
  signal; candles before that are buffered silently, no signal emitted).

## Signal Engine

Runs once per symbol on every completed 5-min candle. Weighted score:

| Condition | Score |
|---|---|
| EMA9 crosses above EMA21 | +1 |
| EMA9 crosses below EMA21 | −1 |
| RSI14 < 30 (oversold) | +1 |
| RSI14 > 70 (overbought) | −1 |
| Close > session VWAP | +1 |
| Close < session VWAP | −1 |
| Candle volume > 1.5× rolling 20-candle avg volume | ×1.5 multiplier on the sum above |

Final score ≥ +2 → **BUY**, ≤ −2 → **SELL**, else **NEUTRAL**. Only
BUY/SELL are logged as signals (NEUTRAL is not persisted, just internal
state).

## Persistence & Track Record

- SQLite via Node's built-in `node:sqlite` (`DatabaseSync`), one file
  `data/signals.db` — no native build dependency.
- Table `signals`: id, symbol, side (BUY/SELL), price, candle_time, score.
- Outcome tracking: fixed target/stoploss from signal price — **+0.5%
  target / −0.3% stoploss**. Every subsequent candle for that symbol is
  checked until target/SL is hit or the trading day ends; outcome stored
  as `HIT_TARGET | HIT_SL | OPEN | EOD_CLOSE`.
- Historical days browsable via a date picker (`GET /api/signals?date=`).

## REST + WebSocket API (backend)

- `GET /api/status` — market open/closed, Dhan feed connected y/n, capture window.
- `GET /api/signals?date=YYYY-MM-DD` — signal log for a given day.
- `GET /api/candles/:symbol?date=` — candle history for chart view.
- `WS /live` — pushes `{type: "signal"|"candle", ...}` events to the
  frontend as they happen, for the live counters and chart updates.

## Frontend Dashboard

- Header: lightning branding, "ROI Calculator" / "Track Record" nav
  (placeholders or simple static calc), dark theme.
- Live counters: Total / Buy / Sell / Neutral signal counts, updating
  over the WS connection.
- Stock table: symbol, LTP, current signal, last signal time — click a
  row to open a modal with a 5-min candlestick chart (Chart.js +
  chartjs-chart-financial) with BUY/SELL markers plotted at fire time/price.
- Track Record tab: table of all signals for the selected date with
  entry price/time and computed outcome.
- Alerts: short beep (`<audio>`) + browser `Notification` API popup on
  every new BUY/SELL signal (requires notification permission grant).
- Date picker to browse past days (reads from `/api/signals`).

## Error Handling

- WebSocket disconnects: auto-reconnect with exponential backoff (1s →
  30s cap).
- Access token expired (Dhan disconnects the feed with reason code 807)
  or feed otherwise disconnected: `/api/status` reports it, frontend
  shows a persistent "Reconnect: regenerate your Dhan token in .env and
  restart the server" banner; live ingestion pauses until the feed
  reconnects with a valid token.
- Missing SecurityId mapping for a symbol: skip that symbol, log a
  warning, don't crash the ingestion loop.
- Insufficient candle history (<21) for a symbol: skip signal calc for
  that symbol only, resume once buffer fills.

## Testing

Live market hours can't be relied on for repeatable tests, so:

- Unit tests for indicator math (EMA, RSI, VWAP, volume-spike) and the
  scoring function, driven by recorded sample candle fixtures
  (`test/fixtures/*.json`) — deterministic, run anytime.
- Manual smoke test during actual market hours (9:30–15:30 IST) before
  calling the feature done: confirm the Dhan feed connects with a fresh
  token, live candle ingestion works, at least one real signal fires and
  appears on the dashboard + gets persisted to SQLite.

## Out of Scope (v1)

- Order placement/execution (site explicitly has none either).
- Multi-user accounts / auth beyond the single Dhan token in `.env`.
- Deployment/hosting beyond local machine.
- Stocks outside Nifty 50.
