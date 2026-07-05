const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

function openDb(dbPath = path.join(__dirname, '..', 'data', 'signals.db')) {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS signals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL,
      side TEXT NOT NULL,
      price REAL NOT NULL,
      score REAL NOT NULL,
      candle_time TEXT NOT NULL,
      trade_date TEXT NOT NULL,
      outcome TEXT NOT NULL DEFAULT 'OPEN'
    )
  `);
  return db;
}

function insertSignal(db, { symbol, side, price, score, candleTime, tradeDate }) {
  const stmt = db.prepare(`
    INSERT INTO signals (symbol, side, price, score, candle_time, trade_date, outcome)
    VALUES (@symbol, @side, @price, @score, @candleTime, @tradeDate, 'OPEN')
  `);
  const info = stmt.run({ symbol, side, price, score, candleTime, tradeDate });
  return info.lastInsertRowid;
}

function getSignalsByDate(db, tradeDate) {
  return db.prepare('SELECT * FROM signals WHERE trade_date = ? ORDER BY candle_time ASC').all(tradeDate);
}

function getOpenSignals(db, tradeDate) {
  return db.prepare("SELECT * FROM signals WHERE trade_date = ? AND outcome = 'OPEN'").all(tradeDate);
}

function updateOutcome(db, id, outcome) {
  db.prepare('UPDATE signals SET outcome = ? WHERE id = ?').run(outcome, id);
}

module.exports = { openDb, insertSignal, getSignalsByDate, getOpenSignals, updateOutcome };
