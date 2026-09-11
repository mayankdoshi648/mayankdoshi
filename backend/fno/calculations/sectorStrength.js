'use strict';

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Sector strength score 0-100 from aggregate stats.
 * Missing inputs are skipped (not fabricated). Empty → neutral 50.
 */
function computeSectorStrength(sectorStats = {}) {
  if (!sectorStats || typeof sectorStats !== 'object') return 50;

  const {
    returnPct,
    avgOiChangePct,
    advanceDecline,
    longBuildupCount,
    shortBuildupCount,
    relativeVolume,
  } = sectorStats;

  let earned = 0;
  let possible = 0;

  if (isFiniteNumber(returnPct)) {
    possible += 25;
    earned += clamp(((returnPct + 3) / 6) * 25, 0, 25);
  }

  if (isFiniteNumber(avgOiChangePct)) {
    possible += 15;
    earned += clamp(((avgOiChangePct + 5) / 10) * 15, 0, 15);
  }

  if (isFiniteNumber(advanceDecline)) {
    possible += 20;
    let ad;
    if (advanceDecline >= 2) ad = 20;
    else if (advanceDecline <= 0.5) ad = 0;
    else if (advanceDecline >= 1) ad = 10 + ((advanceDecline - 1) / 1) * 10;
    else ad = ((advanceDecline - 0.5) / 0.5) * 10;
    earned += ad;
  }

  const hasLb = isFiniteNumber(longBuildupCount);
  const hasSb = isFiniteNumber(shortBuildupCount);
  if (hasLb || hasSb) {
    possible += 25;
    const lb = hasLb ? longBuildupCount : 0;
    const sb = hasSb ? shortBuildupCount : 0;
    const total = lb + sb;
    if (total === 0) earned += 12.5;
    else earned += (lb / total) * 25;
  }

  if (isFiniteNumber(relativeVolume)) {
    possible += 15;
    earned += clamp(((relativeVolume - 0.5) / 1.5) * 15, 0, 15);
  }

  if (possible === 0) return 50;
  return Math.round((earned / possible) * 1000) / 10;
}

/**
 * Rank sectors by strength score descending; attach rank (1-based).
 */
function rankSectors(sectors = []) {
  if (!Array.isArray(sectors)) return [];

  const scored = sectors.map((s, index) => {
    const stats = s && typeof s === 'object' ? s : {};
    const score = computeSectorStrength(stats);
    return {
      ...stats,
      name: stats.name ?? stats.sector ?? `sector_${index}`,
      score,
      _index: index,
    };
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a._index - b._index;
  });

  return scored.map(({ _index, ...rest }, i) => ({
    ...rest,
    rank: i + 1,
  }));
}

module.exports = {
  computeSectorStrength,
  rankSectors,
};
