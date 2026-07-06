// backend/server.js
const path = require('node:path');
const express = require('express');
const http = require('node:http');

const { loadConfig } = require('./config');
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
const { fetchAccessToken } = require('./dhanAuth');

const config = loadConfig();
const db = openDb();
const connectionStatus = createConnectionStatus();
const aggregator = new CandleAggregator();

const app = express();
app.use(express.static(path.join(__dirname, '..', 'frontend')));
app.use('/api', createApiRouter({
  db,
  connectionStatus,
  isMarketOpenFn: isMarketOpen,
  getCandles: (symbol) => aggregator.getCandles(symbol),
}));

const httpServer = http.createServer(app);
const { broadcast } = createLiveSocketServer(httpServer, '/live');

function todayTradeDate() {
  const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  return ist.toISOString().slice(0, 10);
}

async function startIngestion() {
  const { accessToken } = await fetchAccessToken(config);

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
  console.log(`PowerBull Pro listening on http://localhost:${config.port}`);
  if (isMarketOpen()) {
    startIngestion().catch((err) => {
      connectionStatus.setError(err);
      console.error('Ingestion failed to start:', err);
    });
  } else {
    console.log('Market closed — ingestion will not start until 9:30 IST on a trading day. Restart the server during market hours.');
  }
});
