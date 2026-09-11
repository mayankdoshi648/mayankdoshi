'use strict';

const NEUTRAL_THRESHOLD = 0.05;

/**
 * Transparent weighted methodology for buildup score (-100..+100).
 * Weights sum to 100.
 */
const WEIGHTS = Object.freeze({
  priceChangePct: 20,
  oiChangePct: 20,
  relativeVolume: 15,
  vwapRelation: 15,
  ivChangePct: 10,
  pcr: 10,
  sectorReturnPct: 5,
  marketRegimeScore: 5,
});

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Classify OI buildup from price and OI % changes.
 * Neutral if either abs change < 0.05.
 */
function classifyBuildup({ priceChangePct, oiChangePct } = {}) {
  if (!isFiniteNumber(priceChangePct) || !isFiniteNumber(oiChangePct)) {
    return 'NEUTRAL';
  }
  if (Math.abs(priceChangePct) < NEUTRAL_THRESHOLD || Math.abs(oiChangePct) < NEUTRAL_THRESHOLD) {
    return 'NEUTRAL';
  }
  const priceUp = priceChangePct > 0;
  const oiUp = oiChangePct > 0;
  if (priceUp && oiUp) return 'LONG_BUILDUP';
  if (!priceUp && oiUp) return 'SHORT_BUILDUP';
  if (priceUp && !oiUp) return 'SHORT_COVERING';
  return 'LONG_UNWINDING';
}

/**
 * Compute a transparent weighted buildup score in [-100, +100].
 * Positive leans long/bullish; negative leans short/bearish.
 */
function computeBuildupScore(inputs = {}) {
  const {
    priceChangePct,
    oiChangePct,
    relativeVolume,
    vwapRelation,
    ivChangePct,
    pcr,
    sectorReturnPct,
    marketRegimeScore,
  } = inputs || {};

  const classification = classifyBuildup({ priceChangePct, oiChangePct });
  let raw = 0;
  let usedWeight = 0;

  if (isFiniteNumber(priceChangePct)) {
    const dir =
      classification === 'LONG_BUILDUP' || classification === 'SHORT_COVERING'
        ? 1
        : classification === 'SHORT_BUILDUP' || classification === 'LONG_UNWINDING'
          ? -1
          : Math.sign(priceChangePct);
    const mag = clamp(Math.abs(priceChangePct) / 2, 0, 1);
    raw += WEIGHTS.priceChangePct * dir * mag;
    usedWeight += WEIGHTS.priceChangePct;
  }

  if (isFiniteNumber(oiChangePct)) {
    // OI rise amplifies the price-driven direction; OI fall dampens / reverses mildly
    const dir =
      classification === 'LONG_BUILDUP' || classification === 'SHORT_COVERING'
        ? 1
        : classification === 'SHORT_BUILDUP' || classification === 'LONG_UNWINDING'
          ? -1
          : 0;
    const mag = clamp(Math.abs(oiChangePct) / 5, 0, 1);
    const strength =
      classification === 'LONG_BUILDUP' || classification === 'SHORT_BUILDUP' ? 1 : 0.7;
    raw += WEIGHTS.oiChangePct * dir * mag * strength;
    usedWeight += WEIGHTS.oiChangePct;
  }

  if (isFiniteNumber(relativeVolume)) {
    const dir =
      classification === 'LONG_BUILDUP' || classification === 'SHORT_COVERING'
        ? 1
        : classification === 'SHORT_BUILDUP' || classification === 'LONG_UNWINDING'
          ? -1
          : 0;
    const rvolFactor = clamp((relativeVolume - 1) / 2, 0, 1);
    raw += WEIGHTS.relativeVolume * dir * rvolFactor;
    usedWeight += WEIGHTS.relativeVolume;
  }

  if (vwapRelation === 'above' || vwapRelation === 'below' || vwapRelation === 'at') {
    const vwapScore = vwapRelation === 'above' ? 1 : vwapRelation === 'below' ? -1 : 0;
    raw += WEIGHTS.vwapRelation * vwapScore;
    usedWeight += WEIGHTS.vwapRelation;
  }

  if (isFiniteNumber(ivChangePct)) {
    // IV expansion: mild risk-off; IV crush: mild risk-on
    raw += WEIGHTS.ivChangePct * (-clamp(ivChangePct / 5, -1, 1));
    usedWeight += WEIGHTS.ivChangePct;
  }

  if (isFiniteNumber(pcr)) {
    let pcrScore = 0;
    if (pcr >= 1.2) pcrScore = 1;
    else if (pcr >= 1.0) pcrScore = 0.5;
    else if (pcr <= 0.6) pcrScore = -1;
    else if (pcr <= 0.8) pcrScore = -0.5;
    raw += WEIGHTS.pcr * pcrScore;
    usedWeight += WEIGHTS.pcr;
  }

  if (isFiniteNumber(sectorReturnPct)) {
    raw += WEIGHTS.sectorReturnPct * clamp(sectorReturnPct / 2, -1, 1);
    usedWeight += WEIGHTS.sectorReturnPct;
  }

  if (isFiniteNumber(marketRegimeScore)) {
    raw += WEIGHTS.marketRegimeScore * clamp((marketRegimeScore - 50) / 50, -1, 1);
    usedWeight += WEIGHTS.marketRegimeScore;
  }

  if (usedWeight === 0) return 0;

  const maxPossible = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
  const score = (raw / maxPossible) * 100;
  return clamp(Math.round(score * 10) / 10, -100, 100);
}

/**
 * Explain buildup classification and score with human-readable reasons.
 */
function explainBuildup(inputs = {}) {
  const classification = classifyBuildup(inputs);
  const score = computeBuildupScore(inputs);
  const why = [];
  const { priceChangePct, oiChangePct, relativeVolume, vwapRelation, ivChangePct, pcr } =
    inputs || {};

  if (isFiniteNumber(priceChangePct) && isFiniteNumber(oiChangePct)) {
    why.push(
      `Price ${priceChangePct >= 0 ? '+' : ''}${priceChangePct.toFixed(2)}% with OI ${oiChangePct >= 0 ? '+' : ''}${oiChangePct.toFixed(2)}% → ${classification}`
    );
  } else {
    why.push('Insufficient price/OI data — classification NEUTRAL');
  }

  if (isFiniteNumber(relativeVolume)) {
    why.push(`Relative volume ${relativeVolume.toFixed(2)}x`);
  }
  if (vwapRelation) {
    why.push(`Price is ${vwapRelation} VWAP`);
  }
  if (isFiniteNumber(ivChangePct)) {
    why.push(`IV change ${ivChangePct >= 0 ? '+' : ''}${ivChangePct.toFixed(2)}%`);
  }
  if (isFiniteNumber(pcr)) {
    why.push(`PCR ${pcr.toFixed(3)}`);
  }
  why.push(`Weighted score ${score} (weights: ${JSON.stringify(WEIGHTS)})`);

  return { classification, score, why };
}

module.exports = {
  WEIGHTS,
  classifyBuildup,
  computeBuildupScore,
  explainBuildup,
  NEUTRAL_THRESHOLD,
};
