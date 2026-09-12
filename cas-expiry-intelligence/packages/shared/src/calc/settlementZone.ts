import { SETTLEMENT_CONFIG } from '../scoringConfig.js';
import type { FactorContribution, SettlementZoneResult } from '../types.js';
import { clamp, roundTo } from './marketMath.js';

export interface SettlementInput {
  spot: number | null;
  futures: number | null;
  basis: number | null;
  referenceVwap: number | null;
  maxPain: number | null;
  callWall: number | null;
  putWall: number | null;
  pcrOi: number | null;
  oiChangePressure: number | null;
  ivScore: number | null;
}

/**
 * Settlement Zone Engine — weighted multi-factor model.
 * Max Pain is ONE input, never treated as the settlement price.
 */
export function computeSettlementZone(input: SettlementInput): SettlementZoneResult {
  const w = SETTLEMENT_CONFIG.weights;
  const factors: FactorContribution[] = [];

  const anchors: { name: string; weight: number; value: number | null; note: string }[] = [
    {
      name: 'Reference VWAP',
      weight: w.referenceVwap,
      value: input.referenceVwap,
      note: '15:00–15:15 IST reference window VWAP when available',
    },
    {
      name: 'Spot / Futures mid',
      weight: w.spotFuturesPositioning,
      value:
        input.spot != null && input.futures != null
          ? (input.spot + input.futures) / 2
          : (input.spot ?? input.futures),
      note: 'Blended spot/futures positioning',
    },
    {
      name: 'OI walls mid',
      weight: w.oiWalls,
      value:
        input.callWall != null && input.putWall != null
          ? (input.callWall + input.putWall) / 2
          : null,
      note: 'Midpoint of call wall and put wall',
    },
    {
      name: 'Max Pain',
      weight: w.maxPain,
      value: input.maxPain,
      note: 'ONE input only — not the settlement price',
    },
  ];

  let weightSum = 0;
  let weighted = 0;

  for (const a of anchors) {
    const available = a.value != null && Number.isFinite(a.value);
    const score =
      available && input.spot
        ? clamp((a.value! - input.spot) / (input.spot * 0.01), -1, 1)
        : 0;
    factors.push({
      name: a.name,
      weight: a.weight,
      rawValue: a.value,
      score,
      note: a.note,
      available,
    });
    if (available) {
      weighted += a.value! * a.weight;
      weightSum += a.weight;
    }
  }

  if (input.oiChangePressure != null && input.spot != null) {
    const nudge = input.oiChangePressure * input.spot * 0.0005;
    factors.push({
      name: 'OI change pressure',
      weight: w.oiChange,
      rawValue: input.oiChangePressure,
      score: clamp(input.oiChangePressure, -1, 1),
      note: 'Signed OI addition/unwinding pressure',
      available: true,
    });
    if (weightSum > 0) {
      weighted += (input.spot + nudge) * w.oiChange;
      weightSum += w.oiChange;
    }
  } else {
    factors.push({
      name: 'OI change pressure',
      weight: w.oiChange,
      rawValue: null,
      score: 0,
      note: 'Unavailable',
      available: false,
    });
  }

  if (input.pcrOi != null) {
    factors.push({
      name: 'PCR (OI)',
      weight: w.pcr,
      rawValue: roundTo(input.pcrOi, 3),
      score: clamp(1 - input.pcrOi, -1, 1),
      note: 'Mild contextual input — never used alone',
      available: true,
    });
  } else {
    factors.push({
      name: 'PCR (OI)',
      weight: w.pcr,
      rawValue: null,
      score: 0,
      note: 'Unavailable',
      available: false,
    });
  }

  factors.push({
    name: 'IV / volatility',
    weight: w.ivVolatility,
    rawValue: input.ivScore,
    score: input.ivScore ?? 0,
    note: 'Widens zone under stress; does not set centre alone',
    available: input.ivScore != null,
  });

  if (weightSum <= 0 || input.spot == null) {
    return {
      lower: null,
      central: null,
      upper: null,
      factors,
      confidence: 0,
      explanation: ['Settlement zone UNAVAILABLE — insufficient anchors'],
      unavailableReason: 'Need spot plus at least one of reference VWAP / futures / walls / max pain',
    };
  }

  const central = weighted / weightSum;
  const volBoost = input.ivScore != null ? 1 + Math.abs(input.ivScore) * 0.5 : 1;
  const half = input.spot * (SETTLEMENT_CONFIG.zoneHalfWidthBps / 10_000) * volBoost;
  const confidence = clamp(Math.round((factors.filter((f) => f.available).length / factors.length) * 100), 0, 100);

  const explanation = [
    `Central zone from weighted anchors (weight sum ${roundTo(weightSum, 2)})`,
    `Reference VWAP: ${input.referenceVwap ?? 'UNAVAILABLE'}`,
    `Spot: ${input.spot} | Futures: ${input.futures ?? 'UNAVAILABLE'} | Basis: ${input.basis ?? 'UNAVAILABLE'}`,
    `Call wall: ${input.callWall ?? 'UNAVAILABLE'} | Put wall: ${input.putWall ?? 'UNAVAILABLE'}`,
    `Max Pain: ${input.maxPain ?? 'UNAVAILABLE'} (input only)`,
    `PCR OI: ${input.pcrOi ?? 'UNAVAILABLE'}`,
  ];

  return {
    lower: roundTo(central - half),
    central: roundTo(central),
    upper: roundTo(central + half),
    factors,
    confidence,
    explanation:
      confidence < SETTLEMENT_CONFIG.minConfidenceToPublish
        ? [...explanation, `Low confidence (${confidence}%) — interpret cautiously`]
        : explanation,
  };
}
