// backend/api.js
const express = require('express');
const {
  getSignalsByDate,
  getDarvaxScans,
  insertPendingOrder,
  getPendingOrders,
  getOrderById,
  updateOrderStatus,
  saveDarvaxScanResults,
} = require('./db');
const { runFullScan, loadUniverse } = require('./darvaxScanner');
const { fetchAccessToken } = require('./dhanAuth');
const { placeDhanOrder, calcPositionSize } = require('./dhanOrders');
const { resolveNseInstrumentMap } = require('./instrumentMap');
const { exportFromDb } = require('./obsidianExport');
const { getMarketBreadth, readBreadthCache } = require('./marketBreadth');

function createApiRouter({
  db,
  connectionStatus,
  isMarketOpenFn,
  getCandles,
  config,
}) {
  const router = express.Router();
  let instrumentMapCache = null;
  let breadthProgress = null;

  router.get('/status', (req, res) => {
    res.json({
      marketOpen: isMarketOpenFn(),
      feedConnected: connectionStatus.isConnected(),
      lastError: connectionStatus.getLastError(),
      darvaxAutoTrade: config?.darvaxAutoTrade ?? false,
      hasDhan: Boolean(config?.clientId && config?.pin && config?.totpSecret),
    });
  });

  router.get('/breadth', async (req, res) => {
    const universe = req.query.universe === 'nifty500' ? 'nifty500' : 'nifty50';
    const force = req.query.refresh === '1' || req.query.refresh === 'true';
    try {
      const cached = readBreadthCache();
      if (!force && cached && cached.universe === universe) {
        return res.json({ ...cached, fromCache: true, progress: null });
      }
      if (!force) {
        // Return stale cache immediately if present, kick off refresh in background when empty
        if (cached && cached.universe === universe) {
          return res.json({ ...cached, fromCache: true });
        }
      }
      breadthProgress = { done: 0, total: 0, phase: null };
      const report = await getMarketBreadth({
        universe,
        force: true,
        config,
        onProgress: (p) => { breadthProgress = p; },
      });
      breadthProgress = null;
      res.json({ ...report, progress: null });
    } catch (err) {
      breadthProgress = null;
      const stale = readBreadthCache();
      if (stale) {
        return res.status(200).json({ ...stale, fromCache: true, warning: err.message });
      }
      res.status(500).json({ error: err.message, progress: breadthProgress });
    }
  });

  router.get('/breadth/status', (req, res) => {
    const cached = readBreadthCache();
    res.json({
      scanning: Boolean(breadthProgress),
      progress: breadthProgress,
      cached: cached
        ? { universe: cached.universe, scannedAt: cached.scannedAt, asOf: cached.asOf, stockCount: cached.stockCount }
        : null,
    });
  });

  router.post('/breadth/refresh', async (req, res) => {
    const universe = (req.body?.universe || req.query.universe) === 'nifty500' ? 'nifty500' : 'nifty50';
    try {
      breadthProgress = { done: 0, total: 0, symbol: null };
      const report = await getMarketBreadth({
        universe,
        force: true,
        config,
        onProgress: (p) => { breadthProgress = p; },
      });
      breadthProgress = null;
      res.json(report);
    } catch (err) {
      breadthProgress = null;
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/signals', (req, res) => {
    const date = req.query.date || new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
    res.json(getSignalsByDate(db, date));
  });

  router.get('/candles/:symbol', (req, res) => {
    res.json(getCandles(req.params.symbol));
  });

  router.get('/darvax/scans', (req, res) => {
    const scanDate = req.query.date;
    const market = req.query.market || null;
    const minScore = Number(req.query.minScore || config?.darvaxMinScore || 55);
    res.json(getDarvaxScans(db, { scanDate, market, minScore }));
  });

  router.post('/darvax/scan', async (req, res) => {
    try {
      const full = await runFullScan({
        style: config?.darvaxStyle || 'swing',
        config,
        obsidianVaultPath: config?.obsidianVaultPath || null,
        obsidianMinScore: config?.obsidianMinScore ?? 55,
        sendTelegram: Boolean(config?.telegramBotToken && config?.telegramChatId),
        fundamentalsMaxFetch: config?.fundamentalsMaxFetch ?? 30,
      });
      const scanDate = full.scannedAt.slice(0, 10);
      saveDarvaxScanResults(db, scanDate, 'NSE', full.nse.results);
      saveDarvaxScanResults(db, scanDate, 'US', full.us.results);
      res.json({
        scanDate,
        nse: {
          count: full.nse.results.length,
          errors: full.nse.errors.length,
          dataSource: full.nse.dataSource,
        },
        us: {
          count: full.us.results.length,
          errors: full.us.errors.length,
          dataSource: full.us.dataSource,
        },
        obsidian: full.obsidian,
        telegram: full.telegram,
        topNse: full.nse.results.filter((r) => r.qualifies).slice(0, 10),
        topUs: full.us.results.filter((r) => r.qualifies).slice(0, 10),
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/darvax/export-obsidian', (req, res) => {
    const vaultPath = req.body.vaultPath || config?.obsidianVaultPath;
    if (!vaultPath) {
      return res.status(400).json({ error: 'Set OBSIDIAN_VAULT_PATH in .env or pass vaultPath in body' });
    }
    try {
      const scanDate = req.body.date || new Date().toISOString().slice(0, 10);
      const minScore = Number(req.body.minScore ?? config?.obsidianMinScore ?? 55);
      const result = exportFromDb(db, {
        vaultPath,
        scanDate,
        minScore,
        getDarvaxScans,
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/darvax/orders/pending', (req, res) => {
    res.json(getPendingOrders(db));
  });

  router.post('/darvax/orders', (req, res) => {
    const { symbol, market, side, quantity, price, stopLoss } = req.body;
    if (!symbol || !market || !side || !quantity || !price) {
      return res.status(400).json({ error: 'symbol, market, side, quantity, price required' });
    }
    const id = insertPendingOrder(db, {
      symbol,
      market,
      side,
      quantity: Number(quantity),
      price: Number(price),
      stopLoss: stopLoss != null ? Number(stopLoss) : null,
    });

    if (config?.darvaxAutoTrade) {
      executeApprovedOrder(db, config, id).then((result) => res.json(result)).catch((err) => {
        res.status(500).json({ error: err.message, orderId: id });
      });
      return;
    }
    res.json({ orderId: id, status: 'PENDING', message: 'Awaiting manual approval' });
  });

  router.post('/darvax/orders/:id/approve', async (req, res) => {
    try {
      const result = await executeApprovedOrder(db, config, Number(req.params.id));
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/darvax/orders/:id/reject', (req, res) => {
    const order = getOrderById(db, Number(req.params.id));
    if (!order) return res.status(404).json({ error: 'Order not found' });
    updateOrderStatus(db, order.id, { status: 'REJECTED' });
    res.json({ orderId: order.id, status: 'REJECTED' });
  });

  router.post('/darvax/orders/preview', (req, res) => {
    const { price, stopLoss } = req.body;
    const risk = Number(price) - Number(stopLoss);
    const qty = calcPositionSize(config?.darvaxCapital || 1000000, config?.darvaxRiskPct || 1, risk);
    res.json({
      quantity: qty,
      riskPerShare: risk,
      riskAmount: (config?.darvaxCapital || 1000000) * ((config?.darvaxRiskPct || 1) / 100),
      capital: config?.darvaxCapital,
      riskPct: config?.darvaxRiskPct,
    });
  });

  async function executeApprovedOrder(dbRef, cfg, orderId) {
    const order = getOrderById(dbRef, orderId);
    if (!order) throw new Error('Order not found');
    if (order.status !== 'PENDING') throw new Error(`Order already ${order.status}`);

    if (order.market !== 'NSE') {
      updateOrderStatus(dbRef, orderId, { status: 'REJECTED', error: 'Dhan auto-exec supports NSE only' });
      throw new Error('Dhan auto-exec supports NSE only; US orders stay as watchlist');
    }

    updateOrderStatus(dbRef, orderId, {
      status: 'APPROVED',
      approvedAt: new Date().toISOString(),
    });

    try {
      if (!instrumentMapCache) {
        instrumentMapCache = await resolveNseInstrumentMap(loadUniverse('NSE'));
      }
      const securityId = instrumentMapCache.get(order.symbol);
      if (!securityId) throw new Error(`No Dhan securityId for ${order.symbol}`);

      const { accessToken } = await fetchAccessToken(cfg);
      const dhanResp = await placeDhanOrder({
        accessToken,
        clientId: cfg.clientId,
        securityId,
        transactionType: order.side,
        quantity: order.quantity,
        orderType: 'LIMIT',
        price: order.price,
        productType: 'CNC',
      });

      updateOrderStatus(dbRef, orderId, {
        status: 'EXECUTED',
        dhanOrderId: dhanResp.orderId || dhanResp.order_id || null,
        executedAt: new Date().toISOString(),
        error: null,
      });
      return { orderId, status: 'EXECUTED', dhan: dhanResp };
    } catch (err) {
      updateOrderStatus(dbRef, orderId, { status: 'FAILED', error: err.message });
      throw err;
    }
  }

  return router;
}

module.exports = { createApiRouter };
