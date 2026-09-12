'use strict';

/**
 * Classic max-pain: strike K minimizing sum of option writer pain.
 * Pain(K) = Σ_S callOI(S)*max(0, K-S) + putOI(S)*max(0, S-K)
 * spot is optional (unused in classic formula; accepted for API compatibility).
 */
function computeMaxPain(strikes, spot) {
  void spot;
  if (!Array.isArray(strikes) || !strikes.length) return null;

  const rows = strikes
    .map((s) => ({
      strike: s?.strike == null || s?.strike === '' ? NaN : Number(s.strike),
      callOi: Number(s.call?.oi) || 0,
      putOi: Number(s.put?.oi) || 0,
    }))
    .filter((s) => Number.isFinite(s.strike))
    .sort((a, b) => a.strike - b.strike);

  if (!rows.length) return null;
  if (!rows.some((r) => r.callOi > 0 || r.putOi > 0)) return null;

  const byStrike = [];
  let best = null;

  for (const candidate of rows) {
    const K = candidate.strike;
    let pain = 0;
    for (const s of rows) {
      pain += s.callOi * Math.max(0, K - s.strike);
      pain += s.putOi * Math.max(0, s.strike - K);
    }
    byStrike.push({ strike: K, pain });
    if (!best || pain < best.pain) best = { strike: K, pain };
  }

  return { maxPain: best.strike, byStrike };
}

module.exports = { computeMaxPain };
