'use strict';

/**
 * Smart Money Proxy Engine
 * Quantitative positioning signal — NOT identification of actual institutional trades.
 */

const { classifyBuildup } = require('./oiBuildup');
const { computePcr } = require('./pcr');

const DISCLAIMER =
  'Smart Money Proxy — A quantitative positioning signal based on price, OI, volume, VWAP, options positioning, sector strength and institutional positioning. It does not identify actual institutional trades.';

const COMPONENT_CAPS = Object.freeze({
  priceOi: 30,
  volume: 15,
  vwap: 15,
  options: 15,
  sector: 10,
  fii: 10,
  momentum: 5,
});

const LABEL_BANDS = [
  { min: 80, max: 100, label: 'VERY STRONG BULLISH', signal: 'VERY STRONG LONG' },
  { min: 60, max: 79, label: 'STRONG BULLISH', signal: 'STRONG LONG' },
  { min: 40, max: 59, label: 'BULLISH', signal: 'LONG' },
  { min: 20, max: 39, label: 'MILD BULLISH', signal: 'MILD LONG' },
  { min: -19, max: 19, label: 'NEUTRAL', signal: 'NEUTRAL' },
  { min: -39, max: -20, label: 'MILD BEARISH', signal: 'MILD SHORT' },
  { min: -59, max: -40, label: 'BEARISH', signal: 'SHORT' },
  { min: -79, max: -60, label: 'STRONG BEARISH', signal: 'STRONG SHORT' },
  { min: -100, max: -80, label: 'VERY STRONG BEARISH', signal: 'VERY STRONG SHORT' },
];

function clamp(n, lo, hi) {
  const x = Number(n);
  if (!Number.isFinite(x)) return lo;
  return Math.max(lo, Math.min(hi, x));
}

function round1(n) {
  return Math.round(Number(n) * 10) / 10;
}

