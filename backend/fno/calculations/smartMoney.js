'use strict';

const { classifyBuildup, computeBuildupScore } = require('./oiBuildup');

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

const DISCLAIMER =
  'PROXY based on market behaviour — does not identify actual institutional trades';

/**
 * Smart-money PROXY from observable market behaviour.
 * @param {object} instrument
 * @param {object} [context]
 */
function computeSmartMoneyProxy(instrument = {}, context = {}) {
  const signals = [];
  const why = [];
  let score = 0;

  if (!instrument || typeof instrument !== 'object') {
    return { score: 0, signals: [], why: ['No instrument data'], disclaimer: DISCLAIMER };
  }

  const priceChangePct = instrument.priceChangePct ?? instrument.pricePct;
  const oiChangePct = instrument.oiChangePct ?? instrument.oiPct;
  const relativeVolume = instrument.relativeVolume ?? instrument.rvol ?? context.relativeVolume;
  const oiChange = instrument.oiChange ?? context.oiChange;
  const ivChangePct = instrument.ivChangePct ?? context.ivChangePct;
  const vwapRelation = instrument.vwapRelation ?? context.vwapRelation;
  const callOi = instrument.callOi ?? context.callOi;
  const putOi = instrument.putOi ?? context.putOi;
  const pcr = instrument.pcr ?? context.pcr;
  const sectorReturnPct = instrument.sectorReturnPct ?? context.sectorReturnPct;

  const classification = classifyBuildup({ priceChangePct, oiChangePct });
  const buildupScore = computeBuildupScore({
    priceChangePct,
    oiChangePct,
    relativeVolume,
    vwapRelation,
    ivChangePct,
    pcr,
    sectorReturnPct,
    marketRegimeScore: context.marketRegimeScore ?? instrument.marketRegimeScore,
  });

  const strongPrice = isFiniteNumber(priceChangePct) && Math.abs(priceChangePct) >= 0.5;
  const strongOi = isFiniteNumber(oiChangePct) && Math.abs(oiChangePct) >= 3;

  if (classification === 'LONG_BUILDUP' && strongPrice && strongOi) {
    signals.push('STRONG_LONG_BUILDUP');
    why.push(`Price ${priceChangePct}% with OI ${oiChangePct}% → STRONG_LONG_BUILDUP`);
    score += 35;
  } else if (classification === 'SHORT_BUILDUP' && strongPrice && strongOi) {
    signals.push('STRONG_SHORT_BUILDUP');
    why.push(`Price ${priceChangePct}% with OI ${oiChangePct}% → STRONG_SHORT_BUILDUP`);
    score -= 35;
  } else if (classification === 'SHORT_COVERING' && strongPrice && strongOi) {
    signals.push('STRONG_SHORT_COVERING');
    why.push(`Price ${priceChangePct}% with OI ${oiChangePct}% → STRONG_SHORT_COVERING`);
    score += 25;
  } else if (classification === 'LONG_UNWINDING' && strongPrice && strongOi) {
    signals.push('STRONG_LONG_UNWINDING');
    why.push(`Price ${priceChangePct}% with OI ${oiChangePct}% → STRONG_LONG_UNWINDING`);
    score -= 25;
  } else if (classification !== 'NEUTRAL') {
    why.push(`Buildup ${classification} (not strong enough for STRONG_* flag)`);
    score += buildupScore * 0.2;
  }

  if (isFiniteNumber(relativeVolume) && relativeVolume >= 2) {
    signals.push('UNUSUAL_VOLUME');
    why.push(`Unusual volume: ${relativeVolume.toFixed(2)}x average`);
    score += Math.sign(buildupScore || priceChangePct || 0) * 15;
  }

  const oiUnusual =
    (isFiniteNumber(oiChangePct) && Math.abs(oiChangePct) >= 8) ||
    (isFiniteNumber(oiChange) && Math.abs(oiChange) >= 500000);
  if (oiUnusual) {
    signals.push('UNUSUAL_OI');
    why.push(
      isFiniteNumber(oiChangePct)
        ? `Unusual OI change: ${oiChangePct}%`
        : `Unusual OI absolute change: ${oiChange}`
    );
    score += Math.sign(oiChangePct || oiChange || 0) * Math.sign(priceChangePct || 1) * 10;
  }

  if (isFiniteNumber(ivChangePct)) {
    if (ivChangePct >= 5) {
      signals.push('IV_EXPANSION');
      why.push(`IV expansion ${ivChangePct.toFixed(2)}%`);
      score -= 10;
    } else if (ivChangePct <= -5) {
      signals.push('IV_CRUSH');
      why.push(`IV crush ${ivChangePct.toFixed(2)}%`);
      score += 5;
    }
  }

  if (vwapRelation === 'above' && isFiniteNumber(priceChangePct) && priceChangePct > 0) {
    signals.push('VWAP_BREAKOUT');
    why.push('Price above VWAP with positive change — VWAP breakout proxy');
    score += 15;
  } else if (vwapRelation === 'below' && isFiniteNumber(priceChangePct) && priceChangePct < 0) {
    signals.push('VWAP_BREAKDOWN');
    why.push('Price below VWAP with negative change — VWAP breakdown proxy');
    score -= 15;
  }

  if (isFiniteNumber(callOi) && isFiniteNumber(putOi) && callOi + putOi > 0) {
    const imbalance = (putOi - callOi) / (putOi + callOi);
    if (Math.abs(imbalance) >= 0.25) {
      signals.push('OPTION_CHAIN_IMBALANCE');
      why.push(
        imbalance > 0
          ? `Put-heavy chain imbalance ${(imbalance * 100).toFixed(1)}%`
          : `Call-heavy chain imbalance ${(Math.abs(imbalance) * 100).toFixed(1)}%`
      );
      score += imbalance > 0 ? 10 : -10;
    }
  } else if (isFiniteNumber(pcr)) {
    if (pcr >= 1.5 || pcr <= 0.5) {
      signals.push('OPTION_CHAIN_IMBALANCE');
      why.push(`PCR extreme at ${pcr.toFixed(3)}`);
      score += pcr >= 1.5 ? 10 : -10;
    }
  }

  // Blend in mild buildup score influence when no strong signals
  if (signals.length === 0 && isFiniteNumber(buildupScore)) {
    score += buildupScore * 0.3;
    why.push(`No strong smart-money flags; mild buildup score influence ${buildupScore}`);
  }

  score = Math.max(-100, Math.min(100, Math.round(score * 10) / 10));

  return {
    score,
    signals,
    why,
    disclaimer: DISCLAIMER,
  };
}

module.exports = {
  computeSmartMoneyProxy,
  DISCLAIMER,
};
