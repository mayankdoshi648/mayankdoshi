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
  db.exec(`
    CREATE TABLE IF NOT EXISTS darvax_scans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scan_date TEXT NOT NULL,
      market TEXT NOT NULL,
      symbol TEXT NOT NULL,
      close REAL,
      strength_score INTEGER NOT NULL,
      tier TEXT,
      stage TEXT,
      box_top REAL,
      box_bottom REAL,
      pct_from_52w_high REAL,
      rvol REAL,
      rs_percentile REAL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(scan_date, market, symbol)
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS darvax_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL,
      market TEXT NOT NULL,
      side TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      price REAL NOT NULL,
      stop_loss REAL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      dhan_order_id TEXT,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      approved_at TEXT,
      executed_at TEXT
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

function upsertDarvaxScan(db, row) {
  db.prepare(`
    INSERT INTO darvax_scans (
      scan_date, market, symbol, close, strength_score, tier, stage,
      box_top, box_bottom, pct_from_52w_high, rvol, rs_percentile, payload
    ) VALUES (
      @scanDate, @market, @symbol, @close, @strengthScore, @tier, @stage,
      @boxTop, @boxBottom, @pctFrom52wHigh, @rvol, @rsPercentile, @payload
    )
    ON CONFLICT(scan_date, market, symbol) DO UPDATE SET
      close = excluded.close,
      strength_score = excluded.strength_score,
      tier = excluded.tier,
      stage = excluded.stage,
      box_top = excluded.box_top,
      box_bottom = excluded.box_bottom,
      pct_from_52w_high = excluded.pct_from_52w_high,
      rvol = excluded.rvol,
      rs_percentile = excluded.rs_percentile,
      payload = excluded.payload,
      created_at = datetime('now')
  `).run(row);
}

function saveDarvaxScanResults(db, scanDate, market, results) {
  for (const r of results) {
    upsertDarvaxScan(db, {
      scanDate,
      market,
      symbol: r.symbol,
      close: r.close ?? null,
      strengthScore: r.strengthScore ?? 0,
      tier: r.tier ?? 'Skip',
      stage: r.stage ?? 'UNKNOWN',
      boxTop: r.box?.top ?? null,
      boxBottom: r.box?.bottom ?? null,
      pctFrom52wHigh: r.pctFrom52wHigh ?? null,
      rvol: r.rvol ?? null,
      rsPercentile: r.rsPercentile ?? null,
      payload: JSON.stringify(r),
    });
  }
}

function getDarvaxScans(db, { scanDate, market, minScore = 0 } = {}) {
  const date = scanDate || new Date().toISOString().slice(0, 10);
  let sql = 'SELECT * FROM darvax_scans WHERE scan_date = ? AND strength_score >= ?';
  const params = [date, minScore];
  if (market) {
    sql += ' AND market = ?';
    params.push(market);
  }
  sql += ' ORDER BY strength_score DESC';
  const rows = db.prepare(sql).all(...params);
  return rows.map((row) => ({
    ...JSON.parse(row.payload),
    id: row.id,
    scanDate: row.scan_date,
  }));
}

function insertPendingOrder(db, order) {
  const info = db.prepare(`
    INSERT INTO darvax_orders (symbol, market, side, quantity, price, stop_loss, status)
    VALUES (@symbol, @market, @side, @quantity, @price, @stopLoss, 'PENDING')
  `).run(order);
  return info.lastInsertRowid;
}

function getPendingOrders(db) {
  return db.prepare("SELECT * FROM darvax_orders WHERE status = 'PENDING' ORDER BY created_at ASC").all();
}

function getOrderById(db, id) {
  return db.prepare('SELECT * FROM darvax_orders WHERE id = ?').get(id);
}

function updateOrderStatus(db, id, { status, dhanOrderId = null, error = null, approvedAt = null, executedAt = null }) {
  db.prepare(`
    UPDATE darvax_orders
    SET status = @status,
        dhan_order_id = COALESCE(@dhanOrderId, dhan_order_id),
        error = @error,
        approved_at = COALESCE(@approvedAt, approved_at),
        executed_at = COALESCE(@executedAt, executed_at)
    WHERE id = @id
  `).run({ id, status, dhanOrderId, error, approvedAt, executedAt });
}

module.exports = {
  openDb,
  insertSignal,
  getSignalsByDate,
  getOpenSignals,
  updateOutcome,
  saveDarvaxScanResults,
  getDarvaxScans,
  insertPendingOrder,
  getPendingOrders,
  getOrderById,
  updateOrderStatus,
};
