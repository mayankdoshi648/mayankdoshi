import type { OptionStrikeRow, OptionWalls, WallStatus } from '../types.js';

export function computePcrOi(rows: OptionStrikeRow[]): number | null {
  let call = 0;
  let put = 0;
  let any = false;
  for (const r of rows) {
    if (r.call.oi != null) {
      call += r.call.oi;
      any = true;
    }
    if (r.put.oi != null) {
      put += r.put.oi;
      any = true;
    }
  }
  if (!any || call === 0) return null;
  return put / call;
}

export function computePcrVolume(rows: OptionStrikeRow[]): number | null {
  let call = 0;
  let put = 0;
  let any = false;
  for (const r of rows) {
    if (r.call.volume != null) {
      call += r.call.volume;
      any = true;
    }
    if (r.put.volume != null) {
      put += r.put.volume;
      any = true;
    }
  }
  if (!any || call === 0) return null;
  return put / call;
}

/** Max Pain — writer-pain minimizer. ONE input to settlement analysis, not settlement itself. */
export function computeMaxPain(rows: OptionStrikeRow[]): number | null {
  if (!rows.length) return null;
  const strikes = rows.map((r) => r.strike).sort((a, b) => a - b);
  let best: number | null = null;
  let bestPain = Number.POSITIVE_INFINITY;
  for (const settlement of strikes) {
    let pain = 0;
    for (const r of rows) {
      const callOi = r.call.oi ?? 0;
      const putOi = r.put.oi ?? 0;
      pain += Math.max(0, settlement - r.strike) * callOi + Math.max(0, r.strike - settlement) * putOi;
    }
    if (pain < bestPain) {
      bestPain = pain;
      best = settlement;
    }
  }
  return best;
}

function wallScore(oi: number | null, oiChange: number | null, volume: number | null): number {
  return (oi ?? 0) * 0.6 + Math.max(0, oiChange ?? 0) * 0.25 + (volume ?? 0) * 0.15;
}

/** Walls blend OI + positive OI change + volume — not pure max OI. */
export function detectWalls(rows: OptionStrikeRow[], spot: number): OptionWalls {
  let callWall: number | null = null;
  let putWall: number | null = null;
  let callScore = -1;
  let putScore = -1;

  for (const r of rows) {
    if (r.strike >= spot) {
      const s = wallScore(r.call.oi, r.call.oiChange, r.call.volume);
      if (s > callScore) {
        callScore = s;
        callWall = r.strike;
      }
    }
    if (r.strike <= spot) {
      const s = wallScore(r.put.oi, r.put.oiChange, r.put.volume);
      if (s > putScore) {
        putScore = s;
        putWall = r.strike;
      }
    }
  }

  const statusFor = (score: number, change: number | null): WallStatus => {
    if (score < 0) return 'UNAVAILABLE';
    if ((change ?? 0) > 0) return 'BUILDING';
    if ((change ?? 0) < 0) return 'WEAKENING';
    return 'HOLDING';
  };

  const callChange = rows.find((r) => r.strike === callWall)?.call.oiChange ?? null;
  const putChange = rows.find((r) => r.strike === putWall)?.put.oiChange ?? null;

  return {
    callWall,
    putWall,
    callWallStatus: statusFor(callScore, callChange),
    putWallStatus: statusFor(putScore, putChange),
    callDistance: callWall != null ? callWall - spot : null,
    putDistance: putWall != null ? spot - putWall : null,
  };
}

export function nearestAtmStrike(spot: number, interval: number): number {
  return Math.round(spot / interval) * interval;
}

export function sliceAroundAtm(
  rows: OptionStrikeRow[],
  atm: number,
  interval: number,
  wings: number,
): OptionStrikeRow[] {
  const lo = atm - wings * interval;
  const hi = atm + wings * interval;
  return rows.filter((r) => r.strike >= lo && r.strike <= hi).sort((a, b) => a.strike - b.strike);
}
