const { computeEMA, computeSMA, computeATR, isVolumeSpike } = require('./indicators');

const BOX_LOOKBACK = 252;
const CONFIRM_DAYS = 3;
const PREFILTER_MAX_DOWN_FROM_HIGH = 10;
const PREFILTER_MIN_UP_FROM_LOW_NSE = 100;
const PREFILTER_MIN_UP_FROM_LOW_US = 50;
const MIN_SCORE_DEFAULT = 55;

function lastIndex(arr) {
  return arr.length - 1;
}

function findBoxTop(candles, lookback = BOX_LOOKBACK, confirmDays = CONFIRM_DAYS) {
  const highs = candles.map((c) => c.high);
  for (let i = candles.length - confirmDays - 1; i >= Math.max(0, candles.length - lookback); i--) {
    const candidate = highs[i];
    const priorMax = Math.max(...highs.slice(Math.max(0, i - lookback), i));
    if (candidate <= priorMax) continue;
    const next = highs.slice(i + 1, i + 1 + confirmDays);
    if (next.length < confirmDays || next.some((h) => h >= candidate)) continue;
    return { boxTop: candidate, topBar: i };
  }
  return null;
}

function findBoxBottom(candles, topInfo, confirmDays = CONFIRM_DAYS) {
  const lows = candles.map((c) => c.low);
  const start = topInfo.topBar;
  for (let i = start; i <= candles.length - confirmDays - 1; i++) {
    const candidate = lows[i];
    const next = lows.slice(i + 1, i + 1 + confirmDays);
    if (next.length < confirmDays || next.some((l) => l <= candidate)) continue;
    const rangeLow = Math.min(...lows.slice(start, i + 1 + confirmDays));
    return {
      boxBottom: Math.max(candidate, rangeLow),
      bottomBar: i,
    };
  }
  return null;
}

function passesPrefilter(candles, market) {
  const idx = lastIndex(candles);
  const close = candles[idx].close;
  const volume = candles[idx].volume;
  const lookback = Math.min(252, candles.length);
  const window = candles.slice(-lookback);
  const high52 = Math.max(...window.map((c) => c.high));
  const low52 = Math.min(...window.map((c) => c.low));
  const downFromHigh = ((high52 - close) / high52) * 100;
  const upFromLow = (close / low52 - 1) * 100;
  const minUp = market === 'US' ? PREFILTER_MIN_UP_FROM_LOW_US : PREFILTER_MIN_UP_FROM_LOW_NSE;
  const minPrice = market === 'US' ? 5 : 10;
  const minVol = market === 'US' ? 0 : 100_000;

  return (
    downFromHigh > 0
    && downFromHigh <= PREFILTER_MAX_DOWN_FROM_HIGH
    && upFromLow >= minUp
    && close > minPrice
    && (market === 'US' || volume > minVol)
  );
}

function boxMetrics(candles, boxTop, boxBottom, topBar) {
  const atr = computeATR(candles, 14);
  const idx = lastIndex(candles);
  const height = boxTop - boxBottom;
  const heightPct = (height / boxBottom) * 100;
  const atrVal = atr[idx] || height;
  let daysInBox = 0;
  for (let i = topBar; i < candles.length; i++) {
    if (candles[i].close <= boxTop && candles[i].close >= boxBottom) daysInBox++;
  }
  const atrSeries = atr.filter((v) => v != null);
  const atrContracting = atrSeries.length >= 20
    && atrSeries[idx] < atrSeries[idx - 15];
  return {
    height,
    heightPct,
    heightToATR: atrVal > 0 ? height / atrVal : 0,
    daysInBox,
    atrContracting,
  };
}

function detectBullRescue(candles, boxBottom) {
  if (candles.length < 2) return false;
  const last = candles[lastIndex(candles)];
  const prev = candles[candles.length - 2];
  const nearFloor = last.low <= boxBottom * 1.02;
  const bullish = last.close > last.open;
  const range = last.high - last.low || 1;
  const bodyPct = Math.abs(last.close - last.open) / range;
  return nearFloor && bullish && bodyPct > 0.55 && prev.close < prev.open;
}

function detectRedIgnoredBar(candles) {
  if (candles.length < 3) return false;
  const c1 = candles[candles.length - 3];
  const c2 = candles[candles.length - 2];
  const c3 = candles[lastIndex(candles)];
  const ranges = candles.slice(-20).map((c) => c.high - c.low);
  const avgRange = ranges.reduce((a, b) => a + b, 0) / ranges.length;
  const control = c1.close > c1.open && (c1.high - c1.low) > avgRange * 1.5;
  const inside = c2.high < c1.high && c2.low > c1.low && c2.close < c2.open;
  const signal = c3.close > c3.open && c3.close > c2.high;
  return control && inside && signal;
}

