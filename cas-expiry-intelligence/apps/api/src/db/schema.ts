import type Database from 'better-sqlite3';

export function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS market_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      instrument_id TEXT NOT NULL,
      as_of TEXT NOT NULL,
      payload TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS option_chain_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      instrument_id TEXT NOT NULL,
      expiry TEXT NOT NULL,
      as_of TEXT NOT NULL,
      payload TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cas_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trade_date TEXT NOT NULL,
      instrument_id TEXT NOT NULL,
      expiry TEXT,
      reference_vwap REAL,
      cas_price REAL,
      futures_price REAL,
      payload TEXT NOT NULL,
      UNIQUE(trade_date, instrument_id)
    );

    CREATE TABLE IF NOT EXISTS expiry_dates (
      instrument_id TEXT NOT NULL,
      expiry TEXT NOT NULL,
      PRIMARY KEY (instrument_id, expiry)
    );

    CREATE TABLE IF NOT EXISTS backtest_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      params TEXT NOT NULL,
      status TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS backtest_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL,
      payload TEXT NOT NULL,
      FOREIGN KEY(run_id) REFERENCES backtest_runs(id)
    );

    CREATE TABLE IF NOT EXISTS signal_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      as_of TEXT NOT NULL,
      instrument_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      payload TEXT NOT NULL
    );
  `);
}
