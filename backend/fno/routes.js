'use strict';

const { getFnoService } = require('./service');

function createFnoRouter({ config }) {
  const express = require('express');
  const router = express.Router();
  const service = getFnoService(config);

  const wrap = (fn) => async (req, res) => {
    try {
      const data = await fn(req, res);
      if (!res.headersSent) res.json(data);
    } catch (err) {
      res.status(500).json({
        data: null,
        meta: {
          asOf: new Date().toISOString(),
          source: 'error',
          isMock: false,
          stale: false,
          error: err.message,
        },
        error: err.message,
      });
    }
  };

  router.get('/ticker', wrap(() => service.getTicker()));
  router.get('/overview', wrap(() => service.getMarketOverviewIntelligence()));
  router.get('/expiries/:underlying', wrap((req) => service.getExpiries(req.params.underlying)));
  router.get('/option-chain/:underlying', wrap((req) => {
    return service.getOptionChain(req.params.underlying, req.query.expiry || null);
  }));
  router.get('/scanner', wrap((req) => service.getFoScanner({
    signal: req.query.signal || null,
    sector: req.query.sector || null,
    minAbsScore: Number(req.query.minAbsScore || 0),
  })));
  router.get('/buildups', wrap(() => service.getBuildupBuckets()));
  router.get('/smart-money', wrap((req) => service.getSmartMoney(Number(req.query.limit || 25))));
  router.get('/smart-money/:symbol/history', wrap((req) => {
    const history = service.getSmartMoneyHistory(req.params.symbol, req.query.range || '5D');
    return { data: history, meta: { asOf: new Date().toISOString() } };
  }));
  router.get('/smart-money/:symbol', wrap((req) => service.getSmartMoneyDetail(req.params.symbol)));
  router.get('/sectors', wrap(() => service.getSectorAnalysis()));
  router.get('/sectors/:sector', wrap((req) => service.getSectorStocks(req.params.sector)));
  router.get('/fii-dii', wrap(() => service.getFiiDii()));
  router.get('/watchlist', wrap(() => service.getWatchlistQuotes()));
  router.post('/watchlist', express.json(), wrap((req) => {
    const symbol = req.body?.symbol;
    return { symbols: service.addWatchlist(symbol) };
  }));
  router.delete('/watchlist/:symbol', wrap((req) => ({ symbols: service.removeWatchlist(req.params.symbol) })));
  router.get('/alerts/rules', wrap(() => ({ rules: service.getAlertRules() })));
  router.put('/alerts/rules', express.json(), wrap((req) => ({ rules: service.updateAlertRules(req.body || {}) })));
  router.get('/alerts', wrap(() => service.evaluateAlerts()));
  router.get('/alerts/history', wrap(() => ({ alerts: service.getAlertHistory() })));

  return router;
}

module.exports = { createFnoRouter };
