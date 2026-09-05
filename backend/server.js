// backend/server.js
const path = require('node:path');
const express = require('express');
const http = require('node:http');

const { loadConfigOptional } = require('./config');
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

const config = loadConfigOptional();
const hasDhan = Boolean(config.clientId && config.pin && config.totpSecret);
const db = openDb();
const connectionStatus = createConnectionStatus();
const aggregator = new CandleAggregator();

const app = express();
app.use(express.json());
const frontendDir = path.join(__dirname, '..', 'frontend');

// Market Breadth is the primary app on this port (http://localhost:3002/)
app.get(['/', '/breadth', '/breadth/'], (req, res) => {
  res.sendFile(path.join(frontendDir, 'breadth.html'));
});

// PowerBull Pro kept separate (not mixed into Market Breadth)
app.get(['/powerbull', '/powerbull/', '/pro', '/pro/'], (req, res) => {
  res.sendFile(path.join(frontendDir, 'index.html'));
});

app.use(express.static(frontendDir));
app.use('/api', createApiRouter({
  db,
  connectionStatus,
  isMarketOpenFn: isMarketOpen,
  getCandles: (symbol) => aggregator.getCandles(symbol),
  config,
}));

const httpServer = http.createServer(app);
const { broadcast } = createLiveSocketServer(httpServer, '/live');

function todayTradeDate() {
  const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  return ist.toISOString().slice(0, 10);
}

async function startIngestion() {
  if (!hasDhan) {
    throw new Error('Dhan credentials not configured — live feed disabled (Market Breadth still works via Yahoo/NSE)');
  }
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
  console.log(`Market Breadth: http://localhost:${config.port}/`);
  console.log(`PowerBull Pro:  http://localhost:${config.port}/powerbull`);
  if (!hasDhan) {
    console.log('Dhan credentials missing — live feed off. Market Breadth uses Yahoo/Kotak + NSE universe.');
    return;
  }
  if (isMarketOpen()) {
    startIngestion().catch((err) => {
      connectionStatus.setError(err);
      console.error('Ingestion failed to start:', err);
    });
  } else {
    console.log('Market closed — ingestion will not start until 9:30 IST on a trading day. Restart the server during market hours.');
  }
});
