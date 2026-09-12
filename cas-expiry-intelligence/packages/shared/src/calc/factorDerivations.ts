import type { OptionStrikeRow } from '../types.js';
import { clamp } from './marketMath.js';

/** Net put−call OI-change pressure in [-1, 1]. Positive ≈ put building / call unwinding. */
export function computeOiChangePressure(rows: OptionStrikeRow[]): number | null {
  if (!rows.length) return null;
  let callAdd = 0;
  let putAdd = 0;
  let any = false;
  for (const r of rows) {
    if (r.call.oiChange != null) {
      callAdd += r.call.oiChange;
      any = true;
    }
    if (r.put.oiChange != null) {
      putAdd += r.put.oiChange;
      any = true;
    }
  }
  if (!any) return null;
  const denom = Math.max(1, Math.abs(callAdd) + Math.abs(putAdd));
  return clamp((putAdd - callAdd) / denom, -1, 1);
}

/** Pull toward OI magnet (max pain / wall mid) vs spot, in [-1, 1]. */
export function computeOiMagnetScore(input: {
  spot: number | null;
  maxPain: number | null;
  callWall: number | null;
  putWall: number | null;
}): number | null {
  const { spot, maxPain, callWall, putWall } = input;
  if (spot == null || spot === 0) return null;
  const anchors: number[] = [];
  if (maxPain != null) anchors.push(maxPain);
  if (callWall != null && putWall != null) anchors.push((callWall + putWall) / 2);
  if (!anchors.length) return null;
  const magnet = anchors.reduce((a, b) => a + b, 0) / anchors.length;
  return clamp((magnet - spot) / spot / 0.002, -1, 1);
}

/** Share of total OI concentrated at the single largest strike. */
export function computeOiConcentration(rows: OptionStrikeRow[]): number | null {
  if (!rows.length) return null;
  let total = 0;
  let peak = 0;
  for (const r of rows) {
    const oi = (r.call.oi ?? 0) + (r.put.oi ?? 0);
    total += oi;
    if (oi > peak) peak = oi;
  }
  if (total <= 0) return null;
  return peak / total;
}

/** ATM-ish average IV from nearest strike with IV. */
export function computeAtmIv(rows: OptionStrikeRow[], spot: number | null): number | null {
  if (!rows.length || spot == null) return null;
  let best: OptionStrikeRow | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const r of rows) {
    const d = Math.abs(r.strike - spot);
    if (d < bestDist) {
      bestDist = d;
      best = r;
    }
  }
  if (!best) return null;
  const vals = [best.call.iv, best.put.iv].filter((v): v is number => v != null && Number.isFinite(v));
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}
