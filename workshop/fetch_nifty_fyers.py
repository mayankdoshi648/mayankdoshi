#!/usr/bin/env python3
"""
Fetch daily OHLCV from Fyers API v3.

Setup:
  1. Create app: https://myapi.fyers.in/dashboard/
  2. Copy workshop/.env.example -> workshop/.env
  3. pip install -r workshop/requirements.txt

Usage:
  python workshop/fetch_nifty_fyers.py
  python workshop/fetch_nifty_fyers.py --instrument banknifty --from 2024-01-01
  FYERS_ACCESS_TOKEN=... python workshop/fetch_nifty_fyers.py   # skip OAuth
"""

from __future__ import annotations

import argparse
import os
import sys
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


def get_fyers_client():
    from fyers_apiv3 import fyersModel

    client_id = require_env("FYERS_CLIENT_ID")
    access_token = os.getenv("FYERS_ACCESS_TOKEN", "").strip()

    if not access_token:
        secret_key = require_env("FYERS_SECRET_KEY")
        redirect_uri = require_env("FYERS_REDIRECT_URI")
        session = fyersModel.SessionModel(
            client_id=client_id,
            secret_key=secret_key,
            redirect_uri=redirect_uri,
            response_type="code",
            grant_type="authorization_code",
        )
        auth_url = session.generate_authcode()
        print("Open this URL in a browser, log in, and copy the auth_code from the redirect URL:")
        print(auth_url)
        auth_code = input("auth_code: ").strip()
        if not auth_code:
            raise SystemExit("auth_code is required when FYERS_ACCESS_TOKEN is not set.")
        session.set_token(auth_code)
        token_response = session.generate_token()
        if token_response.get("s") != "ok":
            raise SystemExit(f"Fyers token error: {token_response}")
        access_token = token_response["access_token"]
        print("Access token obtained. Set FYERS_ACCESS_TOKEN in workshop/.env for reuse today.")

    return fyersModel.FyersModel(
        client_id=client_id,
        token=access_token,
        is_async=False,
        log_path="",
    )


def fetch_history(fyers, symbol: str, range_from: str, range_to: str) -> list:
    payload = {
        "symbol": symbol,
        "resolution": "D",
        "date_format": "1",
        "range_from": range_from,
        "range_to": range_to,
        "cont_flag": "1",
    }
    response = fyers.history(data=payload)
    if not isinstance(response, dict):
        raise SystemExit(f"Unexpected Fyers response type: {type(response)}")

    if response.get("s") != "ok":
        raise SystemExit(f"Fyers history error: {response}")

    candles = response.get("candles") or []
    if not candles:
        raise SystemExit(
            f"No candles for {symbol} ({range_from} .. {range_to}). "
            "Check symbol, date range, and token expiry (tokens expire end of trading day)."
        )
    return candles


def main() -> int:
    load_workshop_env()
    parser = argparse.ArgumentParser(description="Fetch NSE index daily bars via Fyers")
    add_fetch_args(parser)
    args = parser.parse_args()

    meta = INSTRUMENTS[args.instrument]
    symbol = meta["fyers"]
    range_from = parse_date(args.range_from).isoformat()
    range_to = parse_date(args.range_to).isoformat()

    fyers = get_fyers_client()
    candles = fetch_history(fyers, symbol, range_from, range_to)
    df = candles_to_dataframe(candles, source="fyers", symbol=symbol)
    path = save_csv(df, output_path(args.instrument, "fyers", args.output))
    print_summary(df, path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