function detectLollipop(candles) {
  const c = candles[lastIndex(candles)];
  const body = Math.abs(c.close - c.open);
  const lower = Math.min(c.open, c.close) - c.low;
  const upper = c.high - Math.max(c.open, c.close);
  const isLollipop = lower > body * 2.5 && upper < body * 0.3 && c.close >= c.open;
  return { isLollipop, stopLoss: isLollipop ? c.low : null };
}

function detectShakeout(candles, boxTop, boxBottom, window = 5) {
  if (candles.length < window) return false;
  const recent = candles.slice(-window);
  const close = recent[lastIndex(recent)].close;
  const wentOut = recent.some((c) => c.low < boxBottom);
  const backIn = close > boxBottom;
  const breaking = close > boxTop;
  return wentOut && backIn && breaking;
}

function classifyGap(candles, boxTop, boxBottom) {
  if (candles.length < 2) return { type: null, points: 0 };
  const today = candles[lastIndex(candles)];
  const prev = candles[candles.length - 2];
  if (today.low <= prev.high) return { type: null, points: 0 };
  const gapPct = ((today.low - prev.high) / prev.close) * 100;
  if (prev.close >= boxBottom && prev.close <= boxTop) return { type: 'COMMON_GAP', points: 0 };
  if (today.low > boxTop) return { type: 'BREAKAWAY_GAP', points: 12 };
  if (today.close > boxTop && gapPct > 0) return { type: 'RUNAWAY_GAP', points: 8 };
  if (gapPct > 3 && today.close < today.open) return { type: 'EXHAUSTION_GAP', points: -10 };
  return { type: null, points: 0 };
}

function fibStrength(candles, boxBottom, boxTop) {
  const diff = boxTop - boxBottom;
  const fib236 = boxTop - 0.236 * diff;
  const fib382 = boxTop - 0.382 * diff;
  const fib500 = boxTop - 0.5 * diff;
  const recentLow = Math.min(...candles.slice(-10).map((c) => c.low));
  if (recentLow >= fib236) return { points: 10, reason: `✓ Fib: Pullback held 23.6% (${fib236.toFixed(0)})` };
  if (recentLow >= fib382) return { points: 7, reason: `✓ Fib: Pullback held 38.2% (${fib382.toFixed(0)})` };
  if (recentLow >= fib500) return { points: 3, reason: `~ Fib: Pullback to 50% (${fib500.toFixed(0)})` };
  return { points: 0, reason: '✗ Fib: Broke below 50% — weak structure' };
}

function wyckoffScore(candles, boxTop, boxBottom) {
  let score = 0;
  const reasons = [];
  const window = candles.slice(-30);
  const volAvg = computeSMA(candles.map((c) => c.volume), 20);
  const avg = volAvg[lastIndex(volAvg)] || 1;

  const bottomBars = window.filter((c) => c.low <= boxBottom * 1.03);
  if (bottomBars.length && bottomBars[bottomBars.length - 1].volume < avg * 0.7) {
    score += 10;
    reasons.push('✓ Wyckoff: Final test — no supply at box floor');
  }
  const nearTop = window.filter((c) => c.close >= boxTop * 0.92);
  if (nearTop.length && Math.max(...nearTop.map((c) => c.volume)) > avg * 1.5) {
    score += 12;
    reasons.push('✓ Wyckoff: Sign of Strength toward box top');
  }
  const lows = window.map((c) => c.low);
  if (lows.length >= 5 && lows[lows.length - 1] > lows[lows.length - 3]) {
    score += 8;
    reasons.push('✓ Wyckoff: Last Point of Support (higher low)');
  }
  if (candles.length >= 10) {
    const brokeOut = candles[candles.length - 10].close > boxTop;
    const pulledBack = candles.slice(-3).some((c) => c.low <= boxTop * 1.02);
    const held = candles[lastIndex(candles)].close > boxTop;
    if (brokeOut && pulledBack && held) {
      score += 10;
      reasons.push('✓ Wyckoff: Back Up — retest of box top held');
    }
  }
  return { score: Math.min(score, 15), reasons };
}

function relativeStrengthReturn(stockCandles, indexCandles, periods = [63, 126, 252], weights = [0.4, 0.3, 0.3]) {
  let rs = 0;
  for (let p = 0; p < periods.length; p++) {
    const period = periods[p];
    if (stockCandles.length <= period || indexCandles.length <= period) continue;
    const sRet = stockCandles[lastIndex(stockCandles)].close / stockCandles[stockCandles.length - 1 - period].close - 1;
    const iRet = indexCandles[lastIndex(indexCandles)].close / indexCandles[indexCandles.length - 1 - period].close - 1;
    rs += weights[p] * (iRet !== 0 ? sRet / iRet : sRet);
  }
  return rs;
}

