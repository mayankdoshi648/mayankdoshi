import { SIGNAL_CONFIG, CAS_INTEL_CONFIG, RISK_CONFIG } from '../scoringConfig.js';
import type {
  CasIntelligenceResult,
  CasRiskResult,
  CasRiskLevel,
  CasSettlementState,
  FactorContribution,
  MarketDirectionState,
  MarketStateResult,
  SignalScoreResult,
} from '../types.js';
import { clamp, roundTo } from '../calc/marketMath.js';

function labelSignal(score: number): string {
  if (score >= 4) return 'STRONG BULLISH';
  if (score >= SIGNAL_CONFIG.strongThreshold) return 'BULLISH';
  if (score >= SIGNAL_CONFIG.moderateThreshold) return 'MILDLY BULLISH';
  if (score <= -4) return 'STRONG BEARISH';
  if (score <= -SIGNAL_CONFIG.strongThreshold) return 'BEARISH';
  if (score <= -SIGNAL_CONFIG.moderateThreshold) return 'MILDLY BEARISH';
  return 'NEUTRAL';
}

function casStateFromScore(score: number): CasSettlementState {
  if (Math.abs(score) < 1.2) return 'PINNING / MAGNET';
  if (score >= 3) return 'UPWARD SETTLEMENT PRESSURE';
  if (score <= -3) return 'DOWNWARD SETTLEMENT PRESSURE';
  if (Math.abs(score) >= 4) return 'BREAKOUT / DISLOCATION RISK';
  return 'HIGH UNCERTAINTY';
}

export interface MarketStateInput {
  spot: number | null;
  vwap: number | null;
  referenceVwap: number | null;
  basis: number | null;
  basisExpanding: boolean | null;
  momentum: number | null;
  callWall: number | null;
  putWall: number | null;
  ivHigh: boolean | null;
}

export function computeMarketState(input: MarketStateInput): MarketStateResult {
  const factors: FactorContribution[] = [];
  let score = 0;
  let wSum = 0;

  const add = (
    name: string,
    weight: number,
    raw: number | string | null,
    s: number | null,
    note: string,
  ) => {
    const available = s != null;
    factors.push({ name, weight, rawValue: raw, score: s ?? 0, note, available });
    if (available) {
      score += s! * weight;
      wSum += weight;
    }
  };

  if (input.spot != null && input.vwap != null) {
    add(
      'Price vs VWAP',
      0.25,
      roundTo(input.spot - input.vwap),
      clamp((input.spot - input.vwap) / input.spot / 0.002, -1, 1),
      'Spot relative to session VWAP',
    );
  } else add('Price vs VWAP', 0.25, null, null, 'Unavailable');

  if (input.spot != null && input.referenceVwap != null) {
    add(
      'Price vs Reference VWAP',
      0.2,
      roundTo(input.spot - input.referenceVwap),
      clamp((input.spot - input.referenceVwap) / input.spot / 0.002, -1, 1),
      'Spot vs 15:00–15:15 reference',
    );
  } else add('Price vs Reference VWAP', 0.2, null, null, 'Unavailable');

  if (input.basis != null && input.spot != null) {
    add(
      'Futures basis',
      0.2,
      roundTo(input.basis),
      clamp(input.basis / (input.spot * 0.001), -1, 1),
      input.basisExpanding ? 'Basis expanding' : 'Basis level',
    );
  } else add('Futures basis', 0.2, null, null, 'Unavailable');

  add('Momentum', 0.2, input.momentum, input.momentum, 'Intraday momentum proxy');
  add(
    'IV regime',
    0.15,
    input.ivHigh == null ? null : input.ivHigh ? 'HIGH' : 'NORMAL',
    input.ivHigh == null ? null : input.ivHigh ? 0 : 0.1,
    'High IV → prefer NO EDGE / HIGH VOLATILITY',
  );

  const net = wSum > 0 ? score / wSum : 0;
  const confidence = clamp(
    Math.round((factors.filter((f) => f.available).length / factors.length) * 100),
    0,
    100,
  );

  let state: MarketDirectionState = 'NO EDGE';
  if (input.ivHigh) state = 'HIGH VOLATILITY';
  else if (Math.abs(net) < 0.15 && input.callWall != null && input.putWall != null) state = 'RANGE / PIN';
  else if (Math.abs(net) >= 0.55) state = net > 0 ? 'TREND UP' : 'TREND DOWN';
  else if (Math.abs(net) >= 0.35) state = 'BREAKOUT RISK';

  return {
    state,
    confidence,
    factors,
    explanation: [
      `Market direction state: ${state}`,
      `Composite factor score: ${roundTo(net, 3)} (independent of CAS settlement state)`,
      ...factors.filter((f) => f.available).map((f) => `${f.name}: ${f.rawValue} → score ${roundTo(f.score, 2)}`),
    ],
  };
}

