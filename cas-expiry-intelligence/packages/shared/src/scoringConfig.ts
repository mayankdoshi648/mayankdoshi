/**
 * Central scoring / threshold configuration.
 * Engines MUST read from here — no scattered magic numbers.
 */

export const DATA_CONFIG = {
  staleThresholdMs: 15_000,
  misalignmentThresholdMs: 30_000,
  optionChainMinIntervalMs: 3_200,
  quoteCacheTtlMs: 1_000,
  historyCacheTtlMs: 60_000,
  requestTimeoutMs: 12_000,
  maxRetries: 3,
  retryBaseMs: 400,
};

export const SETTLEMENT_CONFIG = {
  weights: {
    referenceVwap: 0.25,
    spotFuturesPositioning: 0.2,
    oiWalls: 0.2,
    oiChange: 0.15,
    maxPain: 0.1,
    pcr: 0.05,
    ivVolatility: 0.05,
  },
  zoneHalfWidthBps: 12,
  minConfidenceToPublish: 35,
};

export const SIGNAL_CONFIG = {
  weights: {
    priceVsVwap: 0.2,
    priceVsRefVwap: 0.15,
    basis: 0.15,
    momentum: 0.15,
    oiWalls: 0.15,
    oiChange: 0.1,
    pcr: 0.1,
  },
  strongThreshold: 3,
  moderateThreshold: 1.5,
};

export const CAS_INTEL_CONFIG = {
  weights: {
    refVwapPull: 0.25,
    oiMagnet: 0.25,
    basisPressure: 0.15,
    maxPainPull: 0.1,
    wallSkew: 0.15,
    pcr: 0.1,
  },
};

export const RISK_CONFIG = {
  expiryDayBoost: 1.5,
  highVolIvThreshold: 18,
  divergenceHighPct: 0.15,
  weights: {
    expiry: 0.2,
    volatility: 0.15,
    divergence: 0.2,
    distanceFromRef: 0.15,
    oiConcentration: 0.1,
    wallProximity: 0.1,
    dataQuality: 0.1,
  },
};
