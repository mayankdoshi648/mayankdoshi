'use strict';

/**
 * Lightweight sanity checks for normalized quotes.
 * Never invents replacements — only flags quality.
 */

function validateQuote(q = {}, { maxJumpPct = 25 } = {}) {
  const issues = [];
  const ltp = Number(q.ltp);
  if (!Number.isFinite(ltp) || ltp <= 0) issues.push('ltp_invalid');
  if (q.timestamp == null && q.asOf == null) issues.push('timestamp_missing');

  const prev = Number(q.prevClose);
  const changePct = Number(q.changePct ?? q.priceChangePct);
  if (Number.isFinite(changePct) && Math.abs(changePct) > maxJumpPct) {
    issues.push('change_pct_extreme');
  }
  if (Number.isFinite(ltp) && Number.isFinite(prev) && prev > 0) {
    const jump = Math.abs((ltp - prev) / prev) * 100;
    if (jump > maxJumpPct) issues.push('jump_vs_prev_close');
  }

  let quality = 'GOOD';
  if (issues.includes('ltp_invalid')) quality = 'BAD';
  else if (issues.length) quality = 'WARN';

  return {
    ok: quality !== 'BAD',
    quality,
    issues,
  };
}

function ageSeconds(timestamp, now = Date.now()) {
  if (!timestamp) return null;
  const ms = new Date(timestamp).getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.round((now - ms) / 1000));
}

function isStale(timestamp, { maxAgeSec = 120, marketOpen = true } = {}) {
  if (!marketOpen) return false; // closed session last prints are expected
  const age = ageSeconds(timestamp);
  if (age == null) return true;
  return age > maxAgeSec;
}

module.exports = { validateQuote, ageSeconds, isStale };