export interface CasIntelInput {
  spot: number | null;
  referenceVwap: number | null;
  maxPain: number | null;
  callWall: number | null;
  putWall: number | null;
  basis: number | null;
  pcrOi: number | null;
  oiMagnetScore: number | null;
  lockedDirectional: boolean;
}

export function computeCasIntelligence(input: CasIntelInput): CasIntelligenceResult {
  const w = CAS_INTEL_CONFIG.weights;
  const factors: FactorContribution[] = [];
  let acc = 0;
  let wSum = 0;

  const add = (
    name: string,
    weight: number,
    raw: number | string | null,
    s: number | null,
    note: string,
  ) => {
    const available = s != null;
    factors.push({ name, weight, rawValue: raw, score: s ?? 0, note, available });
    if (available) {
      acc += s! * weight;
      wSum += weight;
    }
  };

  if (input.spot != null && input.referenceVwap != null) {
    add(
      'Reference VWAP pull',
      w.refVwapPull,
      roundTo(input.referenceVwap - input.spot),
      clamp((input.referenceVwap - input.spot) / input.spot / 0.0015, -1, 1),
      'Pull toward reference VWAP',
    );
  } else add('Reference VWAP pull', w.refVwapPull, null, null, 'Unavailable');

  add('OI magnet', w.oiMagnet, input.oiMagnetScore, input.oiMagnetScore, 'Strike OI magnet vs spot');

  if (input.basis != null && input.spot != null) {
    add(
      'Basis pressure',
      w.basisPressure,
      roundTo(input.basis),
      clamp(input.basis / (input.spot * 0.001), -1, 1),
      'Futures premium/discount pressure',
    );
  } else add('Basis pressure', w.basisPressure, null, null, 'Unavailable');

  if (input.spot != null && input.maxPain != null) {
    add(
      'Max Pain pull',
      w.maxPainPull,
      input.maxPain,
      clamp((input.maxPain - input.spot) / input.spot / 0.002, -1, 1),
      'Max Pain is ONE input only',
    );
  } else add('Max Pain pull', w.maxPainPull, null, null, 'Unavailable');

  if (input.spot != null && input.callWall != null && input.putWall != null) {
    const mid = (input.callWall + input.putWall) / 2;
    add(
      'Wall skew',
      w.wallSkew,
      mid,
      clamp((mid - input.spot) / input.spot / 0.002, -1, 1),
      'Call/Put wall midpoint skew',
    );
  } else add('Wall skew', w.wallSkew, null, null, 'Unavailable');

  if (input.pcrOi != null) {
    add('PCR', w.pcr, roundTo(input.pcrOi, 3), clamp(input.pcrOi - 1, -1, 1), 'Contextual only');
  } else add('PCR', w.pcr, null, null, 'Unavailable');

  const net = wSum > 0 ? acc / wSum : 0;
  const score = roundTo(clamp(net * 5, -5, 5), 1);
  const confidence = clamp(
    Math.round((factors.filter((f) => f.available).length / factors.length) * 100),
    0,
    100,
  );

  return {
    score,
    state: casStateFromScore(score),
    confidence,
    factors,
    lockedDirectional: input.lockedDirectional,
    explanation: [
      `CAS Intelligence: ${score} → ${casStateFromScore(score)}`,
      `Confidence: ${confidence}%`,
      'This score is independent of Market Direction state.',
      ...factors.filter((f) => f.available).map((f) => `✓ ${f.name}: ${f.rawValue}`),
    ],
  };
}

export interface SignalInput {
  locked: boolean;
  lockReason?: string;
  spot: number | null;
  vwap: number | null;
  referenceVwap: number | null;
  basis: number | null;
  basisWeakening: boolean | null;
  momentum: number | null;
  callWall: number | null;
  putWall: number | null;
  oiChangePressure: number | null;
  pcrOi: number | null;
}

