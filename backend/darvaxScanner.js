const fs = require('node:fs');
const path = require('node:path');
const { evaluateDarvaX, relativeStrengthReturn } = require('./darvaxEngine');
const { fetchDailyCandles, computeRsPercentiles } = require('./darvaxData');
const { resolveNseInstrumentMap } = require('./instrumentMap');
const { fetchAccessToken } = require('./dhanAuth');
const { exportToObsidian } = require('./obsidianExport');
const { enrichResultsWithFundamentals } = require('./screenerFundamentals');
const { sendDarvaXAlerts } = require('./telegramAlerts');

function loadUniverse(market) {
  const file = market === 'US'
    ? path.join(__dirname, 'universe', 'us500.json')
    : path.join(__dirname, 'universe', 'nse500.json');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

async function prepareDhanContext(symbols, config, fetchImpl) {
  if (!config?.clientId || !config?.pin || !config?.totpSecret) return null;
  try {
    const { accessToken } = await fetchAccessToken(config, fetchImpl);
    const instrumentMap = await resolveNseInstrumentMap(symbols, fetchImpl);
    return { accessToken, clientId: config.clientId, instrumentMap, strict: false };
  } catch {
    return null;
  }
}

async function scanMarket(market, options = {}) {
  const {
    fetchImpl = fetch,
    style = 'swing',
    onProgress,
    dhanConfig = null,
    throttleMs = null,
  } = options;

  const symbols = loadUniverse(market);
  const delay = throttleMs ?? (market === 'NSE' && dhanConfig ? 100 : 120);

  let dhan = null;
  let instrumentMap = null;
  if (market === 'NSE') {
    dhan = dhanConfig || (await prepareDhanContext(symbols, options.config, fetchImpl));
    instrumentMap = dhan?.instrumentMap ?? null;
  }

  const indexSymbol = market === 'US' ? 'SPY' : 'NIFTYBEES';
  let indexCandles;
  try {
    indexCandles = await fetchDailyCandles(indexSymbol, market, {
      fetchImpl,
      dhan,
      instrumentMap,
    });
  } catch {
    indexCandles = null;
  }

  const rsRawList = [];
  const partial = [];
  const dataSource = market === 'NSE' && dhan ? 'dhan' : 'yahoo';

  for (let i = 0; i < symbols.length; i++) {
    const symbol = symbols[i];
    if (onProgress) {
      onProgress({ market, symbol, index: i + 1, total: symbols.length, dataSource });
    }
    try {
      const candles = await fetchDailyCandles(symbol, market, { fetchImpl, dhan, instrumentMap });
      const rsRaw = indexCandles ? relativeStrengthReturn(candles, indexCandles) : 0;
      rsRawList.push({ symbol, rsRaw, candles });
    } catch (err) {
      partial.push({ symbol, error: err.message });
    }
    if (i < symbols.length - 1) await new Promise((r) => setTimeout(r, delay));
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
      dataSource,
      ...evalResult,
    });
  }

  results.sort((a, b) => b.strengthScore - a.strengthScore);
  return {
    market,
    scanDate: new Date().toISOString().slice(0, 10),
    results,
    errors: partial,
    dataSource,
  };
}

async function runFullScan(options = {}) {
  const dhanConfig = options.config
    ? await prepareDhanContext(loadUniverse('NSE'), options.config, options.fetchImpl)
    : null;

  let nse = await scanMarket('NSE', { ...options, dhanConfig });
  const us = await scanMarket('US', options);
  const scannedAt = new Date().toISOString();
  const scanDate = scannedAt.slice(0, 10);

  if (options.enrichFundamentals !== false) {
    nse = {
      ...nse,
      results: await enrichResultsWithFundamentals(nse.results, {
        market: 'NSE',
        minScore: options.fundamentalsMinScore ?? 55,
        maxFetch: options.fundamentalsMaxFetch ?? 30,
        fetchImpl: options.fetchImpl,
      }),
    };
  }

  let telegram = null;
  if (options.sendTelegram && options.config) {
    telegram = await sendDarvaXAlerts({
      scanDate,
      nseResults: nse.results,
      usResults: us.results,
      config: options.config,
      fetchImpl: options.fetchImpl,
    });
  }

  let obsidian = null;
  if (options.obsidianVaultPath) {
    obsidian = exportToObsidian({
      vaultPath: options.obsidianVaultPath,
      scanDate,
      nseResults: nse.results,
      usResults: us.results,
      minScore: options.obsidianMinScore ?? 55,
    });
  }

  return { nse, us, scannedAt, obsidian, telegram };
}

module.exports = {
  loadUniverse,
  scanMarket,
  runFullScan,
  prepareDhanContext,
};
