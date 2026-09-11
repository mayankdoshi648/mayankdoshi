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
      const msg = err.message || 'Request failed';
      const badRequest = /required|missing|invalid/i.test(msg);
      res.status(badRequest ? 400 : 500).json({
        data: null,
        meta: {
          asOf: new Date().toISOString(),
          source: 'error',
          isMock: false,
          stale: false,
          error: msg,
        },
        error: msg,
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

  router.get('/credentials/dhan', wrap(() => ({ data: service.getDhanStatus() })));
  router.put('/credentials/dhan', express.json(), wrap((req) => {
    const body = req.body || {};
    const status = service.setDhanCredentials({
      clientId: body.clientId,
      pin: body.pin,
      totpSecret: body.totpSecret,
      persistEnv: Boolean(body.persistEnv),
      clearForceMock: body.clearForceMock !== false,
    });
    // Keep shared config object in sync for /api/status and other routers.
    if (config) {
      config.clientId = service.config.clientId;
      config.pin = service.config.pin;
      config.totpSecret = service.config.totpSecret;
      config.hasDhan = true;
    }
    return { data: status };
  }));
  router.delete('/credentials/dhan', wrap(() => {
    const status = service.clearDhanCredentials();
    if (config) {
      config.clientId = '';
      config.pin = '';
      config.totpSecret = '';
      config.hasDhan = false;
    }
    return { data: status };
  }));
  router.post('/credentials/dhan/test', express.json(), wrap(async (req) => {
    const body = req.body || {};
    const hasOverride = body.clientId || body.pin || body.totpSecret;
    const result = await service.testDhanCredentials(hasOverride ? body : null);
    return { data: result };
  }));

  return router;
}

module.exports = { createFnoRouter };
