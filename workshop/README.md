# Week 0 — Broker data fetch scripts

Python starters for the [Data Workshop curriculum](../docs/LEARNING_RESOURCES.md). Pull Nifty 50 / Bank Nifty daily OHLCV and save CSV under `workshop/data/`.

## Setup

```bash
cd workshop
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env               # fill broker credentials
```

## Scripts

| Script | Broker / source | Credentials |
|--------|-----------------|-------------|
| `fetch_nifty_yfinance.py` | Yahoo Finance (offline) | None |
| `fetch_nifty_fyers.py` | Fyers API v3 | `FYERS_*` in `.env` |
| `fetch_nifty_firstock.py` | Firstock Connect | `FIRSTOCK_*` + TOTP |
| `compare_sources.py` | Compare saved CSVs | Run fetch scripts first |

## Quick start (no broker account)

```bash
python fetch_nifty_yfinance.py
python fetch_nifty_yfinance.py --instrument banknifty --from 2024-01-01
```

Output: `data/nifty50_daily_yfinance.csv`

## Fyers

1. Create an app at https://myapi.fyers.in/dashboard/
2. Set `FYERS_CLIENT_ID`, `FYERS_SECRET_KEY`, `FYERS_REDIRECT_URI` in `.env`
3. Run:

```bash
python fetch_nifty_fyers.py
# Reuse token for the rest of the trading day:
# FYERS_ACCESS_TOKEN=... python fetch_nifty_fyers.py
```

Docs: https://myapi.fyers.in/docsv3

## Firstock

1. Generate API key at https://firstock.in/api/docs/login/
2. Set `FIRSTOCK_USER_ID`, `FIRSTOCK_PASSWORD`, `FIRSTOCK_VENDOR_CODE`, `FIRSTOCK_API_KEY`
3. Run with a fresh TOTP:

```bash
python fetch_nifty_firstock.py --totp 123456
```

Docs: https://firstock.in/api/docs/time-price-day-interval/

## Compare sources

After fetching from two or more sources:

```bash
python compare_sources.py
python compare_sources.py --instrument banknifty
```

## CLI options (all fetch scripts)

```
--instrument {nifty,banknifty}   default: nifty
--from YYYY-MM-DD                default: 1 year ago
--to YYYY-MM-DD                  default: today
--out path/to/file.csv           optional custom output
```

## Symbol mapping

| CLI | Fyers | Firstock | yfinance |
|-----|-------|----------|----------|
| `nifty` | `NSE:NIFTY50-INDEX` | `Nifty 50` | `^NSEI` |
| `banknifty` | `NSE:NIFTYBANK-INDEX` | `Nifty Bank` | `^NSEBANK` |

## Week 0 deliverable

- [ ] `data/nifty50_daily_yfinance.csv` (always)
- [ ] `data/nifty50_daily_fyers.csv` (after Fyers onboarding)
- [ ] `data/nifty50_daily_firstock.csv` (after Firstock onboarding)
- [ ] `compare_sources.py` shows mean close diff < 1 point on overlapping dates

Next: Day 1 notebooks in [LEARNING_RESOURCES.md](../docs/LEARNING_RESOURCES.md).