function num(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function softSign(x, scale) {
  const v = num(x, 0);
  const s = Math.max(1e-9, Number(scale) || 1);
  return Math.tanh(v / s);
}

function labelForScore(score) {
  const s = Math.round(clamp(score, -100, 100));
  for (const b of LABEL_BANDS) {
    if (s >= b.min && s <= b.max) return { ...b, score: s };
  }
  return { ...LABEL_BANDS[4], score: s };
}

function setupFromBuildup(buildup) {
  const key = String(buildup || '')
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
  const map = {
    LONG_BUILDUP: 'LONG BUILDUP',
    SHORT_BUILDUP: 'SHORT BUILDUP',
    SHORT_COVERING: 'SHORT COVERING',
    LONG_UNWINDING: 'LONG UNWINDING',
    NEUTRAL: 'MIXED',
    MIXED: 'MIXED',
  };
  return map[key] || 'MIXED';
}

/**
 * Normalize scanner/row shapes + optional second-arg extras (legacy service call).
 */
function normalizeInput(instrument, extras = {}) {
  if (instrument == null || typeof instrument !== 'object') {
    instrument = {};
  }
  if (extras == null || typeof extras !== 'object') {
    extras = {};
  }
  const input = { ...instrument, ...extras };

  if (input.priceChangePct == null && input.pricePct != null) input.priceChangePct = num(input.pricePct);
  if (input.oiChangePct == null && input.oiPct != null) input.oiChangePct = num(input.oiPct);
  if (input.relativeVolume == null && input.rvol != null) input.relativeVolume = num(input.rvol);
  if (input.ivChange == null && input.ivChangePct != null) input.ivChange = num(input.ivChangePct);
  if (input.sectorChangePct == null && input.sectorReturnPct != null) {
    input.sectorChangePct = num(input.sectorReturnPct);
  }
  if (input.sectorScore == null && input.marketRegimeScore != null && input.isIndex) {
    // optional soft context only for indices — not a substitute for sector engine
  }

  // Derive VWAP distance from vwapRelation when numeric VWAP missing
  if ((input.vwap == null || (input.ltp == null && input.price == null)) && input.vwapRelation) {
    const price = num(input.ltp ?? input.price, 100);
    input.ltp = price;
    if (input.vwapRelation === 'above') input.vwap = price * 0.995;
    else if (input.vwapRelation === 'below') input.vwap = price * 1.005;
    else input.vwap = price;
  }

  const INDEX_SET = new Set(['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY']);
  if (input.isIndex == null && input.symbol) {
    input.isIndex = INDEX_SET.has(String(input.symbol).toUpperCase());
  }

  return input;
}

function relativeVolumeBucket(rvol) {
  const r = num(rvol, null);
  if (r == null) return { bucket: 'unknown', strength: 0, label: 'RVOL unavailable' };
  if (r < 0.75) return { bucket: 'weak', strength: 0.35, label: 'weak confirmation' };
  if (r < 1.25) return { bucket: 'normal', strength: 0.7, label: 'normal' };
  if (r < 2.0) return { bucket: 'strong', strength: 1.0, label: 'strong' };
  const capped = 1.0 + Math.min(0.35, softSign(r - 2, 2) * 0.35);
  return { bucket: 'very_strong', strength: capped, label: 'very strong (spike-capped)' };
}

/** A. Price + OI — up to 30 */
function scorePriceOi(input = {}) {
  const priceChgPct = num(input.priceChangePct, 0);
  const oiChgPct = num(input.oiChangePct, 0);
  const buildup =
    input.buildup && setupFromBuildup(input.buildup) !== 'MIXED'
      ? String(input.buildup).toUpperCase().replace(/[\s-]+/g, '_')
      : classifyBuildup({ priceChangePct: priceChgPct, oiChangePct: oiChgPct });
  const setup = setupFromBuildup(buildup);

  const priceMag = softSign(Math.abs(priceChgPct), 1.2);
  const oiMag = softSign(Math.abs(oiChgPct), 4);
  const magnitude = 0.45 * priceMag + 0.55 * oiMag;

  let direction = 0;
  if (setup === 'LONG BUILDUP') direction = 1;
  else if (setup === 'SHORT BUILDUP') direction = -1;
  else if (setup === 'SHORT COVERING') direction = 0.55;
  else if (setup === 'LONG UNWINDING') direction = -0.55;

  const raw = direction * magnitude * COMPONENT_CAPS.priceOi;
  const score = round1(clamp(raw, -COMPONENT_CAPS.priceOi, COMPONENT_CAPS.priceOi));
  const available = true;

  return {
    id: 'priceOi',
    score,
    max: COMPONENT_CAPS.priceOi,
    available,
    setup,
    buildup,
    detail: {
      priceChangePct: round1(priceChgPct),
      oiChangePct: round1(oiChgPct),
      magnitude: round1(magnitude * 100) / 100,
    },
    reasons: [
      `Price: ${priceChgPct >= 0 ? '+' : ''}${round1(priceChgPct)}%`,
      `OI: ${oiChgPct >= 0 ? '+' : ''}${round1(oiChgPct)}% — ${buildup}`,
    ],
  };
}

/** B. Volume — up to 15 */
function scoreVolume(input = {}) {
  const rvol = num(input.relativeVolume, null);
  const priceChgPct = num(input.priceChangePct, 0);
  const bucket = relativeVolumeBucket(rvol);
  if (rvol == null) {
    return {
      id: 'volume',
      score: 0,
      max: COMPONENT_CAPS.volume,
      available: false,
      detail: { relativeVolume: null, bucket: bucket.bucket },
      reasons: ['Relative volume unavailable'],
    };
  }
  const dir = Math.sign(priceChgPct) || 0;
  const raw = dir * bucket.strength * COMPONENT_CAPS.volume * 0.85;
  const score = round1(clamp(raw, -COMPONENT_CAPS.volume, COMPONENT_CAPS.volume));
  return {
    id: 'volume',
    score,
    max: COMPONENT_CAPS.volume,
    available: true,
    detail: { relativeVolume: round1(rvol * 100) / 100, bucket: bucket.bucket, label: bucket.label },
    reasons: [`Relative Volume: ${round1(rvol * 100) / 100}× — ${bucket.label}`],
  };
}

/** C. VWAP — up to 15 */
function scoreVwap(input = {}) {
  const price = num(input.ltp ?? input.price, null);
  const vwap = num(input.vwap, null);
  const vwapSlope = num(input.vwapSlope, null);
  const rvol = num(input.relativeVolume, 1);
  const max = COMPONENT_CAPS.vwap;

  if (price == null || vwap == null || vwap === 0) {
    return {
      id: 'vwap',
      score: 0,
      max,
      available: false,
      detail: { distancePct: null },
      reasons: ['VWAP unavailable'],
    };
  }

  const distancePct = ((price - vwap) / vwap) * 100;
  const distMag = softSign(Math.abs(distancePct), 0.8);
  let dir = Math.sign(distancePct);
  let slopeBoost = 0;
  if (vwapSlope != null) {
    if (dir > 0 && vwapSlope > 0) slopeBoost = 0.25;
    if (dir < 0 && vwapSlope < 0) slopeBoost = 0.25;
    if (dir > 0 && vwapSlope < 0) slopeBoost = -0.15;
    if (dir < 0 && vwapSlope > 0) slopeBoost = -0.15;
  }
  const crossBoost =
    Math.abs(distancePct) < 0.15 && rvol >= 1.25 ? 0.2 * Math.sign(num(input.priceChangePct, dir)) : 0;

  const raw = dir * (0.7 + 0.3 * distMag + slopeBoost + crossBoost) * max * 0.9;
  const score = round1(clamp(raw, -max, max));
  const side = distancePct >= 0 ? 'above' : 'below';
  return {
    id: 'vwap',
    score,
    max,
    available: true,
    detail: {
      distancePct: round1(distancePct),
      vwapSlope,
      price,
      vwap,
    },
    reasons: [
      `Price ${side} VWAP (${distancePct >= 0 ? '+' : ''}${round1(distancePct)}%)${
        vwapSlope != null ? ` — VWAP slope ${vwapSlope > 0 ? 'rising' : vwapSlope < 0 ? 'falling' : 'flat'}` : ''
      }`,
    ],
  };
}

/** D. Options — up to 15 */
function scoreOptions(input = {}) {
  const max = COMPONENT_CAPS.options;
  const callOi = num(input.callOi ?? input.totalCallOi, null);
  const putOi = num(input.putOi ?? input.totalPutOi, null);
  const callOiChg = num(input.callOiChange, null);
  const putOiChg = num(input.putOiChange, null);
  const pcr = num(input.pcr, callOi != null && putOi != null ? computePcr(putOi, callOi) : null);
  const pcrChange = num(input.pcrChange, null);
  const atmIv = num(input.atmIv, null);
  const ivChange = num(input.ivChange, null);
  const priceChgPct = num(input.priceChangePct, 0);

  const hasCore = pcr != null || (callOi != null && putOi != null) || callOiChg != null || putOiChg != null;
  if (!hasCore) {
    return {
      id: 'options',
      score: 0,
      max,
      available: false,
      detail: { pcr: null },
      reasons: ['Options positioning data unavailable'],
    };
  }

  let raw = 0;
  const reasons = [];

  if (pcr != null) {
    // Combine PCR with price — never standalone
    if (pcr > 1.1 && priceChgPct >= 0) {
      raw += softSign(pcr - 1, 0.5) * 5;
      reasons.push(`PCR ${round1(pcr)} with rising price — supportive put bias`);
    } else if (pcr < 0.9 && priceChgPct <= 0) {
      raw -= softSign(1 - pcr, 0.5) * 5;
      reasons.push(`PCR ${round1(pcr)} with falling price — supportive call bias`);
    } else if (pcr > 1.2 && priceChgPct < -0.3) {
      raw -= 2;
      reasons.push(`PCR ${round1(pcr)} elevated while price weak — conflicted`);
    } else {
      reasons.push(`PCR ${round1(pcr)} — contextual only`);
    }
  }

  if (putOiChg != null && callOiChg != null) {
    const putAdd = putOiChg > 0 && putOiChg > callOiChg;
    const callAdd = callOiChg > 0 && callOiChg > putOiChg;
    if (putAdd && priceChgPct >= 0) {
      raw += 4;
      reasons.push('Put OI addition stronger than Call OI — supportive');
    } else if (callAdd && priceChgPct <= 0) {
      raw -= 4;
      reasons.push('Call OI addition stronger than Put OI — supportive bearish');
    } else if (callAdd && priceChgPct > 0) {
      raw -= 1.5;
      reasons.push('Call OI rising into strength — resistance watch');
    } else if (putAdd && priceChgPct < 0) {
      raw += 1.5;
      reasons.push('Put OI rising into weakness — support watch');
    }
  }

  if (pcrChange != null) {
    raw += softSign(pcrChange, 0.15) * 2 * Math.sign(priceChgPct || 1);
  }

  if (ivChange != null && atmIv != null) {
    if (ivChange > 0 && Math.abs(priceChgPct) > 0.5) {
      raw += Math.sign(priceChgPct) * 1.5;
      reasons.push(`ATM IV ${ivChange > 0 ? 'rising' : 'falling'} with price move`);
    }
  }

  const score = round1(clamp(raw, -max, max));
  return {
    id: 'options',
    score,
    max,
    available: true,
    detail: {
      pcr,
      pcrChange,
      callOi,
      putOi,
      callOiChange: callOiChg,
      putOiChange: putOiChg,
      atmIv,
      ivChange,
    },
    reasons: reasons.length ? reasons : ['Options data present — neutral contribution'],
  };
}

/** E. Sector — up to 10 */
function scoreSector(input = {}) {
  const max = COMPONENT_CAPS.sector;
  const sectorScore = num(input.sectorScore, null);
  const sectorChangePct = num(input.sectorChangePct, null);
  const priceChgPct = num(input.priceChangePct, 0);
  const stockDir = Math.sign(priceChgPct);

  if (sectorScore == null && sectorChangePct == null) {
    return {
      id: 'sector',
      score: 0,
      max,
      available: false,
      detail: {},
      reasons: ['Sector data unavailable'],
    };
  }

  const secDir =
    sectorScore != null
      ? Math.sign(sectorScore)
      : Math.sign(sectorChangePct || 0);
  const secMag =
    sectorScore != null
      ? softSign(Math.abs(sectorScore), 40)
      : softSign(Math.abs(sectorChangePct || 0), 1.2);

  let raw = 0;
  let note = '';
  if (stockDir === 0 || secDir === 0) {
    raw = stockDir * secMag * max * 0.35;
    note = 'Sector neutral — moderate confirmation';
  } else if (stockDir === secDir) {
    raw = stockDir * (0.55 + 0.45 * secMag) * max;
    note = 'Stock and sector aligned — strong confirmation';
  } else {
    raw = stockDir * 0.2 * max; // do not override stock; mild dampening via confidence elsewhere
    note = 'Stock vs sector divergence — confirmation weakened';
  }

  const score = round1(clamp(raw, -max, max));
  return {
    id: 'sector',
    score,
    max,
    available: true,
    detail: { sectorScore, sectorChangePct, aligned: stockDir !== 0 && stockDir === secDir },
    reasons: [
      `Sector: ${
        sectorChangePct != null
          ? `${sectorChangePct >= 0 ? '+' : ''}${round1(sectorChangePct)}%`
          : `score ${sectorScore}`
      } — ${note}`,
    ],
  };
}

/** F. FII — up to 10 (index-level primarily) */
function scoreFii(input = {}) {
  const max = COMPONENT_CAPS.fii;
  const isIndex = Boolean(input.isIndex);
  const fiiNetFutures = num(input.fiiNetFutures, null);
  const fiiLongShortRatio = num(input.fiiLongShortRatio, null);
  const fiiNetCash = num(input.fiiNetCash, null);
  const fiiChange = num(input.fiiPositionChange, null);

  const hasAny = fiiNetFutures != null || fiiLongShortRatio != null || fiiNetCash != null;
  if (!hasAny) {
    return {
      id: 'fii',
      score: 0,
      max,
      available: false,
      detail: {},
      reasons: ['FII positioning data unavailable'],
    };
  }

  if (!isIndex) {
    // Do not apply index FII as if it were stock-specific; tiny contextual nudge only if explicitly allowed
    return {
      id: 'fii',
      score: 0,
      max,
      available: true,
      appliedAs: 'index_context_only',
      detail: { fiiNetFutures, fiiNetCash, note: 'Index-level FII not applied to stock score' },
      reasons: ['FII data is index-level — not applied as stock positioning'],
    };
  }

  let raw = 0;
  const reasons = [];
  if (fiiNetFutures != null) {
    raw += softSign(fiiNetFutures, 5000) * 6;
    reasons.push(`FII net futures ${fiiNetFutures >= 0 ? '+' : ''}${Math.round(fiiNetFutures)}`);
  }
  if (fiiLongShortRatio != null) {
    raw += softSign(fiiLongShortRatio - 1, 0.4) * 3;
  }
  if (fiiNetCash != null) {
    raw += softSign(fiiNetCash, 2000) * 2;
    reasons.push(`FII cash ${fiiNetCash >= 0 ? '+' : ''}${Math.round(fiiNetCash)} Cr`);
  }
  if (fiiChange != null) {
    raw += softSign(fiiChange, 2000) * 2;
  }

  const score = round1(clamp(raw, -max, max));
  return {
    id: 'fii',
    score,
    max,
    available: true,
    detail: { fiiNetFutures, fiiLongShortRatio, fiiNetCash, fiiChange },
    reasons: reasons.length ? reasons : ['FII data present'],
  };
}

/** G. Momentum / persistence — up to 5 */
function scoreMomentum(input = {}) {
  const max = COMPONENT_CAPS.momentum;
  const frames = input.timeframes || input.momentumFrames || null;
  // frames: { m5, m15, m30, m60, daily } each in [-1,0,1] or score
  if (!frames || typeof frames !== 'object') {
    // Fallback: use single-session persistence proxy from price vs oi agreement
    const priceChgPct = num(input.priceChangePct, 0);
    const oiChgPct = num(input.oiChangePct, 0);
    const agree = Math.sign(priceChgPct) === Math.sign(oiChgPct) && priceChgPct !== 0;
    const score = agree ? round1(Math.sign(priceChgPct) * max * 0.45) : 0;
    return {
      id: 'momentum',
      score,
      max,
      available: false,
      detail: { mode: 'session_proxy' },
      reasons: ['Multi-timeframe history limited — session persistence proxy only'],
    };
  }

  const keys = ['m5', 'm15', 'm30', 'm60', 'daily'];
  const vals = keys.map((k) => num(frames[k], null)).filter((v) => v != null);
  if (!vals.length) {
    return {
      id: 'momentum',
      score: 0,
      max,
      available: false,
      detail: {},
      reasons: ['Timeframe signals unavailable'],
    };
  }
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  const sameSign = vals.every((v) => Math.sign(v) === Math.sign(avg) || v === 0);
  const raw = softSign(avg, 0.8) * max * (sameSign ? 1 : 0.45);
  const score = round1(clamp(raw, -max, max));
  return {
    id: 'momentum',
    score,
    max,
    available: true,
    detail: { frames, avg: round1(avg) },
    reasons: [`Multi-timeframe avg ${round1(avg)} — ${sameSign ? 'persistent' : 'mixed'}`],
  };
}

function detectConflicts(components, input = {}) {
  const conflicts = [];
  const priceOi = components.priceOi;
  const vwap = components.vwap;
  const sector = components.sector;
  const options = components.options;
  const volume = components.volume;

  const setup = priceOi?.setup;
  const bullSetup = setup === 'LONG BUILDUP' || setup === 'SHORT COVERING';
  const bearSetup = setup === 'SHORT BUILDUP' || setup === 'LONG UNWINDING';

  if (bullSetup && vwap?.available && vwap.detail?.distancePct < -0.25) {
    conflicts.push({
      code: 'VWAP_DIVERGENCE',
      text: 'Bullish Price/OI setup but price still below VWAP',
    });
  }
  if (bearSetup && vwap?.available && vwap.detail?.distancePct > 0.25) {
    conflicts.push({
      code: 'VWAP_DIVERGENCE',
      text: 'Bearish Price/OI setup but price still above VWAP',
    });
  }
  if (bullSetup && sector?.available && sector.detail?.aligned === false && num(input.priceChangePct, 0) > 0) {
    conflicts.push({
      code: 'SECTOR_DIVERGENCE',
      text: 'Stock bullish while sector confirmation is weak/bearish',
    });
  }
  if (bearSetup && sector?.available && sector.detail?.aligned === false && num(input.priceChangePct, 0) < 0) {
    conflicts.push({
      code: 'SECTOR_DIVERGENCE',
      text: 'Stock bearish while sector confirmation is weak/bullish',
    });
  }
  if (bullSetup && options?.available && num(options.detail?.pcr, 1) < 0.75) {
    conflicts.push({
      code: 'PCR_DETERIORATING',
      text: 'Bullish setup but PCR remains call-heavy',
    });
  }
  if (bearSetup && options?.available && num(options.detail?.pcr, 1) > 1.35) {
    conflicts.push({
      code: 'PCR_DETERIORATING',
      text: 'Bearish setup but PCR remains put-heavy',
    });
  }
  if (volume?.available && volume.detail?.bucket === 'weak' && Math.abs(num(input.priceChangePct, 0)) > 1) {
    conflicts.push({
      code: 'WEAK_VOLUME',
      text: 'Large price move without volume confirmation',
    });
  }

  // Component sign conflicts among strong contributors
  const signed = Object.values(components).filter((c) => c && Math.abs(c.score) >= 4);
  const pos = signed.filter((c) => c.score > 0).length;
  const neg = signed.filter((c) => c.score < 0).length;
  if (pos >= 2 && neg >= 2) {
    conflicts.push({
      code: 'CROSS_COMPONENT',
      text: 'Multiple bullish and bearish component scores active',
    });
  }

  return conflicts;
}

function computeConfidence(components, conflicts, input = {}) {
  const weights = {
    priceOi: 22,
    volume: 14,
    vwap: 14,
    options: 16,
    sector: 12,
    fii: 12,
    momentum: 10,
  };
  let earned = 0;
  let possible = 0;
  const missing = [];
  for (const [id, w] of Object.entries(weights)) {
    possible += w;
    const c = components[id];
    if (c?.available) {
      const mag = Math.min(1, Math.abs(num(c.score, 0)) / (c.max || 1));
      earned += w * (0.55 + 0.45 * mag);
    } else {
      missing.push(id);
    }
  }

  // Confirming indicators bonus
  const confirming = Object.values(components).filter((c) => c?.available && Math.abs(c.score) >= 3).length;
  let conf = (earned / possible) * 100;
  conf += Math.min(8, confirming * 1.2);

  // Conflict penalty
  conf -= Math.min(35, conflicts.length * 9);

  // Extreme volume spike slightly reduces confidence (noise)
  const rvol = num(input.relativeVolume, null);
  if (rvol != null && rvol > 4) conf -= 6;

  // Market closed soft flag
  if (input.marketClosed) conf -= 5;

  conf = clamp(Math.round(conf), 0, 100);

  let quality = 'LOW';
  if (conf >= 75) quality = 'HIGH';
  else if (conf >= 55) quality = 'MEDIUM';

  return {
    confidence: conf,
    quality,
    missing,
    confirmingIndicators: confirming,
    conflictCount: conflicts.length,
  };
}

function classifyTimeframes(frames = {}) {
  const labels = {};
  const keys = [
    ['m5', '5M'],
    ['m15', '15M'],
    ['m30', '30M'],
    ['m60', '60M'],
    ['daily', 'DAILY'],
  ];
  const dirs = [];
  for (const [k, label] of keys) {
    const v = num(frames[k], null);
    if (v == null) {
      labels[label] = 'N/A';
      continue;
    }
    const d = v > 0.15 ? 'Bullish' : v < -0.15 ? 'Bearish' : 'Neutral';
    labels[label] = d;
    if (d !== 'Neutral') dirs.push(d);
  }
  let overall = 'MIXED';
  if (!dirs.length) overall = 'NEUTRAL';
  else if (dirs.every((d) => d === 'Bullish')) overall = 'MULTI-TIMEFRAME BULLISH';
  else if (dirs.every((d) => d === 'Bearish')) overall = 'MULTI-TIMEFRAME BEARISH';
  else if (dirs.filter((d) => d === 'Bullish').length >= dirs.length - 1) overall = 'ALIGNING BULLISH';
  else if (dirs.filter((d) => d === 'Bearish').length >= dirs.length - 1) overall = 'ALIGNING BEARISH';
  else overall = 'MIXED / REVERSING';

  return { labels, overall };
}

function splitFactors(components, conflicts) {
  const bullish = [];
  const bearish = [];
  for (const c of Object.values(components)) {
    if (!c) continue;
    for (const r of c.reasons || []) {
      if (c.score > 1.5) bullish.push({ component: c.id, text: r, score: c.score });
      else if (c.score < -1.5) bearish.push({ component: c.id, text: r, score: c.score });
    }
  }
  return {
    bullishFactors: bullish,
    bearishFactors: bearish,
    conflictingFactors: conflicts.map((c) => ({ code: c.code, text: c.text })),
  };
}

function buildExplanation(result) {
  const lines = [];
  lines.push(`Smart Money Proxy ${result.score >= 0 ? '+' : ''}${result.score} / 100`);
  lines.push(`Confidence ${result.confidence}%`);
  lines.push(`Signal ${result.signal}`);
  lines.push(`Primary Setup ${result.setup}`);
  lines.push('WHY?');
  for (const c of Object.values(result.components)) {
    if (!c) continue;
    for (const r of c.reasons || []) lines.push(r);
  }
  if (result.conflicts?.length) {
    lines.push('CONFLICTING SIGNALS');
    for (const x of result.conflicts) lines.push(x.text);
  }
  lines.push(`Signal Quality: ${result.quality}`);
  return lines.join('\n');
}

/**
 * Full Smart Money Proxy computation.
 * @param {object} input
 */
function computeSmartMoneyProxy(instrument = {}, extras = {}) {
  const input = normalizeInput(instrument, extras);
  const components = {
    priceOi: scorePriceOi(input),
    volume: scoreVolume(input),
    vwap: scoreVwap(input),
    options: scoreOptions(input),
    sector: scoreSector(input),
    fii: scoreFii(input),
    momentum: scoreMomentum(input),
  };

  let total = 0;
  for (const c of Object.values(components)) total += num(c.score, 0);
  // Soft normalize toward ±100 without crushing mid-range
  let score = total;
  if (Math.abs(score) > 100) score = Math.sign(score) * 100;
  score = Math.round(clamp(score, -100, 100));

  const conflicts = detectConflicts(components, input);
  // Material conflicts pull score toward neutral slightly (do not force direction)
  if (conflicts.length >= 2) {
    score = Math.round(score * (1 - Math.min(0.35, conflicts.length * 0.08)));
  }

  const conf = computeConfidence(components, conflicts, input);
  const band = labelForScore(score);
  const factors = splitFactors(components, conflicts);
  const tf = classifyTimeframes(input.timeframes || {});

  // Boost confidence if multi-TF aligned
  let confidence = conf.confidence;
  if (tf.overall.includes('MULTI-TIMEFRAME') || tf.overall.includes('ALIGNING')) {
    confidence = clamp(confidence + 6, 0, 100);
  }

  const why = [];
  for (const c of Object.values(components)) {
    if (c?.reasons?.length) why.push(...c.reasons);
  }
  if (conflicts.length) {
    why.push('CONFLICTING SIGNALS');
    why.push(...conflicts.map((c) => c.text));
  }

  let interpretation = `${band.label} positioning proxy (${band.signal}). Primary setup ${components.priceOi.setup}.`;
  if (conflicts.length) {
    interpretation += ' Conflicting signals present — treat direction cautiously; confidence reduced.';
  } else {
    interpretation += ' Components are broadly consistent for a positioning proxy (not proof of institutional intent).';
  }

  const result = {
    symbol: input.symbol || null,
    score,
    confidence,
    label: band.label,
    signal: band.signal,
    setup: components.priceOi.setup,
    buildup: components.priceOi.buildup,
    quality: conf.quality,
    conflicting: conflicts.length > 0,
    conflicts,
    components,
    componentScores: {
      priceOi: components.priceOi.score,
      volume: components.volume.score,
      vwap: components.vwap.score,
      options: components.options.score,
      sector: components.sector.score,
      fii: components.fii.score,
      momentum: components.momentum.score,
    },
    ...factors,
    timeframes: tf,
    why,
    explanation: null,
    interpretation,
    disclaimer: DISCLAIMER,
    // legacy fields for existing UI
    signals: [components.priceOi.buildup, band.signal].filter(Boolean),
  };
  result.explanation = buildExplanation(result);
  return result;
}

function summarizeMarketBias(rows = []) {
  if (!rows.length) return { bias: 'NEUTRAL', avgScore: 0, bullish: 0, bearish: 0, neutral: 0 };
  let sum = 0;
  let bullish = 0;
  let bearish = 0;
  let neutral = 0;
  for (const r of rows) {
    const s = num(r.score, 0);
    sum += s;
    if (s >= 20) bullish += 1;
    else if (s <= -20) bearish += 1;
    else neutral += 1;
  }
  const avg = round1(sum / rows.length);
  let bias = 'NEUTRAL';
  if (avg >= 25) bias = 'BULLISH';
  else if (avg <= -25) bias = 'BEARISH';
  else if (bullish > bearish * 1.4) bias = 'BULLISH';
  else if (bearish > bullish * 1.4) bias = 'BEARISH';
  return { bias, avgScore: avg, bullish, bearish, neutral };
}

function buildRankings(rows = []) {
  const byScore = [...rows].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return (b.relativeVolume || 0) - (a.relativeVolume || 0);
  });

  const topLongs = byScore.filter((r) => r.score >= 20).slice(0, 25);
  const topShorts = [...byScore].reverse().filter((r) => r.score <= -20).slice(0, 25);
  const topShortCovering = rows
    .filter((r) => r.setup === 'SHORT COVERING')
    .sort((a, b) => b.score - a.score || b.confidence - a.confidence)
    .slice(0, 20);
  const topLongUnwinding = rows
    .filter((r) => r.setup === 'LONG UNWINDING')
    .sort((a, b) => a.score - b.score || b.confidence - a.confidence)
    .slice(0, 20);
  const topEmerging = rows
    .filter((r) => Math.abs(r.score) >= 25 && (r.relativeVolume || 0) >= 1.25 && (r.confidence || 0) >= 55)
    .sort((a, b) => Math.abs(b.score) - Math.abs(a.score) || b.confidence - a.confidence)
    .slice(0, 20);

  return { topLongs, topShorts, topShortCovering, topLongUnwinding, topEmerging };
}

