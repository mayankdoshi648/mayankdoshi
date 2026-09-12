import { DATA_CONFIG } from '../scoringConfig.js';
import type { AlignmentReport, DataSource, HealthStatus, TimedValue } from '../types.js';

export function ageMs(timestampIso: string | null, now = Date.now()): number | null {
  if (!timestampIso) return null;
  const t = Date.parse(timestampIso);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, now - t);
}

export function healthFromAge(age: number | null, staleMs = DATA_CONFIG.staleThresholdMs): HealthStatus {
  if (age == null) return 'UNAVAILABLE';
  if (age > staleMs) return 'STALE';
  return 'LIVE';
}

export function makeTimedValue<T>(
  value: T | null,
  timestamp: string | null,
  source: DataSource,
  now = Date.now(),
): TimedValue<T> {
  const age = ageMs(timestamp, now);
  const health = value == null || timestamp == null ? 'UNAVAILABLE' : healthFromAge(age);
  return {
    value: health === 'UNAVAILABLE' ? null : value,
    timestamp,
    source,
    health,
    ageMs: age,
  };
}

export function assessAlignment(input: {
  spotTs: string | null;
  futuresTs: string | null;
  optionTs: string | null;
  casTs?: string | null;
  thresholdMs?: number;
}): AlignmentReport {
  const threshold = input.thresholdMs ?? DATA_CONFIG.misalignmentThresholdMs;
  const stamps = [input.spotTs, input.futuresTs, input.optionTs, input.casTs ?? null]
    .filter((x): x is string => Boolean(x))
    .map((x) => Date.parse(x))
    .filter((n) => Number.isFinite(n));

  if (stamps.length < 2) {
    return {
      aligned: false,
      spotTimestamp: input.spotTs,
      futuresTimestamp: input.futuresTs,
      optionChainTimestamp: input.optionTs,
      casTimestamp: input.casTs ?? null,
      maxSkewMs: 0,
      thresholdMs: threshold,
      message: 'Insufficient timestamps for alignment check',
    };
  }

  const maxSkewMs = Math.max(...stamps) - Math.min(...stamps);
  const aligned = maxSkewMs <= threshold;
  return {
    aligned,
    spotTimestamp: input.spotTs,
    futuresTimestamp: input.futuresTs,
    optionChainTimestamp: input.optionTs,
    casTimestamp: input.casTs ?? null,
    maxSkewMs,
    thresholdMs: threshold,
    message: aligned
      ? null
      : `DATA MISALIGNMENT: max skew ${Math.round(maxSkewMs / 1000)}s exceeds ${Math.round(threshold / 1000)}s`,
  };
}
