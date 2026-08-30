#!/usr/bin/env python3
"""
Fetch daily OHLCV from Firstock Connect API.

Setup:
  1. Generate API key: https://firstock.in/api/docs/login/
  2. Copy workshop/.env.example -> workshop/.env
  3. pip install -r workshop/requirements.txt

Usage:
  python workshop/fetch_nifty_firstock.py --totp 123456
  python workshop/fetch_nifty_firstock.py --instrument banknifty
"""

from __future__ import annotations

import argparse
import os
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import (  # noqa: E402
    INSTRUMENTS,
    add_fetch_args,
    candles_to_dataframe,
    load_workshop_env,
    output_path,
    parse_date,
    print_summary,
    require_env,
    save_csv,
)


def firstock_datetime(d: datetime) -> str:
    """Firstock day-interval format: HH:MM:SS DD-MM-YYYY"""
    return d.strftime("%H:%M:%S %d-%m-%Y")


def login_firstock(totp: str):
    from firstock import firstock

    response = firstock.login(
        userId=require_env("FIRSTOCK_USER_ID"),
        password=require_env("FIRSTOCK_PASSWORD"),
        TOTP=totp,
        vendorCode=require_env("FIRSTOCK_VENDOR_CODE"),
        apiKey=require_env("FIRSTOCK_API_KEY"),
    )
    if isinstance(response, dict) and response.get("stat") == "Not_Ok":
        raise SystemExit(f"Firstock login failed: {response}")
    return response


def call_time_price_series(user_id: str, exchange: str, trading_symbol: str, start: str, end: str):
    from firstock import firstock

    kwargs = dict(
        userId=user_id,
        exchange=exchange,
        tradingSymbol=trading_symbol,
        startTime=start,
        endTime=end,
        interval="1d",
    )

    for name in ("timePriceSeries", "TimePriceSeries", "DayIntervalTimePriceSeries"):
        fn = getattr(firstock, name, None)
        if callable(fn):
            return fn(**kwargs)

    raise SystemExit(
        "Firstock SDK has no timePriceSeries method. Upgrade: pip install -U firstock"
    )


def extract_candles(response) -> list:
    if response is None:
        return []

    if isinstance(response, list):
        return response

    if not isinstance(response, dict):
        return []

    for key in ("data", "candles", "timePriceSeries", "result"):
        value = response.get(key)
        if isinstance(value, list) and value:
            return value
        if isinstance(value, dict):
            nested = extract_candles(value)
            if nested:
                return nested

    rows = []
    for value in response.values():
        if isinstance(value, list) and value and isinstance(value[0], dict):
            rows.extend(value)
    return rows


def normalize_firstock_rows(raw_rows: list, trading_symbol: str) -> list:
    normalized = []
    for row in raw_rows:
        if not isinstance(row, dict):
            continue
        normalized.append(
            {
                "date": row.get("time")
                or row.get("date")
                or row.get("datetime")
                or row.get("timestamp"),
                "open": row.get("into") or row.get("open") or row.get("o"),
                "high": row.get("inth") or row.get("high") or row.get("h"),
                "low": row.get("intl") or row.get("low") or row.get("l"),
                "close": row.get("intc") or row.get("close") or row.get("c"),
                "volume": row.get("intv") or row.get("volume") or row.get("v") or 0,
            }
        )
    if not normalized:
        raise SystemExit(
            f"Could not parse Firstock candles for {trading_symbol}. "
            f"Raw sample: {raw_rows[:2]}"
        )
    return normalized


def main() -> int:
    load_workshop_env()
    parser = argparse.ArgumentParser(description="Fetch NSE index daily bars via Firstock")
    add_fetch_args(parser)
    parser.add_argument(
        "--totp",
        default=os.getenv("FIRSTOCK_TOTP", "").strip(),
        help="TOTP code (or set FIRSTOCK_TOTP in workshop/.env)",
    )
    args = parser.parse_args()

    if not args.totp:
        raise SystemExit("Provide --totp CODE or set FIRSTOCK_TOTP in workshop/.env")

    meta = INSTRUMENTS[args.instrument]
    user_id = require_env("FIRSTOCK_USER_ID")
    trading_symbol = meta["firstock"]

    login_firstock(args.totp)

    start_dt = datetime.combine(parse_date(args.range_from), datetime.min.time()).replace(
        hour=9, minute=15, second=0
    )
    end_dt = datetime.combine(parse_date(args.range_to), datetime.min.time()).replace(
        hour=15, minute=30, second=0
    )

    response = call_time_price_series(
        user_id=user_id,
        exchange="NSE",
        trading_symbol=trading_symbol,
        start=firstock_datetime(start_dt),
        end=firstock_datetime(end_dt),
    )

    raw = extract_candles(response)
    rows = normalize_firstock_rows(raw, trading_symbol)
    df = candles_to_dataframe(rows, source="firstock", symbol=trading_symbol)
    path = save_csv(df, output_path(args.instrument, "firstock", args.output))
    print_summary(df, path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
