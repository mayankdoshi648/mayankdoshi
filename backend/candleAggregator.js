const BUCKET_MS = 5 * 60 * 1000;

class CandleAggregator {
  constructor() {
    this.current = new Map();
    this.completed = new Map();
  }

  _bucketStart(timestampMs) {
    return Math.floor(timestampMs / BUCKET_MS) * BUCKET_MS;
  }

  onTick({ symbol, ltp, ltq, timestamp }) {
    const bucketStart = this._bucketStart(timestamp);
    const cur = this.current.get(symbol);
    let closedCandle = null;

    if (!cur || cur.bucketStart !== bucketStart) {
      if (cur) closedCandle = this._finalize(symbol, cur);
      this.current.set(symbol, {
        bucketStart,
        open: ltp,
        high: ltp,
        low: ltp,
        close: ltp,
        volume: ltq,
      });
    } else {
      cur.high = Math.max(cur.high, ltp);
      cur.low = Math.min(cur.low, ltp);
      cur.close = ltp;
      cur.volume += ltq;
    }

    return closedCandle;
  }

  _finalize(symbol, candle) {
    const finished = {
      time: candle.bucketStart,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
    };
    if (!this.completed.has(symbol)) this.completed.set(symbol, []);
    this.completed.get(symbol).push(finished);
    return finished;
  }

  getCandles(symbol) {
    return this.completed.get(symbol) || [];
  }

  reset() {
    this.current.clear();
    this.completed.clear();
  }
}

module.exports = { CandleAggregator, BUCKET_MS };