function computeBoxState(candles, boxTop, boxBottom) {
  const idx = lastIndex(candles);
  const close = candles[idx].close;
  const volumes = candles.map((c) => c.volume);
  const volAvg = computeSMA(volumes, 20);
  const rvol = volAvg[idx] > 0 ? volumes[idx] / volAvg[idx] : 1;

  if (candles.length >= 5) {
    const recent = candles.slice(-5);
    const wentOut = recent.some((c) => c.low < boxBottom);
    const backIn = close > boxBottom && close <= boxTop;
    if (wentOut && backIn) return { stage: 'SHAKEOUT', rvol };
  }
  if (close > boxTop && rvol >= 1.0) {
    if (detectShakeout(candles, boxTop, boxBottom)) return { stage: 'SUPER_TREND', rvol };
    return { stage: 'BREAKOUT', rvol };
  }
  if (close < boxBottom) return { stage: 'FAILED', rvol };
  if (close > boxBottom && close < boxTop) return { stage: 'ARMED', rvol };
  return { stage: 'FORMING', rvol };
}

function computeStops(candles, boxTop, boxBottom, style = 'swing', lollipopStop = null) {
  const emaPeriods = { very_short: 5, swing: 10, positional: 20, investor: 200 };
  const emaPeriod = emaPeriods[style] || 10;
  const ema = computeEMA(candles.map((c) => c.close), emaPeriod);
  const emaVal = ema[lastIndex(ema)];
  const candidates = {
    box_bottom: boxBottom * 0.995,
    pct_10: boxTop * 0.9,
    lollipop: lollipopStop,
    ema: emaVal,
  };
  const valid = Object.entries(candidates).filter(([, v]) => v != null);
  const primary = Math.max(...valid.map(([, v]) => v));
  const primaryKey = valid.find(([, v]) => v === primary)?.[0] || 'box_bottom';
  return {
    ...candidates,
    primary,
    primaryKey,
    riskPerShare: boxTop - primary,
  };
}

function scoreTier(score) {
  if (score >= 85) return 'A+';
  if (score >= 70) return 'A';
  if (score >= MIN_SCORE_DEFAULT) return 'B';
  return 'Skip';
}

