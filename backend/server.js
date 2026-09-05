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
const breadthPort = Number(config.port || 3002);
const powerbullPort = Number(config.powerbullPort || 3000);
const hasDhan = Boolean(config.clientId && config.pin && config.totpSecret);
const db = openDb();
const connectionStatus = createConnectionStatus();
const aggregator = new CandleAggregator();

const frontendDir = path.join(__dirname, '..', 'frontend');

function isPowerBullRequest(req) {
  return Number(req.socket.localPort) === powerbullPort;
}

const app = express();
app.use(express.json());

// Homepage by port — PowerBull Pro stays original; Market Breadth stays on 3002.
app.get('/', (req, res) => {
  if (isPowerBullRequest(req)) {
    return res.sendFile(path.join(frontendDir, 'index.html'));
  }
  return res.sendFile(path.join(frontendDir, 'breadth.html'));
});

app.get(['/breadth', '/breadth/'], (req, res) => {
  if (isPowerBullRequest(req)) {
    return res.redirect(302, `http://localhost:${breadthPort}/`);
  }
  return res.sendFile(path.join(frontendDir, 'breadth.html'));
});

app.get(['/powerbull', '/powerbull/', '/pro', '/pro/'], (req, res) => {
  if (!isPowerBullRequest(req)) {
    return res.redirect(302, `http://localhost:${powerbullPort}/`);
  }
  return res.sendFile(path.join(frontendDir, 'index.html'));
});

app.use(express.static(frontendDir));
app.use('/api', createApiRouter({
  db,
  connectionStatus,
  isMarketOpenFn: isMarketOpen,
  getCandles: (symbol) => aggregator.getCandles(symbol),
  config,
}));

const breadthServer = http.createServer(app);
const powerbullServer = http.createServer(app);

// Live WS for PowerBull Pro signals
const { broadcast } = createLiveSocketServer(powerbullServer, '/live');
createLiveSocketServer(breadthServer, '/live');

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

function afterBothPortsUp() {
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
}

let portsReady = 0;
function onReady(label, port) {
  console.log(`${label}: http://localhost:${port}/`);
  portsReady += 1;
  if (portsReady === 2) afterBothPortsUp();
}

breadthServer.listen(breadthPort, () => onReady('Market Breadth', breadthPort));
powerbullServer.listen(powerbullPort, () => onReady('PowerBull Pro (original)', powerbullPort));
