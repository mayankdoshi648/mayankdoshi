// backend/api.js
const express = require('express');
const { getSignalsByDate } = require('./db');

function createApiRouter({ db, connectionStatus, isMarketOpenFn, getCandles }) {
  const router = express.Router();

  router.get('/status', (req, res) => {
    res.json({
      marketOpen: isMarketOpenFn(),
      feedConnected: connectionStatus.isConnected(),
      lastError: connectionStatus.getLastError(),
    });
  });

  router.get('/signals', (req, res) => {
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    res.json(getSignalsByDate(db, date));
  });

  router.get('/candles/:symbol', (req, res) => {
    res.json(getCandles(req.params.symbol));
  });

  return router;
}

module.exports = { createApiRouter };