function evaluateDarvaX(candles, { market = 'NSE', indexCandles = null, rsPercentile = 50, style = 'swing' } = {}) {
  const reasonsPass = [];
  const reasonsFail = [];
  const patterns = {};

  if (candles.length < 60) {
    return { qualifies: false, strengthScore: 0, reasonsFail: ['✗ Insufficient history (<60 bars)'] };
  }

  const lookback = Math.min(252, candles.length);
  const window = candles.slice(-lookback);
  const high52 = Math.max(...window.map((c) => c.high));
  const close = candles[lastIndex(candles)].close;
  const pctFromHigh = ((high52 - close) / high52) * 100;

  if (!passesPrefilter(candles, market)) {
    reasonsFail.push(`✗ Failed prefilter (${pctFromHigh.toFixed(1)}% from 52w high)`);
    return { qualifies: false, strengthScore: 0, reasonsPass, reasonsFail, pctFrom52wHigh: pctFromHigh };
  }
  reasonsPass.push(`✓ Within ${pctFromHigh.toFixed(1)}% of 52w high`);

  let score = 10;

  const rsPts = Math.min(20, rsPercentile * 0.2);
  score += rsPts;
  if (rsPercentile >= 80) reasonsPass.push(`✓ RS rank ${rsPercentile.toFixed(0)} — exceptional`);
  else if (rsPercentile >= 70) reasonsPass.push(`✓ RS rank ${rsPercentile.toFixed(0)} — above threshold`);
  else reasonsFail.push(`✗ RS rank ${rsPercentile.toFixed(0)} — need ≥70`);

  const topInfo = findBoxTop(candles);
  if (!topInfo) {
    reasonsFail.push('✗ No confirmed box top (3-day rule)');
    return { qualifies: false, strengthScore: score, reasonsPass, reasonsFail, pctFrom52wHigh: pctFromHigh };
  }

  const bottomInfo = findBoxBottom(candles, topInfo);
  if (!bottomInfo) {
    reasonsFail.push('✗ Box bottom not confirmed');
    return {
      qualifies: false,
      strengthScore: score,
      reasonsPass,
      reasonsFail,
      box: { top: topInfo.boxTop, bottom: null },
      pctFrom52wHigh: pctFromHigh,
      stage: 'FORMING',
    };
  }

  const boxTop = topInfo.boxTop;
  const boxBottom = bottomInfo.boxBottom;
  const metrics = boxMetrics(candles, boxTop, boxBottom, topInfo.topBar);
  let boxPts = 0;
  if (metrics.heightPct >= 3 && metrics.heightPct <= 12) boxPts += 3;
  if (metrics.heightToATR >= 1.5 && metrics.heightToATR <= 4) boxPts += 3;
  if (metrics.daysInBox >= 10 && metrics.daysInBox <= 40) boxPts += 4;
  score += boxPts;
  reasonsPass.push(`✓ Box: ${boxTop.toFixed(2)} / ${boxBottom.toFixed(2)} (${metrics.heightPct.toFixed(1)}%, ${metrics.daysInBox}d)`);

  const { stage, rvol } = computeBoxState(candles, boxTop, boxBottom);
  if (stage === 'BREAKOUT' || stage === 'SUPER_TREND') {
    if (rvol >= 1.5) {
      score += 10;
      reasonsPass.push(`✓ ${stage}: Close > box top, RVOL ${rvol.toFixed(1)}×`);
    } else {
      score += 4;
      reasonsFail.push(`✗ Breakout but RVOL ${rvol.toFixed(1)}× < 1.5×`);
    }
  } else if (stage === 'ARMED') {
    score += 3;
    reasonsPass.push(`~ Inside box — armed (RVOL ${rvol.toFixed(1)}×)`);
  } else if (stage === 'SHAKEOUT') {
    score += 8;
    reasonsPass.push('✓ Shakeout detected — watching for breakout');
    patterns.SHAKEOUT = true;
  } else if (stage === 'FAILED') {
    reasonsFail.push('✗ Close below box bottom');
  }

  const wy = wyckoffScore(candles, boxTop, boxBottom);
  score += wy.score;
  reasonsPass.push(...wy.reasons);

  if (detectBullRescue(candles, boxBottom)) {
    score += 5;
    patterns.BULL_RESCUE = true;
    reasonsPass.push('✓ Bull Rescue Candle at box floor');
  }
  if (detectRedIgnoredBar(candles)) {
    score += 5;
    patterns.RED_IGNORED = true;
    reasonsPass.push('✓ Red Ignored Bar — momentum continuation');
  }
  const lollipop = detectLollipop(candles);
  if (lollipop.isLollipop) {
    score += 5;
    patterns.LOLLIPOP = true;
    patterns.lollipop_sl = lollipop.stopLoss;
    reasonsPass.push(`✓ DarvaX Lollipop — SL ${lollipop.stopLoss.toFixed(2)}`);
  }
  if (detectShakeout(candles, boxTop, boxBottom)) {
    score += 5;
    patterns.SUPER_TREND = true;
    reasonsPass.push('✓ Shakeout + re-entry + breakout = SUPER TREND');
  }

  const gap = classifyGap(candles, boxTop, boxBottom);
  if (gap.type) {
    score += Math.max(gap.points, 0);
    if (gap.points > 0) reasonsPass.push(`✓ ${gap.type.replace(/_/g, ' ')}`);
    if (gap.points < 0) reasonsFail.push(`✗ ${gap.type.replace(/_/g, ' ')} — exit warning`);
    patterns.gap = gap.type;
  }

  const fib = fibStrength(candles, boxBottom, boxTop);
  score += Math.min(fib.points, 5);
  reasonsPass.push(fib.reason);

  const stops = computeStops(candles, boxTop, boxBottom, style, lollipop.stopLoss);
  const strengthScore = Math.min(Math.round(score), 100);
  const tier = scoreTier(strengthScore);
  const qualifies = strengthScore >= MIN_SCORE_DEFAULT && stage !== 'FAILED';

  let rsRaw = null;
  if (indexCandles && indexCandles.length > 63) {
    rsRaw = relativeStrengthReturn(candles, indexCandles);
  }

  return {
    qualifies,
    strengthScore,
    tier,
    stage,
    market,
    pctFrom52wHigh: pctFromHigh,
    rvol,
    rsPercentile,
    rsRaw,
    box: {
      top: boxTop,
      bottom: boxBottom,
      ...metrics,
    },
    levels: {
      entry: boxTop,
      stops,
    },
    patterns,
    reasonsPass,
    reasonsFail,
  };
}

module.exports = {
  evaluateDarvaX,
  findBoxTop,
  findBoxBottom,
  passesPrefilter,
  relativeStrengthReturn,
  computeBoxState,
  computeStops,
  MIN_SCORE_DEFAULT,
  BOX_LOOKBACK,
};
