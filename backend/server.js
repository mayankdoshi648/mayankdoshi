// backend/server.js
const path = require('node:path');
const express = require('express');
const http = require('node:http');

const { loadConfigOptional, hasDhanCredentials } = require('./config');
const { isMarketOpen } = require('./marketWindow');
const { openDb, insertSignal } = require('./db');
const { evaluateSignal, MIN_CANDLES } = require('./signalEngine');
const { CandleAggregator } = require('./candleAggregator');
const { checkOpenSignals, closeRemainingOpenSignals } = require('./outcomeTracker');
const { createConnectionStatus } = require('./connectionStatus');
const { createApiRouter } = require('./api');
const { createLiveSocketServer } = require('./liveSocket');
const { createDhanFeed } = require('./dhanFeed');
const { resolveNifty50InstrumentMap } = require('./instrumentMap');
const { createTokenManager } = require('./dhanToken');
const { createStockDashboard } = require('./stockDashboard');

const config = loadConfigOptional();
const db = openDb();
const connectionStatus = createConnectionStatus();
const aggregator = new CandleAggregator();
const tokenManager = createTokenManager({ config });
const demoMode = config.forceDemo || !hasDhanCredentials(config);
const stockDashboard = createStockDashboard({
  tokenManager,
  config,
  demoMode,
});

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'frontend')));
app.use('/api', createApiRouter({
  db,
  connectionStatus,
  isMarketOpenFn: isMarketOpen,
  getCandles: (symbol) => aggregator.getCandles(symbol),
  config,
  stockDashboard,
  tokenManager,
}));

const httpServer = http.createServer(app);
const { broadcast } = createLiveSocketServer(httpServer, '/live');

function todayTradeDate() {
  const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  return ist.toISOString().slice(0, 10);
}

async function startIngestion() {
  if (!hasDhanCredentials(config) || config.forceDemo) {
    console.log('Skipping live feed — demo mode or missing Dhan credentials.');
    return;
  }

  const { accessToken } = await tokenManager.getAccessToken();

  const instrumentMap = await resolveNifty50InstrumentMap();
  const securityIdToSymbol = new Map();
  for (const [symbol, securityId] of instrumentMap) securityIdToSymbol.set(securityId, symbol);

  const feed = createDhanFeed({ clientId: config.clientId, accessToken });

  feed.on('connected', () => connectionStatus.setConnected(true));
  feed.on('disconnected', () => connectionStatus.setConnected(false));
  feed.on('error', (err) => connectionStatus.setError(err));

  feed.on('tick', (tick) => {
    if (!isMarketOpen()) return;
    const symbol = securityIdToSymbol.get(tick.symbol) || tick.symbol;
    const closedCandle = aggregator.onTick({ ...tick, symbol });
    if (!closedCandle) return;

    checkOpenSignals(db, symbol, closedCandle, todayTradeDate(), (signal, outcome) => {
      broadcast({ type: 'outcome', id: signal.id, symbol: signal.symbol, outcome });
    });
    broadcast({ type: 'candle', symbol, candle: closedCandle });

    const candles = aggregator.getCandles(symbol);
    if (candles.length < MIN_CANDLES) return;
    const { side, score } = evaluateSignal(candles);
    if (side === 'NEUTRAL') return;

    const candleTime = new Date(closedCandle.time).toISOString();
    const tradeDate = todayTradeDate();
    const id = insertSignal(db, { symbol, side, price: closedCandle.close, score, candleTime, tradeDate });
    broadcast({ type: 'signal', id, symbol, side, price: closedCandle.close, score, candle_time: candleTime, outcome: 'OPEN' });
  });

  const instruments = [...instrumentMap.values()].map((securityId) => ({ exchangeSegment: 'NSE_EQ', securityId }));
  await feed.connect(instruments);
}

setInterval(() => {
  if (!isMarketOpen()) {
    closeRemainingOpenSignals(db, todayTradeDate(), (signal, outcome) => {
      broadcast({ type: 'outcome', id: signal.id, symbol: signal.symbol, outcome });
    });
  }
}, 5 * 60 * 1000);

httpServer.listen(config.port, () => {
  const mode = demoMode ? 'DEMO' : 'LIVE';
  console.log(`PowerBull Pro listening on http://localhost:${config.port} [${mode}]`);
  if (demoMode) {
    console.log('Dashboard running in demo mode. Add DHAN_* credentials to .env for live Dhan quotes.');
    connectionStatus.setError(new Error('Demo mode — Dhan credentials not configured'));
  } else if (isMarketOpen()) {
    startIngestion().catch((err) => {
      connectionStatus.setError(err);
      console.error('Ingestion failed to start:', err);
    });
  } else {
    console.log('Market closed — live feed will not start until 9:30 IST. Dashboard quotes still available via Dhan REST.');
    // Warm auth + dashboard cache outside market hours
    tokenManager.getAccessToken().then(() => {
      stockDashboard.refresh('nifty50').catch((err) => console.warn('Dashboard warm failed:', err.message));
    }).catch((err) => {
      connectionStatus.setError(err);
      console.error('Dhan auth failed:', err.message);
    });
  }
});
