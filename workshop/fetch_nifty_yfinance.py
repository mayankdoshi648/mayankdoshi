#!/usr/bin/env python3
"""
Offline fallback: fetch NSE index daily bars via Yahoo Finance (no broker account).

Usage:
  python workshop/fetch_nifty_yfinance.py
  python workshop/fetch_nifty_yfinance.py --instrument banknifty --from 2023-01-01
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import (  # noqa: E402
    INSTRUMENTS,
    add_fetch_args,
    load_workshop_env,
    output_path,
    parse_date,
    print_summary,
    save_csv,
)


def main() -> int:
    load_workshop_env()
    parser = argparse.ArgumentParser(description="Fetch NSE index daily bars via yfinance")
    add_fetch_args(parser)
    args = parser.parse_args()

    import yfinance as yf

    import pandas as pd

    meta = INSTRUMENTS[args.instrument]
    ticker = meta["yfinance"]
    start = parse_date(args.range_from)
    end = parse_date(args.range_to)

    hist = yf.download(
        ticker,
        start=start.isoformat(),
        end=end.isoformat(),
        progress=False,
        auto_adjust=False,
    )
    if hist.empty:
        raise SystemExit(f"No data returned for {ticker}")

    if isinstance(hist.columns, pd.MultiIndex):
        hist.columns = [col[0].lower() if isinstance(col, tuple) else col for col in hist.columns]

    df = hist.reset_index()
    df.columns = [str(c).lower() for c in df.columns]
    rename = {"date": "date", "open": "open", "high": "high", "low": "low", "close": "close", "volume": "volume"}
    df = df.rename(columns={k: v for k, v in rename.items() if k in df.columns})
    df["date"] = pd.to_datetime(df["date"]).dt.normalize()
    df["source"] = "yfinance"
    df["symbol"] = ticker
    df = df[["date", "open", "high", "low", "close", "volume", "source", "symbol"]]

    path = save_csv(df, output_path(args.instrument, "yfinance", args.output))
    print_summary(df, path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
