'use strict';

/**
 * Options-implied expected move:
 *   move = spot × (IV/100) × sqrt(DTE/365)
 * atmIv is percent (12.5 => 12.5%).
 */
function computeExpectedMove({ spot, atmIv, dteDays } = {}) {
  if (spot == null || atmIv == null || dteDays == null) return null;
  if (![spot, atmIv, dteDays].every((v) => Number.isFinite(Number(v)))) return null;
  const s = Number(spot);
  const iv = Number(atmIv);
  const dte = Number(dteDays);
  if (s <= 0 || iv < 0 || dte < 0) return null;

  const move = s * (iv / 100) * Math.sqrt(dte / 365);
  if (!Number.isFinite(move)) return null;

  return {
    move,
    expectedUpper: s + move,
    expectedLower: s - move,
    upper1sd: s + move,
    lower1sd: s - move,
    upper2sd: s + 2 * move,
    lower2sd: s - 2 * move,
  };
}

function compareIvRealized({ atmIv, realizedVol } = {}) {
  if (atmIv == null || realizedVol == null) {
    return { atmIv: atmIv ?? null, realizedVol: realizedVol ?? null, spread: null, regime: null };
  }
  if (!Number.isFinite(Number(atmIv)) || !Number.isFinite(Number(realizedVol))) {
    return { atmIv: null, realizedVol: null, spread: null, regime: null };
  }
  const iv = Number(atmIv);
  const rv = Number(realizedVol);
  const spread = iv - rv;
  let regime = 'NEUTRAL';
  if (spread >= 3) regime = 'IV_RICH';
  else if (spread <= -3) regime = 'IV_CHEAP';
  return { atmIv: iv, realizedVol: rv, spread, regime };
}

function straddleImpliedRange({ straddlePrice, spot } = {}) {
  if (straddlePrice == null || spot == null) return null;
  if (!Number.isFinite(Number(straddlePrice)) || !Number.isFinite(Number(spot))) return null;
  const range = Number(straddlePrice);
  const s = Number(spot);
  if (range < 0 || s <= 0) return null;
  return { range, upper: s + range, lower: s - range };
}

module.exports = {
  computeExpectedMove,
  compareIvRealized,
  straddleImpliedRange,
};
