const { getOpenSignals, updateOutcome } = require('./db');

const TARGET_PCT = 0.005;
const STOPLOSS_PCT = 0.003;

function evaluateOutcome(signal, candle) {
  if (signal.side === 'BUY') {
    const target = signal.price * (1 + TARGET_PCT);
    const stop = signal.price * (1 - STOPLOSS_PCT);
    if (candle.high >= target) return 'HIT_TARGET';
    if (candle.low <= stop) return 'HIT_SL';
  } else if (signal.side === 'SELL') {
    const target = signal.price * (1 - TARGET_PCT);
    const stop = signal.price * (1 + STOPLOSS_PCT);
    if (candle.low <= target) return 'HIT_TARGET';
    if (candle.high >= stop) return 'HIT_SL';
  }
  return null;
}

function checkOpenSignals(db, symbol, candle, tradeDate, onUpdate) {
  const openSignals = getOpenSignals(db, tradeDate).filter((s) => s.symbol === symbol);
  for (const signal of openSignals) {
    const outcome = evaluateOutcome(signal, candle);
    if (outcome) {
      updateOutcome(db, signal.id, outcome);
      if (onUpdate) onUpdate(signal, outcome);
    }
  }
}

function closeRemainingOpenSignals(db, tradeDate, onUpdate) {
  const openSignals = getOpenSignals(db, tradeDate);
  for (const signal of openSignals) {
    updateOutcome(db, signal.id, 'EOD_CLOSE');
    if (onUpdate) onUpdate(signal, 'EOD_CLOSE');
  }
}

module.exports = { evaluateOutcome, checkOpenSignals, closeRemainingOpenSignals, TARGET_PCT, STOPLOSS_PCT };
