import type { Candle } from '../types.js';

export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export function roundTo(value: number, decimals = 2): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

export function normalizeTsMs(ts: number): number {
  return ts < 1e12 ? ts * 1000 : ts;
}

export function computeVwap(candles: Candle[]): number | null {
  let pv = 0;
  let vol = 0;
  for (const c of candles) {
    if (!Number.isFinite(c.close) || !Number.isFinite(c.volume) || c.volume <= 0) continue;
    const typical = (c.high + c.low + c.close) / 3;
    pv += typical * c.volume;
    vol += c.volume;
  }
  if (vol <= 0) return null;
  return pv / vol;
}

export function filterCandlesByTime(candles: Candle[], startMs: number, endMs: number): Candle[] {
  return candles.filter((c) => {
    const t = normalizeTsMs(c.ts);
    return t >= startMs && t < endMs;
  });
}

export function computeBasis(spot: number | null, futures: number | null): number | null {
  if (spot == null || futures == null) return null;
  return futures - spot;
}

export function computeBasisPct(spot: number | null, futures: number | null): number | null {
  const b = computeBasis(spot, futures);
  if (b == null || !spot) return null;
  return (b / spot) * 100;
}
