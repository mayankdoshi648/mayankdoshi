#!/usr/bin/env python3
"""
Compare Nifty CSVs from Fyers, Firstock, and yfinance on overlapping dates.

Usage:
  python workshop/compare_sources.py
  python workshop/compare_sources.py --instrument banknifty
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import INSTRUMENTS, DATA_DIR  # noqa: E402


def load_source(instrument: str, source: str):
    import pandas as pd

    path = DATA_DIR / f"{INSTRUMENTS[instrument]['filename']}_{source}.csv"
    if not path.exists():
        return None, path
    df = pd.read_csv(path, parse_dates=["date"])
    return df, path


def main() -> int:
    parser = argparse.ArgumentParser(description="Compare workshop CSV data sources")
    parser.add_argument("--instrument", choices=sorted(INSTRUMENTS), default="nifty")
    args = parser.parse_args()

    sources = ("fyers", "firstock", "yfinance")
    loaded = {}
    for source in sources:
        df, path = load_source(args.instrument, source)
        if df is not None:
            loaded[source] = df
            print(f"[ok] {source:10} {len(df):4} rows  {path.name}")
        else:
            print(f"[--] {source:10} missing   {path.name}")

    if len(loaded) < 2:
        print("\nNeed at least two sources. Run fetch scripts first.")
        return 1

    import pandas as pd

    merged = None
    for source, df in loaded.items():
        slim = df[["date", "close"]].rename(columns={"close": f"close_{source}"})
        merged = slim if merged is None else merged.merge(slim, on="date", how="inner")

    if merged is None or merged.empty:
        print("\nNo overlapping dates between sources.")
        return 1

    ref = "close_yfinance" if "close_yfinance" in merged.columns else merged.columns[-1]
    for source in loaded:
        col = f"close_{source}"
        if col == ref:
            continue
        diff = (merged[col] - merged[ref]).abs()
        print(
            f"\n{source} vs {ref.split('_', 1)[1]} on {len(merged)} overlapping days:"
            f"\n  mean |diff|: {diff.mean():.4f}"
            f"\n  max  |diff|: {diff.max():.4f}"
        )

    print("\nLast 5 overlapping closes:")
    print(merged.tail().to_string(index=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
