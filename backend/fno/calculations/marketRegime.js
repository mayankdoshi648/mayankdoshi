'use strict';

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

const FACTOR_DEFS = [
  {
    name: 'priceVsVwap',
    maxPoints: 12,
    score(v) {
      if (v === 'above') return { contribution: 12, evidence: 'Price above VWAP' };
      if (v === 'below') return { contribution: 0, evidence: 'Price below VWAP' };
      if (v === 'at') return { contribution: 6, evidence: 'Price at VWAP' };
      if (isFiniteNumber(v)) {
        if (v > 0.1) return { contribution: 12, evidence: `Price ${v.toFixed(2)}% above VWAP` };
        if (v < -0.1) return { contribution: 0, evidence: `Price ${Math.abs(v).toFixed(2)}% below VWAP` };
        return { contribution: 6, evidence: 'Price near VWAP' };
      }
      return null;
    },
  },
  {
    name: 'priceVsEma20',
    maxPoints: 10,
    score(v) {
      if (v === 'above' || v === true) return { contribution: 10, evidence: 'Price above EMA20' };
      if (v === 'below' || v === false) return { contribution: 0, evidence: 'Price below EMA20' };
      if (isFiniteNumber(v)) {
        if (v > 0) return { contribution: 10, evidence: `Price ${v.toFixed(2)}% above EMA20` };
        if (v < 0) return { contribution: 0, evidence: `Price ${Math.abs(v).toFixed(2)}% below EMA20` };
        return { contribution: 5, evidence: 'Price at EMA20' };
      }
      return null;
    },
  },
  {
    name: 'priceVsEma50',
    maxPoints: 10,
    score(v) {
      if (v === 'above' || v === true) return { contribution: 10, evidence: 'Price above EMA50' };
      if (v === 'below' || v === false) return { contribution: 0, evidence: 'Price below EMA50' };
      if (isFiniteNumber(v)) {
        if (v > 0) return { contribution: 10, evidence: `Price ${v.toFixed(2)}% above EMA50` };
        if (v < 0) return { contribution: 0, evidence: `Price ${Math.abs(v).toFixed(2)}% below EMA50` };
        return { contribution: 5, evidence: 'Price at EMA50' };
      }
      return null;
    },
  },
  {
    name: 'breadthPctAbove50',
    maxPoints: 12,
    score(v) {
      if (!isFiniteNumber(v)) return null;
      const contribution = clamp((v / 100) * 12, 0, 12);
      return {
        contribution,
        evidence: `${v.toFixed(1)}% of stocks above 50-DMA`,
      };
    },
  },
  {
    name: 'advanceDeclineRatio',
    maxPoints: 10,
    score(v) {
      if (!isFiniteNumber(v)) return null;
      // 1.0 = neutral (5 pts); >=2 bullish max; <=0.5 bearish min
      let contribution;
      if (v >= 2) contribution = 10;
      else if (v <= 0.5) contribution = 0;
      else if (v >= 1) contribution = 5 + ((v - 1) / 1) * 5;
      else contribution = ((v - 0.5) / 0.5) * 5;
      return {
        contribution: clamp(contribution, 0, 10),
        evidence: `A/D ratio ${v.toFixed(2)}`,
      };
    },
  },
  {
    name: 'fiiNetFutures',
    maxPoints: 12,
    score(v) {
      if (!isFiniteNumber(v)) return null;
      // Positive net = bullish. Scale around ±2000 cr-ish units loosely
      const contribution = clamp(6 + (v / 2000) * 6, 0, 12);
      return {
        contribution,
        evidence: `FII net futures ${v >= 0 ? '+' : ''}${v}`,
      };
    },
  },
  {
    name: 'pcr',
    maxPoints: 10,
    score(v) {
      if (!isFiniteNumber(v)) return null;
      let contribution;
      if (v >= 1.3) contribution = 10;
      else if (v >= 1.0) contribution = 7;
      else if (v >= 0.8) contribution = 5;
      else if (v >= 0.6) contribution = 2;
      else contribution = 0;
      return { contribution, evidence: `PCR ${v.toFixed(3)}` };
    },
  },
  {
    name: 'oiBuildupBias',
    maxPoints: 10,
    score(v) {
      if (typeof v === 'string') {
        const map = {
          LONG_BUILDUP: 10,
          SHORT_COVERING: 8,
          NEUTRAL: 5,
          LONG_UNWINDING: 2,
          SHORT_BUILDUP: 0,
        };
        if (!(v in map)) return null;
        return { contribution: map[v], evidence: `OI buildup bias ${v}` };
      }
      if (isFiniteNumber(v)) {
        // Support -1..+1 bias or -100..+100 score
        let contribution;
        if (Math.abs(v) <= 1) {
          contribution = clamp(((v + 1) / 2) * 10, 0, 10);
        } else {
          contribution = clamp(((v + 100) / 200) * 10, 0, 10);
        }
        return { contribution, evidence: `OI buildup bias score ${v}` };
      }
      return null;
    },
  },
  {
    name: 'indiaVix',
    maxPoints: 8,
    score(v) {
      if (!isFiniteNumber(v)) return null;
      // Lower VIX = more bullish comfort. VIX 12 → 8, VIX 20 → 4, VIX 28+ → 0
      let contribution;
      if (v <= 12) contribution = 8;
      else if (v >= 28) contribution = 0;
      else contribution = 8 - ((v - 12) / 16) * 8;
      return {
        contribution: clamp(contribution, 0, 8),
        evidence: `India VIX ${v.toFixed(2)}`,
      };
    },
  },
  {
    name: 'momentumScore',
    maxPoints: 6,
    score(v) {
      if (!isFiniteNumber(v)) return null;
      // Assume 0-100 momentum, or -100..+100
      let contribution;
      if (v >= 0 && v <= 100) {
        contribution = (v / 100) * 6;
      } else {
        contribution = clamp(((v + 100) / 200) * 6, 0, 6);
      }
      return {
        contribution,
        evidence: `Momentum score ${v}`,
      };
    },
  },
];

function labelFromScore(score) {
  if (score >= 75) return 'STRONG_BULLISH';
  if (score >= 60) return 'BULLISH';
  if (score >= 40) return 'NEUTRAL';
  if (score >= 25) return 'BEARISH';
  return 'STRONG_BEARISH';
}

/**
 * Aggregate multi-factor market regime score 0-100.
 * Missing factors are skipped (not fabricated); confidence = present/total.
 */
function computeMarketRegime(inputs = {}) {
  if (!inputs || typeof inputs !== 'object') {
    return {
      label: 'NEUTRAL',
      score: 50,
      confidence: 0,
      factors: [],
    };
  }

  const factors = [];
  let earned = 0;
  let possible = 0;
  let present = 0;

  for (const def of FACTOR_DEFS) {
    const raw = inputs[def.name];
    if (raw === null || raw === undefined || raw === '') continue;
    const scored = def.score(raw);
    if (!scored) continue;
    present += 1;
    possible += def.maxPoints;
    earned += scored.contribution;
    factors.push({
      name: def.name,
      value: raw,
      contribution: Math.round(scored.contribution * 100) / 100,
      evidence: scored.evidence,
    });
  }

  const confidence = present / FACTOR_DEFS.length;
  let score;
  if (possible === 0) {
    score = 50;
  } else {
    score = Math.round((earned / possible) * 1000) / 10;
  }
  score = clamp(score, 0, 100);

  return {
    label: labelFromScore(score),
    score,
    confidence: Math.round(confidence * 1000) / 1000,
    factors,
  };
}

module.exports = {
  computeMarketRegime,
  FACTOR_DEFS,
  labelFromScore,
};
