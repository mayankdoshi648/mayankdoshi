"""Shared helpers for Week 0 workshop data scripts."""

from __future__ import annotations

import argparse
import os
from datetime import date, datetime, timedelta
from pathlib import Path

import pandas as pd
from dotenv import load_dotenv

WORKSHOP_DIR = Path(__file__).resolve().parent
DATA_DIR = WORKSHOP_DIR / "data"
DEFAULT_LOOKBACK_DAYS = 365

# Fyers symbol -> Firstock tradingSymbol -> yfinance ticker
INSTRUMENTS: dict[str, dict[str, str]] = {
    "nifty": {
        "label": "Nifty 50",
        "fyers": "NSE:NIFTY50-INDEX",
        "firstock": "Nifty 50",
        "yfinance": "^NSEI",
        "filename": "nifty50_daily",
    },
    "banknifty": {
        "label": "Nifty Bank",
        "fyers": "NSE:NIFTYBANK-INDEX",
        "firstock": "Nifty Bank",
        "yfinance": "^NSEBANK",
        "filename": "niftybank_daily",
    },
}


def load_workshop_env() -> None:
    """Load workshop/.env, then repo-root .env as fallback."""
    load_dotenv(WORKSHOP_DIR / ".env")
    load_dotenv(WORKSHOP_DIR.parent / ".env")


def require_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise SystemExit(
            f"Missing {name}. Copy workshop/.env.example to workshop/.env and set it."
        )
    return value


def default_date_range(lookback_days: int = DEFAULT_LOOKBACK_DAYS) -> tuple[date, date]:
    end = date.today()
    start = end - timedelta(days=lookback_days)
    return start, end


def parse_date(value: str) -> date:
    return datetime.strptime(value, "%Y-%m-%d").date()


def add_fetch_args(parser: argparse.ArgumentParser) -> None:
    start, end = default_date_range()
    parser.add_argument(
        "--instrument",
        choices=sorted(INSTRUMENTS),
        default="nifty",
        help="Index to fetch (default: nifty)",
    )
    parser.add_argument(
        "--from",
        dest="range_from",
        default=start.isoformat(),
        help=f"Start date YYYY-MM-DD (default: {start.isoformat()})",
    )
    parser.add_argument(
        "--to",
        dest="range_to",
        default=end.isoformat(),
        help=f"End date YYYY-MM-DD (default: {end.isoformat()})",
    )
    parser.add_argument(
        "--out",
        dest="output",
        default=None,
        help="Output CSV path (default: workshop/data/<instrument>_<source>.csv)",
    )


def output_path(instrument: str, source: str, explicit: str | None = None) -> Path:
    if explicit:
        return Path(explicit)
    base = INSTRUMENTS[instrument]["filename"]
    return DATA_DIR / f"{base}_{source}.csv"


def candles_to_dataframe(
    rows: list,
    *,
    source: str,
    symbol: str,
) -> pd.DataFrame:
    """
    Normalize OHLCV rows to a standard DataFrame.

    Supported row shapes:
      - [epoch_seconds, open, high, low, close, volume]
      - dict with date/open/high/low/close/volume keys
    """
    if not rows:
        raise ValueError(f"No candles returned for {symbol} from {source}")

    if isinstance(rows[0], dict):
        df = pd.DataFrame(rows)
        date_col = next(
            (c for c in ("date", "datetime", "time", "timestamp") if c in df.columns),
            None,
        )
        if date_col is None:
            raise ValueError(f"Cannot find date column in {source} response")
        df["date"] = pd.to_datetime(df[date_col]).dt.normalize()
    else:
        df = pd.DataFrame(
            rows,
            columns=["timestamp", "open", "high", "low", "close", "volume"],
        )
        df["date"] = pd.to_datetime(df["timestamp"], unit="s").dt.normalize()

    for col in ("open", "high", "low", "close", "volume"):
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    df = df[["date", "open", "high", "low", "close", "volume"]].dropna()
    df = df.sort_values("date").drop_duplicates("date", keep="last")
    df["source"] = source
    df["symbol"] = symbol
    return df.reset_index(drop=True)


def save_csv(df: pd.DataFrame, path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(path, index=False)
    return path


def print_summary(df: pd.DataFrame, path: Path) -> None:
    print(f"Saved {len(df)} rows -> {path}")
    print(
        f"  Range: {df['date'].min().date()} .. {df['date'].max().date()}  "
        f"Last close: {df['close'].iloc[-1]:,.2f}"
    )
