const fs = require('node:fs');
const path = require('node:path');
const { evaluateDarvaX, relativeStrengthReturn } = require('./darvaxEngine');
const { fetchDailyCandles, computeRsPercentiles } = require('./darvaxData');

function loadUniverse(market) {
  const file = market === 'US'
    ? path.join(__dirname, 'universe', 'us500.json')
    : path.join(__dirname, 'universe', 'nse500.json');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

async function scanMarket(market, { fetchImpl = fetch, style = 'swing', onProgress } = {}) {
  const symbols = loadUniverse(market);
  const indexSymbol = market === 'US' ? 'SPY' : 'NIFTYBEES.NS';
  let indexCandles;
  try {
    indexCandles = await fetchDailyCandles(indexSymbol, market, '2y', fetchImpl);
  } catch {
    indexCandles = null;
  }

  const rsRawList = [];
  const partial = [];

  for (let i = 0; i < symbols.length; i++) {
    const symbol = symbols[i];
    if (onProgress) onProgress({ market, symbol, index: i + 1, total: symbols.length });
    try {
      const candles = await fetchDailyCandles(symbol, market, '2y', fetchImpl);
      const rsRaw = indexCandles ? relativeStrengthReturn(candles, indexCandles) : 0;
      rsRawList.push({ symbol, rsRaw, candles });
    } catch (err) {
      partial.push({ symbol, error: err.message });
    }
    await new Promise((r) => setTimeout(r, 120));
  }

  const pctiles = computeRsPercentiles(rsRawList.map((r) => ({ symbol: r.symbol, rsRaw: r.rsRaw })));
  const results = [];

  for (const { symbol, candles, rsRaw } of rsRawList) {
    const rsPercentile = pctiles.get(symbol) ?? 50;
    const evalResult = evaluateDarvaX(candles, {
      market,
      indexCandles,
      rsPercentile,
      style,
    });
    results.push({
      symbol,
      market,
      close: candles[candles.length - 1].close,
      ...evalResult,
    });
  }

  results.sort((a, b) => b.strengthScore - a.strengthScore);
  return { market, scanDate: new Date().toISOString().slice(0, 10), results, errors: partial };
}

async function runFullScan(options = {}) {
  const nse = await scanMarket('NSE', options);
  const us = await scanMarket('US', options);
  return { nse, us, scannedAt: new Date().toISOString() };
}

module.exports = { loadUniverse, scanMarket, runFullScan };
