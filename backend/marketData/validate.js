'use strict';

/**
 * Validate normalized market rows before scoring engines consume them.
 * Rejects malformed values — never fabricates replacements.
 */

const { validateQuote } = require('../priceValidation');

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function validateMarketRow(row = {}) {
  const base = validateQuote(row);
  const issues = [...base.issues];

  if (!row.symbol && row.securityId == null) issues.push('missing_identity');

  const oi = Number(row.oi);
  if (row.oi != null && (!isFiniteNumber(oi) || oi < 0)) issues.push('oi_invalid');

  const oiChange = Number(row.oiChange);
  if (row.oiChange != null && !isFiniteNumber(oiChange)) issues.push('oi_change_invalid');

  const volume = Number(row.volume);
  if (row.volume != null && (!isFiniteNumber(volume) || volume < 0)) issues.push('volume_invalid');

  const strike = Number(row.strike);
  if (row.strike != null && (!isFiniteNumber(strike) || strike <= 0)) issues.push('strike_invalid');

  if (row.expiry != null && row.expiry !== '') {
    const exp = String(row.expiry);
    if (!/^\d{4}-\d{2}-\d{2}/.test(exp) && !/^\d{2}[-/]\w{3}/i.test(exp)) {
      issues.push('expiry_format_suspect');
    }
  }

  if (row.exchangeSegment != null) {
    const seg = String(row.exchangeSegment).toUpperCase();
    if (!seg.includes('NSE') && !seg.includes('BSE') && !seg.includes('IDX') && !seg.includes('MCX')) {
      issues.push('exchange_segment_suspect');
    }
  }

  let quality = base.quality;
  if (issues.includes('ltp_invalid') || issues.includes('oi_invalid') || issues.includes('missing_identity')) {
    quality = 'BAD';
  } else if (issues.length && quality === 'GOOD') {
    quality = 'WARN';
  }

  return { ok: quality !== 'BAD', quality, issues };
}

function filterValidRows(rows) {
  const kept = [];
  const rejected = [];
  for (const row of rows || []) {
    const check = validateMarketRow(row);
    if (!check.ok) {
      rejected.push({ symbol: row?.symbol, issues: check.issues });
      continue;
    }
    kept.push({ ...row, dataQuality: check.quality, dataIssues: check.issues });
  }
  return { rows: kept, rejected };
}

function assertFieldParity(raw, normalized, fields, { tolerance = 1e-6 } = {}) {
  const mismatches = [];
  for (const field of fields) {
    const a = raw?.[field];
    const b = normalized?.[field];
    if (a == null && b == null) continue;
    if (typeof a === 'number' && typeof b === 'number') {
      if (Math.abs(a - b) > tolerance) mismatches.push({ field, raw: a, normalized: b });
    } else if (a != null && b != null && String(a) !== String(b)) {
      mismatches.push({ field, raw: a, normalized: b });
    }
  }
  return { ok: mismatches.length === 0, mismatches };
}

module.exports = {
  validateMarketRow,
  filterValidRows,
  assertFieldParity,
};
