// backend/api.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { createApiRouter } = require('./api');
const { openDb, insertSignal } = require('./db');

async function startTestServer(router) {
  const app = express();
  app.use('/api', router);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  return { server, port: server.address().port };
}

test('GET /api/status reports market state and feed connection', async () => {
  const db = openDb(':memory:');
  const router = createApiRouter({
    db,
    connectionStatus: { isConnected: () => true, getLastError: () => null },
    isMarketOpenFn: () => false,
    getCandles: () => [],
  });
  const { server, port } = await startTestServer(router);

  const resp = await fetch(`http://localhost:${port}/api/status`);
  const body = await resp.json();
  assert.equal(body.marketOpen, false);
  assert.equal(body.feedConnected, true);
  assert.equal(body.lastError, null);

  await new Promise((resolve) => server.close(resolve));
  db.close();
});

test('GET /api/signals?date= returns rows for that date', async () => {
  const db = openDb(':memory:');
  insertSignal(db, { symbol: 'TCS', side: 'BUY', price: 100, score: 2, candleTime: 't1', tradeDate: '2026-07-06' });
  const router = createApiRouter({
    db,
    connectionStatus: { isConnected: () => true, getLastError: () => null },
    isMarketOpenFn: () => true,
    getCandles: () => [],
  });
  const { server, port } = await startTestServer(router);

  const resp = await fetch(`http://localhost:${port}/api/signals?date=2026-07-06`);
  const body = await resp.json();
  assert.equal(body.length, 1);
  assert.equal(body[0].symbol, 'TCS');

  await new Promise((resolve) => server.close(resolve));
  db.close();
});

test('GET /api/candles/:symbol delegates to getCandles', async () => {
  const db = openDb(':memory:');
  const router = createApiRouter({
    db,
    connectionStatus: { isConnected: () => true, getLastError: () => null },
    isMarketOpenFn: () => true,
    getCandles: (symbol) => (symbol === 'TCS' ? [{ time: 0, open: 1, high: 2, low: 0, close: 1, volume: 10 }] : []),
  });
  const { server, port } = await startTestServer(router);

  const resp = await fetch(`http://localhost:${port}/api/candles/TCS`);
  const body = await resp.json();
  assert.equal(body.length, 1);
  assert.equal(body[0].close, 1);

  await new Promise((resolve) => server.close(resolve));
  db.close();
});