function evaluateSmartMoneyAlert(prev, curr, rules = {}) {
  const triggers = [];
  if (!curr) return triggers;
  const score = curr.score;
  const conf = curr.confidence;
  const prevScore = prev?.score;

  if (rules.scoreAbove != null && score > rules.scoreAbove) {
    triggers.push({ type: 'smart_money_score_above', message: `Smart Money Score ${score} > ${rules.scoreAbove}` });
  }
  if (rules.scoreBelow != null && score < rules.scoreBelow) {
    triggers.push({ type: 'smart_money_score_below', message: `Smart Money Score ${score} < ${rules.scoreBelow}` });
  }
  if (prevScore != null && rules.crossAbove != null && prevScore < rules.crossAbove && score >= rules.crossAbove) {
    triggers.push({
      type: 'smart_money_cross_above',
      message: `Smart Money crossed above ${rules.crossAbove} (${prevScore} → ${score})`,
    });
  }
  if (prevScore != null && rules.crossBelow != null && prevScore > rules.crossBelow && score <= rules.crossBelow) {
    triggers.push({
      type: 'smart_money_cross_below',
      message: `Smart Money crossed below ${rules.crossBelow} (${prevScore} → ${score})`,
    });
  }
  if (rules.confidenceAbove != null && conf > rules.confidenceAbove) {
    triggers.push({ type: 'smart_money_confidence', message: `Confidence ${conf}% > ${rules.confidenceAbove}%` });
  }
  if (curr.setup === 'LONG BUILDUP' && score >= 60) {
    triggers.push({ type: 'strong_long_buildup', message: 'Strong Long Buildup positioning proxy' });
  }
  if (curr.setup === 'SHORT BUILDUP' && score <= -60) {
    triggers.push({ type: 'strong_short_buildup', message: 'Strong Short Buildup positioning proxy' });
  }
  if (prev && prev.score <= -20 && score >= 20) {
    triggers.push({
      type: 'signal_flip_bullish',
      message: `Signal flipped Bearish → Bullish (${prev.score} → ${score})`,
    });
  }
  if (prev && prev.score >= 20 && score <= -20) {
    triggers.push({
      type: 'signal_flip_bearish',
      message: `Signal flipped Bullish → Bearish (${prev.score} → ${score})`,
    });
  }
  if (prevScore != null && Math.abs(score - prevScore) >= 25) {
    const dir = score > prevScore ? 'bullish' : 'bearish';
    triggers.push({
      type: 'score_acceleration',
      message: `Smart Money Proxy moved ${prevScore} → ${score} — strong ${dir} positioning detected`,
    });
  }
  return triggers;
}

module.exports = {
  DISCLAIMER,
  COMPONENT_CAPS,
  LABEL_BANDS,
  clamp,
  softSign,
  labelForScore,
  setupFromBuildup,
  normalizeInput,
  relativeVolumeBucket,
  scorePriceOi,
  scoreVolume,
  scoreVwap,
  scoreOptions,
  scoreSector,
  scoreFii,
  scoreMomentum,
  detectConflicts,
  computeConfidence,
  classifyTimeframes,
  computeSmartMoneyProxy,
  summarizeMarketBias,
  buildRankings,
  evaluateSmartMoneyAlert,
};