export function computeSignalScore(input: SignalInput): SignalScoreResult {
  if (input.locked) {
    return {
      score: null,
      label: 'CAS ACTIVE — SIGNALS LOCKED',
      locked: true,
      lockReason:
        input.lockReason ??
        'Directional signals suppressed during CAS / settlement-only phases',
      factors: [],
      explanation: [
        'CAS ACTIVE',
        'Normal directional signals are locked.',
        'Use Settlement Zone, CAS Intelligence, walls, and risk instead.',
      ],
    };
  }

  const w = SIGNAL_CONFIG.weights;
  const factors: FactorContribution[] = [];
  let acc = 0;
  let wSum = 0;

  const add = (
    name: string,
    weight: number,
    raw: number | string | null,
    s: number | null,
    note: string,
  ) => {
    const available = s != null;
    factors.push({ name, weight, rawValue: raw, score: s ?? 0, note, available });
    if (available) {
      acc += s! * weight;
      wSum += weight;
    }
  };

  if (input.spot != null && input.vwap != null) {
    add(
      'Spot vs VWAP',
      w.priceVsVwap,
      roundTo(input.spot - input.vwap),
      clamp((input.spot - input.vwap) / input.spot / 0.002, -1, 1),
      '',
    );
  } else add('Spot vs VWAP', w.priceVsVwap, null, null, 'Unavailable');

  if (input.spot != null && input.referenceVwap != null) {
    add(
      'Spot vs Reference VWAP',
      w.priceVsRefVwap,
      roundTo(input.spot - input.referenceVwap),
      clamp((input.spot - input.referenceVwap) / input.spot / 0.002, -1, 1),
      '',
    );
  } else add('Spot vs Reference VWAP', w.priceVsRefVwap, null, null, 'Unavailable');

  if (input.basis != null && input.spot != null) {
    let s = clamp(input.basis / (input.spot * 0.001), -1, 1);
    if (input.basisWeakening) s *= 0.5;
    add('Basis', w.basis, roundTo(input.basis), s, input.basisWeakening ? 'Weakening' : 'Stable/expanding');
  } else add('Basis', w.basis, null, null, 'Unavailable');

  add('Momentum', w.momentum, input.momentum, input.momentum, '');
  add('OI change', w.oiChange, input.oiChangePressure, input.oiChangePressure, '');

  if (input.pcrOi != null) {
    add('PCR', w.pcr, roundTo(input.pcrOi, 3), clamp(input.pcrOi - 1, -1, 1), '');
  } else add('PCR', w.pcr, null, null, 'Unavailable');

  if (input.spot != null && input.callWall != null && input.putWall != null) {
    const distCall = input.callWall - input.spot;
    const distPut = input.spot - input.putWall;
    add(
      'Wall asymmetry',
      w.oiWalls,
      `${input.putWall}/${input.callWall}`,
      clamp((distPut - distCall) / input.spot / 0.002, -1, 1),
      '',
    );
  } else add('Wall asymmetry', w.oiWalls, null, null, 'Unavailable');

  const net = wSum > 0 ? acc / wSum : 0;
  const score = roundTo(clamp(net * 5, -5, 5), 1);
  return {
    score,
    label: labelSignal(score),
    locked: false,
    factors,
    explanation: [
      `SIGNAL: ${score} ${labelSignal(score)}`,
      'Analytics signal only — not an order instruction.',
      ...factors.filter((f) => f.available).map((f) => `✓ ${f.name}: ${f.rawValue}`),
    ],
  };
}

export interface RiskInput {
  isExpiryDay: boolean;
  iv: number | null;
  spotFuturesDivergencePct: number | null;
  distanceFromRefPct: number | null;
  oiConcentration: number | null;
  nearWall: boolean | null;
  rapidOiChange: boolean | null;
  ivExpanding: boolean | null;
  dataQuality: number;
  timestampMismatch: boolean;
}

export function computeCasRisk(input: RiskInput): CasRiskResult {
  const w = RISK_CONFIG.weights;
  const factors: string[] = [];
  let score = 0;

  if (input.isExpiryDay) {
    factors.push('Expiry day');
    score += w.expiry * RISK_CONFIG.expiryDayBoost;
  }
  if (input.iv != null && input.iv >= RISK_CONFIG.highVolIvThreshold) {
    factors.push(`Elevated IV (${input.iv})`);
    score += w.volatility;
  }
  if (input.ivExpanding) {
    factors.push('IV expanding');
    score += w.volatility * 0.5;
  }
  if (
    input.spotFuturesDivergencePct != null &&
    Math.abs(input.spotFuturesDivergencePct) >= RISK_CONFIG.divergenceHighPct
  ) {
    factors.push(`Spot/futures divergence ${input.spotFuturesDivergencePct.toFixed(2)}%`);
    score += w.divergence;
  }
  if (input.distanceFromRefPct != null && Math.abs(input.distanceFromRefPct) >= 0.2) {
    factors.push(`Distance from reference VWAP ${input.distanceFromRefPct.toFixed(2)}%`);
    score += w.distanceFromRef;
  }
  if (input.oiConcentration != null && input.oiConcentration >= 0.35) {
    factors.push('Concentrated OI');
    score += w.oiConcentration;
  }
  if (input.nearWall) {
    factors.push('Proximity to major OI wall');
    score += w.wallProximity;
  }
  if (input.rapidOiChange) {
    factors.push('Rapid OI changes');
    score += 0.1;
  }
  if (input.dataQuality < 0.6) {
    factors.push('Weak data quality');
    score += w.dataQuality;
  }
  if (input.timestampMismatch) {
    factors.push('Timestamp misalignment');
    score += w.dataQuality;
  }

  score = clamp(score, 0, 2);
  let level: CasRiskLevel = 'LOW';
  if (score >= 1.4) level = 'EXTREME';
  else if (score >= 0.9) level = 'HIGH';
  else if (score >= 0.45) level = 'MEDIUM';

  return {
    level,
    score: Math.round(score * 100) / 100,
    factors,
    explanation: factors.length
      ? [`CAS RISK: ${level}`, ...factors.map((f) => `✓ ${f}`)]
      : [`CAS RISK: ${level}`, 'No elevated risk factors detected from available data'],
  };
}
