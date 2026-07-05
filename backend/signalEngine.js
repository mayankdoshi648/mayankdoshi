const { computeEMA, computeRSI, computeSessionVWAP, isVolumeSpike } = require('./indicators');

const MIN_CANDLES = 21;
const EMA_SHORT_PERIOD = 9;
const EMA_LONG_PERIOD = 21;
const RSI_PERIOD = 14;
const BUY_THRESHOLD = 2;
const SELL_THRESHOLD = -2;

function evaluateSignal(candles) {
  if (candles.length < MIN_CANDLES) {
    return { side: 'NEUTRAL', score: 0 };
  }

  const index = candles.length - 1;
  const closes = candles.map((c) => c.close);
  const volumes = candles.map((c) => c.volume);

  const emaShort = computeEMA(closes, EMA_SHORT_PERIOD);
  const emaLong = computeEMA(closes, EMA_LONG_PERIOD);
  const rsi = computeRSI(closes, RSI_PERIOD);
  const vwap = computeSessionVWAP(candles);

  let score = 0;

  const prevShort = emaShort[index - 1];
  const prevLong = emaLong[index - 1];
  const curShort = emaShort[index];
  const curLong = emaLong[index];
  if (prevShort !== null && prevLong !== null && curShort !== null && curLong !== null) {
    if (prevShort <= prevLong && curShort > curLong) score += 1;
    if (prevShort >= prevLong && curShort < curLong) score -= 1;
  }

  const r = rsi[index];
  if (r !== null) {
    if (r < 30) score += 1;
    if (r > 70) score -= 1;
  }

  const v = vwap[index];
  if (v !== null) {
    if (closes[index] > v) score += 1;
    if (closes[index] < v) score -= 1;
  }

  if (isVolumeSpike(volumes, index)) score *= 1.5;

  let side = 'NEUTRAL';
  if (score >= BUY_THRESHOLD) side = 'BUY';
  else if (score <= SELL_THRESHOLD) side = 'SELL';

  return { side, score };
}

module.exports = { evaluateSignal, MIN_CANDLES };
