'use strict';

/**
 * Opportunity Checklist / Trade Readiness engine.
 * Decision-support only — NOT buy/sell advice. Never fabricates missing data.
 */

const DISCLAIMER =
  'Opportunity Checklist — structured confirmation of positioning signals. READY means predefined confirmations passed; it is NOT a guarantee of trade success and is NOT a buy/sell recommendation.';

const WEIGHTS = Object.freeze({
  market: 10,
  sector: 10,
  price: 10,
  oi: 15,
  volume: 10,
  vwap: 10,
  options: 15,
  smartMoney: 10,
  mtf: 5,
  risk: 5,
});

const STATUS = Object.freeze({
  PASS: 'PASS',
  CAUTION: 'CAUTION',
  FAIL: 'FAIL',
  UNAVAILABLE: 'UNAVAILABLE',
});

function clamp(n, lo, hi) {
  const x = Number(n);
  if (!Number.isFinite(x)) return lo;
  return Math.max(lo, Math.min(hi, x));
}

function num(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function round(n, d = 1) {
  const x = Number(n);
  if (!Number.isFinite(x)) return null;
  const p = 10 ** d;
  return Math.round(x * p) / p;
}

function check(id, category, label, status, value = null, note = '', metrics = {}) {
  return { id, category, label, status, value, note, metrics };
}

function directionFromSetup(setup, smScore) {
  const s = String(setup || '').toUpperCase();
  if (s.includes('LONG BUILDUP') || s.includes('SHORT COVERING')) return 'BULLISH';
  if (s.includes('SHORT BUILDUP') || s.includes('LONG UNWINDING')) return 'BEARISH';
  const score = num(smScore, 0);
  if (score >= 20) return 'BULLISH';
  if (score <= -20) return 'BEARISH';
  return 'NEUTRAL';
}

function gradeFrom({ opportunityScore, confidence, conflictLevel, extension, criticalFails }) {
  const score = opportunityScore;
  const conf = confidence;
  if (criticalFails >= 2 || conflictLevel === 'HIGH') return 'AVOID';
  if (extension === 'HIGHLY_EXTENDED' && score >= 75) {
    if (conf >= 70) return 'B';
    return 'WATCH';
  }
  if (score >= 85 && conf >= 80 && conflictLevel === 'LOW' && extension !== 'HIGHLY_EXTENDED') return 'A+';
  if (score >= 75 && conf >= 70 && conflictLevel !== 'HIGH') return 'A';
  if (score >= 65 && conf >= 60) return 'B';
  if (score >= 50) return 'WATCH';
  return 'AVOID';
}

function readinessFrom({ grade, criticalMissing, conflictLevel, opportunityScore, confidence }) {
  if (grade === 'AVOID' || conflictLevel === 'HIGH' || opportunityScore < 50) {
    return { status: 'NOT_READY', label: 'NOT READY', stage: 'AVOID' };
  }
  if (criticalMissing.length === 0 && (grade === 'A+' || grade === 'A') && confidence >= 70) {
    return { status: 'READY', label: 'READY', stage: 'READY' };
  }
  if (opportunityScore >= 70 && criticalMissing.length <= 2) {
    return { status: 'WAIT', label: 'WAIT FOR CONFIRMATION', stage: 'CONFIRMING' };
  }
  if (opportunityScore >= 55) {
    return { status: 'WAIT', label: 'WAIT FOR CONFIRMATION', stage: 'WATCH' };
  }
  return { status: 'NOT_READY', label: 'NOT READY', stage: 'AVOID' };
}

function scoreMarket(ctx, direction) {
  const regime = ctx.regime || {};
  const score = num(regime.score);
  const conf = num(regime.confidence);
  const label = regime.label || null;
  const checks = [];
  let pts = 0;
  let available = false;

  if (score == null) {
    checks.push(check('market.regime', 'MARKET', 'Overall Market Regime', STATUS.UNAVAILABLE, null, 'DATA UNAVAILABLE'));
    checks.push(check('market.score', 'MARKET', 'Market Regime Score', STATUS.UNAVAILABLE));
    checks.push(check('market.conf', 'MARKET', 'Market Regime Confidence', STATUS.UNAVAILABLE));
  } else {
    available = true;
    const bullishEnv = score >= 55;
    const bearishEnv = score <= 45;
    let st = STATUS.CAUTION;
    if (direction === 'BULLISH' && bullishEnv) { st = STATUS.PASS; pts = 8; }
    else if (direction === 'BEARISH' && bearishEnv) { st = STATUS.PASS; pts = 8; }
    else if (direction === 'NEUTRAL' || (!bullishEnv && !bearishEnv)) { st = STATUS.CAUTION; pts = 4; }
    else { st = STATUS.FAIL; pts = 1; }
    if (conf != null && conf < 50 && st === STATUS.PASS) { st = STATUS.CAUTION; pts = Math.min(pts, 5); }
    checks.push(check('market.regime', 'MARKET', 'Overall Market Regime', st, label, `Regime ${label || '—'} supports ${direction.toLowerCase()} only if aligned`));
    checks.push(check('market.score', 'MARKET', 'Market Regime Score', st, score));
    checks.push(check('market.conf', 'MARKET', 'Market Regime Confidence', conf == null ? STATUS.UNAVAILABLE : (conf >= 55 ? STATUS.PASS : STATUS.CAUTION), conf));
  }

  const nifty = ctx.indices?.NIFTY;
  const bank = ctx.indices?.BANKNIFTY;
  const vix = ctx.indices?.INDIAVIX;
  for (const [id, q, name] of [
    ['market.nifty', nifty, 'NIFTY Trend'],
    ['market.bank', bank, 'BANKNIFTY Trend'],
  ]) {
    const chg = num(q?.changePct ?? q?.priceChangePct);
    if (chg == null) {
      checks.push(check(id, 'MARKET', name, STATUS.UNAVAILABLE));
    } else {
      available = true;
      let st = STATUS.CAUTION;
      if (direction === 'BULLISH' && chg >= 0.2) st = STATUS.PASS;
      else if (direction === 'BEARISH' && chg <= -0.2) st = STATUS.PASS;
      else if (direction === 'BULLISH' && chg <= -0.5) st = STATUS.FAIL;
      else if (direction === 'BEARISH' && chg >= 0.5) st = STATUS.FAIL;
      checks.push(check(id, 'MARKET', name, st, `${chg >= 0 ? '+' : ''}${round(chg, 2)}%`));
      if (st === STATUS.PASS) pts += 1;
      else if (st === STATUS.FAIL) pts -= 0.5;
    }
  }
  const vixChg = num(vix?.changePct ?? vix?.ltp);
  if (vix?.ltp == null && vixChg == null) {
    checks.push(check('market.vix', 'MARKET', 'India VIX / Volatility Context', STATUS.UNAVAILABLE));
  } else {
    available = true;
    const lvl = num(vix?.ltp);
    let st = STATUS.CAUTION;
    let note = 'VIX context only';
    if (lvl != null) {
      if (lvl >= 20) { st = STATUS.CAUTION; note = 'Elevated VIX — wider risk'; }
      else if (lvl <= 14) { st = STATUS.PASS; note = 'Contained VIX'; }
      else st = STATUS.CAUTION;
    }
    checks.push(check('market.vix', 'MARKET', 'India VIX / Volatility Context', st, lvl != null ? round(lvl, 2) : null, note));
  }
  checks.push(check('market.breadth', 'MARKET', 'Market Breadth', STATUS.UNAVAILABLE, null, 'Not wired into F&O regime'));

  pts = clamp(pts, 0, WEIGHTS.market);
  return { points: available ? round(pts, 1) : 0, max: WEIGHTS.market, available, checks };
}

function scoreSector(row, sectorStats, direction) {
  const checks = [];
  let pts = 0;
  const ret = num(sectorStats?.returnPct);
  const rank = num(sectorStats?.rank);
  const strength = num(sectorStats?.score);
  const ad = num(sectorStats?.advanceDecline);
  let available = ret != null || strength != null;

  if (!available) {
    ['Sector trend', 'Sector % change', 'Sector ranking', 'Sector relative strength', 'Sector breadth', "Stock's ranking within sector"]
      .forEach((label, i) => checks.push(check(`sector.${i}`, 'SECTOR', label, STATUS.UNAVAILABLE)));
    return { points: 0, max: WEIGHTS.sector, available: false, checks };
  }

  let st = STATUS.CAUTION;
  if (direction === 'BULLISH' && ret != null && ret >= 0.5) { st = STATUS.PASS; pts = 7; }
  else if (direction === 'BEARISH' && ret != null && ret <= -0.5) { st = STATUS.PASS; pts = 7; }
  else if (direction === 'BULLISH' && ret != null && ret <= -0.8) { st = STATUS.FAIL; pts = 1; }
  else if (direction === 'BEARISH' && ret != null && ret >= 0.8) { st = STATUS.FAIL; pts = 1; }
  else pts = 4;

  if (strength != null && ((direction === 'BULLISH' && strength >= 55) || (direction === 'BEARISH' && strength <= 45))) {
    pts = Math.min(WEIGHTS.sector, pts + 2);
    if (st !== STATUS.FAIL) st = STATUS.PASS;
  }

  checks.push(check('sector.trend', 'SECTOR', 'Sector trend', st, row.sector || null));
  checks.push(check('sector.chg', 'SECTOR', 'Sector % change', st, ret == null ? null : `${ret >= 0 ? '+' : ''}${round(ret, 2)}%`));
  checks.push(check('sector.rank', 'SECTOR', 'Sector ranking', rank == null ? STATUS.UNAVAILABLE : (rank <= 5 ? STATUS.PASS : STATUS.CAUTION), rank));
  checks.push(check('sector.rs', 'SECTOR', 'Sector relative strength', strength == null ? STATUS.UNAVAILABLE : st, strength));
  checks.push(check('sector.breadth', 'SECTOR', 'Sector breadth', ad == null ? STATUS.UNAVAILABLE : (ad >= 1 ? STATUS.PASS : STATUS.CAUTION), ad));
  checks.push(check('sector.stockRank', 'SECTOR', "Stock's ranking within sector", STATUS.UNAVAILABLE, null, 'Per-sector stock rank not precomputed'));

  return { points: round(clamp(pts, 0, WEIGHTS.sector), 1), max: WEIGHTS.sector, available: true, checks };
}

function scorePrice(row, direction) {
  const checks = [];
  const chg = num(row.priceChangePct);
  const high = num(row.high);
  const low = num(row.low);
  const open = num(row.open);
  const ltp = num(row.ltp);
  const prev = num(row.prevClose);
  let pts = 0;
  let available = chg != null;

  if (chg == null) {
    checks.push(check('price.trend', 'PRICE', 'Current trend', STATUS.UNAVAILABLE));
  } else {
    let st = STATUS.CAUTION;
    if (direction === 'BULLISH' && chg > 0.3) { st = STATUS.PASS; pts = 6; }
    else if (direction === 'BEARISH' && chg < -0.3) { st = STATUS.PASS; pts = 6; }
    else if (direction === 'BULLISH' && chg < -0.5) { st = STATUS.FAIL; pts = 1; }
    else if (direction === 'BEARISH' && chg > 0.5) { st = STATUS.FAIL; pts = 1; }
    else pts = 3;
    checks.push(check('price.trend', 'PRICE', 'Current trend', st, `${chg >= 0 ? '+' : ''}${round(chg, 2)}%`));
  }

  checks.push(check('price.hhhl', 'PRICE', 'Higher High / Higher Low structure', STATUS.UNAVAILABLE, null, 'Needs multi-bar structure'));
  const nearHigh = ltp != null && high != null && high > 0 ? ((high - ltp) / high) * 100 : null;
  const nearLow = ltp != null && low != null && low > 0 ? ((ltp - low) / low) * 100 : null;
  if (nearHigh == null) {
    checks.push(check('price.breakout', 'PRICE', 'Breakout / Breakdown', STATUS.UNAVAILABLE));
  } else {
    const rvol = num(row.relativeVolume);
    let st = STATUS.CAUTION;
    let note = 'Price near day extreme needs volume/OI confirmation';
    if (direction === 'BULLISH' && nearHigh <= 0.35 && rvol != null && rvol >= 1.5) {
      st = STATUS.PASS; pts = Math.min(WEIGHTS.price, pts + 3); note = 'Near day high with volume confirmation';
    } else if (direction === 'BEARISH' && nearLow <= 0.35 && rvol != null && rvol >= 1.5) {
      st = STATUS.PASS; pts = Math.min(WEIGHTS.price, pts + 3); note = 'Near day low with volume confirmation';
    } else if (direction === 'BULLISH' && nearHigh <= 0.35 && (rvol == null || rvol < 1.2)) {
      st = STATUS.CAUTION; note = 'Near high without strong volume — possible false breakout';
    }
    checks.push(check('price.breakout', 'PRICE', 'Breakout / Breakdown', st, nearHigh != null ? `dist high ${round(nearHigh, 2)}%` : null, note));
  }

  checks.push(check('price.pdh', 'PRICE', 'Previous Day High', prev == null ? STATUS.UNAVAILABLE : STATUS.CAUTION, prev, 'PDH used as proxy via prevClose when PDH series unavailable'));
  checks.push(check('price.pdl', 'PRICE', 'Previous Day Low', STATUS.UNAVAILABLE));
  checks.push(check('price.dayHigh', 'PRICE', 'Day High', high == null ? STATUS.UNAVAILABLE : STATUS.PASS, high));
  checks.push(check('price.dayLow', 'PRICE', 'Day Low', low == null ? STATUS.UNAVAILABLE : STATUS.PASS, low));
  checks.push(check('price.or', 'PRICE', 'Opening range', open == null ? STATUS.UNAVAILABLE : STATUS.CAUTION, open, 'Full OR high/low unavailable'));
  checks.push(check('price.support', 'PRICE', 'Support', low == null ? STATUS.UNAVAILABLE : STATUS.CAUTION, low, 'Proxy: day low'));
  checks.push(check('price.resist', 'PRICE', 'Resistance', high == null ? STATUS.UNAVAILABLE : STATUS.CAUTION, high, 'Proxy: day high'));
  checks.push(check('price.distSup', 'PRICE', 'Distance from support', nearLow == null ? STATUS.UNAVAILABLE : STATUS.CAUTION, nearLow == null ? null : `${round(nearLow, 2)}%`));
  checks.push(check('price.distRes', 'PRICE', 'Distance from resistance', nearHigh == null ? STATUS.UNAVAILABLE : STATUS.CAUTION, nearHigh == null ? null : `${round(nearHigh, 2)}%`));
  checks.push(check('price.ma', 'PRICE', 'Price vs key moving averages', STATUS.UNAVAILABLE, null, 'EMA series not in F&O path'));
  const mom = num(row.smartMoney?.components?.momentum?.score);
  checks.push(check('price.mom', 'PRICE', 'Momentum', mom == null ? STATUS.UNAVAILABLE : (Math.abs(mom) >= 2 ? STATUS.PASS : STATUS.CAUTION), mom));

  return { points: round(clamp(pts, 0, WEIGHTS.price), 1), max: WEIGHTS.price, available: available || high != null, checks };
}

function scoreOi(row, direction) {
  const checks = [];
  const price = num(row.priceChangePct);
  const oi = num(row.oiChangePct);
  const buildup = String(row.buildup || row.smartMoney?.buildup || 'NEUTRAL').toUpperCase();
  let pts = 0;
  const available = price != null && oi != null;

  if (!available) {
    ['Price direction', 'OI direction', 'Price + OI relationship', 'Current OI change %', 'OI concentration', 'Futures volume', 'Futures basis']
      .forEach((label, i) => checks.push(check(`oi.${i}`, 'OI', label, STATUS.UNAVAILABLE)));
    return { points: 0, max: WEIGHTS.oi, available: false, checks, buildup: 'NEUTRAL' };
  }

  let st = STATUS.CAUTION;
  let note = `${buildup.replace(/_/g, ' ')}`;
  const bullishSetup = buildup === 'LONG_BUILDUP' || buildup === 'SHORT_COVERING';
  const bearishSetup = buildup === 'SHORT_BUILDUP' || buildup === 'LONG_UNWINDING';
  if (direction === 'BULLISH' && bullishSetup) { st = STATUS.PASS; pts = buildup === 'LONG_BUILDUP' ? 13 : 10; }
  else if (direction === 'BEARISH' && bearishSetup) { st = STATUS.PASS; pts = buildup === 'SHORT_BUILDUP' ? 13 : 10; }
  else if ((direction === 'BULLISH' && bearishSetup) || (direction === 'BEARISH' && bullishSetup)) { st = STATUS.FAIL; pts = 2; }
  else pts = 6;

  if (buildup === 'SHORT_COVERING' && direction === 'BULLISH') {
    note = 'Price ↑ + OI ↓ → SHORT COVERING — bullish but potentially less durable';
    if (st === STATUS.PASS) pts = Math.min(pts, 11);
  }
  if (buildup === 'LONG_BUILDUP') note = 'Price ↑ + OI ↑ → LONG BUILDUP → bullish confirmation';
  if (buildup === 'SHORT_BUILDUP') note = 'Price ↓ + OI ↑ → SHORT BUILDUP → bearish confirmation';
  if (buildup === 'LONG_UNWINDING') note = 'Price ↓ + OI ↓ → LONG UNWINDING → weakness';

  checks.push(check('oi.price', 'OI', 'Price direction', price >= 0 ? STATUS.PASS : STATUS.CAUTION, `${price >= 0 ? '+' : ''}${round(price, 2)}%`));
  checks.push(check('oi.oi', 'OI', 'OI direction', oi >= 0 ? STATUS.PASS : STATUS.CAUTION, `${oi >= 0 ? '+' : ''}${round(oi, 2)}%`));
  checks.push(check('oi.rel', 'OI', 'Price + OI relationship', st, buildup.replace(/_/g, ' '), note));
  checks.push(check('oi.chg', 'OI', 'Current OI change %', Math.abs(oi) >= 3 ? STATUS.PASS : STATUS.CAUTION, `${round(oi, 2)}%`));
  checks.push(check('oi.conc', 'OI', 'OI concentration', STATUS.UNAVAILABLE));
  checks.push(check('oi.futVol', 'OI', 'Futures volume', row.volume == null ? STATUS.UNAVAILABLE : STATUS.PASS, row.volume));
  checks.push(check('oi.basis', 'OI', 'Futures basis', STATUS.UNAVAILABLE));

  return { points: round(clamp(pts, 0, WEIGHTS.oi), 1), max: WEIGHTS.oi, available: true, checks, buildup };
}

function scoreVolume(row, direction) {
  const checks = [];
  const rvol = num(row.relativeVolume);
  const chg = num(row.priceChangePct);
  let pts = 0;
  if (rvol == null) {
    ['Current volume', 'Relative Volume', 'Volume vs average', 'Volume expansion', 'Volume confirmation of price move', 'Volume confirmation of breakout']
      .forEach((label, i) => checks.push(check(`vol.${i}`, 'VOLUME', label, STATUS.UNAVAILABLE)));
    return { points: 0, max: WEIGHTS.volume, available: false, checks };
  }
  let st = STATUS.CAUTION;
  if (rvol >= 2 && chg != null && Math.abs(chg) >= 1) { st = STATUS.PASS; pts = 9; }
  else if (rvol >= 1.5) { st = STATUS.PASS; pts = 7; }
  else if (rvol >= 1.2) { st = STATUS.CAUTION; pts = 5; }
  else if (chg != null && Math.abs(chg) >= 1.5 && rvol < 1.1) { st = STATUS.FAIL; pts = 2; }
  else pts = 3;

  checks.push(check('vol.current', 'VOLUME', 'Current volume', row.volume == null ? STATUS.UNAVAILABLE : STATUS.PASS, row.volume));
  checks.push(check('vol.rvol', 'VOLUME', 'Relative Volume', st, `${round(rvol, 2)}x`));
  checks.push(check('vol.avg', 'VOLUME', 'Volume vs average', st, `${round(rvol, 2)}x`, 'RVOL is the average proxy'));
  checks.push(check('vol.exp', 'VOLUME', 'Volume expansion', rvol >= 1.5 ? STATUS.PASS : STATUS.CAUTION, rvol));
  checks.push(check('vol.px', 'VOLUME', 'Volume confirmation of price move', st, null, st === STATUS.FAIL ? 'Strong price move + weak volume' : ''));
  checks.push(check('vol.bo', 'VOLUME', 'Volume confirmation of breakout', rvol >= 2 ? STATUS.PASS : STATUS.CAUTION));

  return { points: round(clamp(pts, 0, WEIGHTS.volume), 1), max: WEIGHTS.volume, available: true, checks };
}

function scoreVwap(row, direction) {
  const checks = [];
  const rel = row.vwapRelation || (num(row.ltp) != null && num(row.vwap) != null
    ? (row.ltp >= row.vwap ? 'above' : 'below')
    : null);
  const ltp = num(row.ltp);
  const vwap = num(row.vwap);
  const dist = ltp != null && vwap != null && vwap !== 0 ? ((ltp - vwap) / vwap) * 100 : null;
  let pts = 0;
  if (!rel && dist == null) {
    ['Price vs VWAP', 'VWAP slope', 'Number of VWAP retests', 'Acceptance above/below VWAP', 'Intraday trend']
      .forEach((label, i) => checks.push(check(`vwap.${i}`, 'VWAP', label, STATUS.UNAVAILABLE)));
    return { points: 0, max: WEIGHTS.vwap, available: false, checks };
  }
  let st = STATUS.CAUTION;
  if (direction === 'BULLISH' && rel === 'above') { st = STATUS.PASS; pts = 7; }
  else if (direction === 'BEARISH' && rel === 'below') { st = STATUS.PASS; pts = 7; }
  else if (direction === 'BULLISH' && rel === 'below') { st = STATUS.FAIL; pts = 2; }
  else if (direction === 'BEARISH' && rel === 'above') { st = STATUS.FAIL; pts = 2; }
  else pts = 4;

  checks.push(check('vwap.px', 'VWAP', 'Price vs VWAP', st, rel, dist == null ? '' : `Distance ${round(dist, 2)}%`));
  checks.push(check('vwap.slope', 'VWAP', 'VWAP slope', STATUS.UNAVAILABLE, null, 'Not provided by F&O providers'));
  checks.push(check('vwap.retests', 'VWAP', 'Number of VWAP retests', STATUS.UNAVAILABLE));
  checks.push(check('vwap.accept', 'VWAP', 'Acceptance above/below VWAP', st, rel));
  checks.push(check('vwap.intraday', 'VWAP', 'Intraday trend', STATUS.UNAVAILABLE, null, 'Needs multi-TF candles'));

  return { points: round(clamp(pts, 0, WEIGHTS.vwap), 1), max: WEIGHTS.vwap, available: true, checks, distPct: dist };
}

function scoreOptions(row, direction, chainMetrics) {
  const checks = [];
  const pcr = num(row.pcr ?? chainMetrics?.pcr ?? chainMetrics?.metrics?.oiPcr);
  const iv = num(row.iv ?? chainMetrics?.atmIv);
  const ivChg = num(row.ivChangePct ?? row.ivChange);
  const em = chainMetrics?.expectedMove || null;
  let pts = 0;
  let alignment = 'NEUTRAL';
  let available = pcr != null || iv != null || em != null;

  if (!available) {
    for (const label of [
      'PCR', 'PCR trend/change', 'Call OI concentration', 'Put OI concentration', 'Call OI change', 'Put OI change',
      'Important strikes', 'Option support', 'Option resistance', 'IV', 'IV change', 'Option volume',
      'Unusual option activity', 'Expected Move',
    ]) {
      checks.push(check(`opt.${label}`, 'OPTIONS', label, STATUS.UNAVAILABLE));
    }
    return { points: 0, max: WEIGHTS.options, available: false, checks, alignment: 'NEUTRAL', expectedMove: null };
  }

  // PCR alone is not bullish/bearish — combine with price direction gently
  if (pcr != null) {
    let st = STATUS.CAUTION;
    let note = 'PCR evaluated with price context — not standalone';
    if (direction === 'BULLISH' && pcr >= 1.0 && num(row.priceChangePct, 0) > 0) {
      st = STATUS.PASS; pts += 5; alignment = 'SUPPORTIVE'; note = 'Elevated PCR with rising price — put wall / short-cover context possible';
    } else if (direction === 'BEARISH' && pcr <= 0.85 && num(row.priceChangePct, 0) < 0) {
      st = STATUS.PASS; pts += 5; alignment = 'SUPPORTIVE'; note = 'Low PCR with falling price — call-heavy / weak bid context';
    } else if (direction === 'BULLISH' && pcr < 0.7) {
      st = STATUS.CAUTION; pts += 3; alignment = 'NEUTRAL';
    } else {
      pts += 3;
    }
    checks.push(check('opt.pcr', 'OPTIONS', 'PCR', st, round(pcr, 2), note));
  } else {
    checks.push(check('opt.pcr', 'OPTIONS', 'PCR', STATUS.UNAVAILABLE));
  }
  checks.push(check('opt.pcrTrend', 'OPTIONS', 'PCR trend/change', STATUS.UNAVAILABLE));
  checks.push(check('opt.callOi', 'OPTIONS', 'Call OI concentration', chainMetrics?.callResistance ? STATUS.CAUTION : STATUS.UNAVAILABLE, chainMetrics?.callResistance?.strike ?? null, 'Interpret with price; not automatic resistance'));
  checks.push(check('opt.putOi', 'OPTIONS', 'Put OI concentration', chainMetrics?.putSupport ? STATUS.CAUTION : STATUS.UNAVAILABLE, chainMetrics?.putSupport?.strike ?? null, 'Interpret with price; not automatic support'));
  checks.push(check('opt.callChg', 'OPTIONS', 'Call OI change', STATUS.UNAVAILABLE));
  checks.push(check('opt.putChg', 'OPTIONS', 'Put OI change', STATUS.UNAVAILABLE));
  checks.push(check('opt.strikes', 'OPTIONS', 'Important strikes', chainMetrics ? STATUS.PASS : STATUS.UNAVAILABLE));
  checks.push(check('opt.sup', 'OPTIONS', 'Option support', chainMetrics?.putSupport ? STATUS.CAUTION : STATUS.UNAVAILABLE, chainMetrics?.putSupport?.strike ?? null));
  checks.push(check('opt.res', 'OPTIONS', 'Option resistance', chainMetrics?.callResistance ? STATUS.CAUTION : STATUS.UNAVAILABLE, chainMetrics?.callResistance?.strike ?? null));

  if (iv != null) {
    checks.push(check('opt.iv', 'OPTIONS', 'IV', STATUS.CAUTION, round(iv, 2), 'IV level alone is not directional'));
    pts += 2;
  } else checks.push(check('opt.iv', 'OPTIONS', 'IV', STATUS.UNAVAILABLE));
  if (ivChg != null) {
    const st = Math.abs(ivChg) >= 5 ? STATUS.CAUTION : STATUS.PASS;
    checks.push(check('opt.ivChg', 'OPTIONS', 'IV change', st, `${round(ivChg, 2)}%`));
    pts += 1;
  } else checks.push(check('opt.ivChg', 'OPTIONS', 'IV change', STATUS.UNAVAILABLE));
  checks.push(check('opt.optVol', 'OPTIONS', 'Option volume', STATUS.UNAVAILABLE));
  checks.push(check('opt.unusual', 'OPTIONS', 'Unusual option activity', STATUS.UNAVAILABLE));

  let expectedMove = null;
  if (em?.move != null && num(row.ltp) != null) {
    const spot = num(row.ltp);
    expectedMove = {
      move: em.move,
      lower: em.lower1sd ?? spot - em.move,
      upper: em.upper1sd ?? spot + em.move,
      spot,
    };
    checks.push(check('opt.em', 'OPTIONS', 'Expected Move', STATUS.PASS, `±${round(em.move, 2)}`));
    pts += 3;
  } else {
    checks.push(check('opt.em', 'OPTIONS', 'Expected Move', STATUS.UNAVAILABLE, null, 'Stock-level expected move needs option chain'));
  }

  // Soft conflict if SM options component is strongly against
  const optComp = num(row.smartMoney?.components?.options?.score);
  if (optComp != null) {
    if ((direction === 'BULLISH' && optComp <= -5) || (direction === 'BEARISH' && optComp >= 5)) {
      alignment = 'CONFLICTING';
      pts = Math.max(2, pts - 4);
    } else if ((direction === 'BULLISH' && optComp >= 8) || (direction === 'BEARISH' && optComp <= -8)) {
      alignment = 'STRONGLY SUPPORTIVE';
      pts = Math.min(WEIGHTS.options, pts + 3);
    }
  }

  return {
    points: round(clamp(pts, 0, WEIGHTS.options), 1),
    max: WEIGHTS.options,
    available: true,
    checks,
    alignment,
    expectedMove,
  };
}

function scoreSmartMoney(row) {
  const sm = row.smartMoney;
  const checks = [];
  if (!sm) {
    checks.push(check('sm.score', 'SMART_MONEY', 'Smart Money Score', STATUS.UNAVAILABLE));
    return { points: 0, max: WEIGHTS.smartMoney, available: false, checks };
  }
  const score = num(sm.score, 0);
  const conf = num(sm.confidence, 0);
  const abs = Math.abs(score);
  let pts = clamp((abs / 100) * WEIGHTS.smartMoney, 0, WEIGHTS.smartMoney);
  if (conf < 50) pts *= 0.7;
  const st = abs >= 60 ? STATUS.PASS : abs >= 30 ? STATUS.CAUTION : STATUS.FAIL;
  checks.push(check('sm.score', 'SMART_MONEY', 'Smart Money Score', st, score, 'SMART MONEY PROXY — STATISTICAL SIGNAL'));
  checks.push(check('sm.conf', 'SMART_MONEY', 'Smart Money Confidence', conf >= 70 ? STATUS.PASS : STATUS.CAUTION, conf));
  const comps = sm.components || {};
  for (const key of ['priceOi', 'volume', 'vwap', 'options', 'sector', 'fii', 'momentum']) {
    const c = comps[key];
    checks.push(check(`sm.${key}`, 'SMART_MONEY', key, c?.available === false ? STATUS.UNAVAILABLE : STATUS.PASS, c ? `${c.score}/${c.max}` : null));
  }
  return { points: round(pts, 1), max: WEIGHTS.smartMoney, available: true, checks, smartMoney: sm };
}

function scoreMtf(row) {
  const checks = [];
  const tf = row.smartMoney?.timeframes;
  const labels = tf?.labels || {};
  const keys = ['5M', '15M', '30M', '60M', 'DAILY'];
  let known = 0;
  let bullish = 0;
  for (const k of keys) {
    const v = labels[k];
    if (!v || v === 'N/A' || v === 'UNAVAILABLE') {
      checks.push(check(`mtf.${k}`, 'MTF', `${k} trend`, STATUS.UNAVAILABLE));
    } else {
      known += 1;
      const up = /BULL|LONG|UP/i.test(String(v));
      const down = /BEAR|SHORT|DOWN/i.test(String(v));
      if (up) bullish += 1;
      checks.push(check(`mtf.${k}`, 'MTF', `${k} trend`, up || down ? STATUS.PASS : STATUS.CAUTION, v));
    }
  }
  if (known === 0) {
    return {
      points: 0,
      max: WEIGHTS.mtf,
      available: false,
      checks,
      alignmentText: 'Multi-timeframe candles unavailable in F&O path',
      aligned: 0,
      total: 5,
    };
  }
  const pts = clamp((bullish / known) * WEIGHTS.mtf, 0, WEIGHTS.mtf);
  return {
    points: round(pts, 1),
    max: WEIGHTS.mtf,
    available: true,
    checks,
    alignmentText: `${bullish}/${known} bullish among available TFs`,
    aligned: bullish,
    total: known,
  };
}

function scoreRisk(row, direction, expectedMove, vwapDist) {
  const checks = [];
  let pts = WEIGHTS.risk;
  let extension = 'LOW_RISK';
  const chg = Math.abs(num(row.priceChangePct, 0));
  const ltp = num(row.ltp);
  const high = num(row.high);
  const low = num(row.low);

  checks.push(check('risk.vwapDist', 'RISK', 'Distance from VWAP', vwapDist == null ? STATUS.UNAVAILABLE : (Math.abs(vwapDist) > 1.5 ? STATUS.CAUTION : STATUS.PASS), vwapDist == null ? null : `${round(vwapDist, 2)}%`));
  checks.push(check('risk.ema20', 'RISK', 'Distance from 20 EMA', STATUS.UNAVAILABLE));
  checks.push(check('risk.ema50', 'RISK', 'Distance from 50 EMA', STATUS.UNAVAILABLE));

  const distHigh = ltp != null && high != null && high > 0 ? ((high - ltp) / high) * 100 : null;
  const distLow = ltp != null && low != null && low > 0 ? ((ltp - low) / low) * 100 : null;
  checks.push(check('risk.dayExt', 'RISK', "Distance from day's high/low", distHigh == null ? STATUS.UNAVAILABLE : STATUS.CAUTION, distHigh == null ? null : `high ${round(distHigh, 2)}% / low ${round(distLow, 2)}%`));
  checks.push(check('risk.sup', 'RISK', 'Distance from support', distLow == null ? STATUS.UNAVAILABLE : STATUS.CAUTION, distLow));
  checks.push(check('risk.res', 'RISK', 'Distance from resistance', distHigh == null ? STATUS.UNAVAILABLE : STATUS.CAUTION, distHigh));

  let roomOk = true;
  if (expectedMove && ltp != null) {
    const { lower, upper, move } = expectedMove;
    const roomUp = upper - ltp;
    const roomDown = ltp - lower;
    const room = direction === 'BEARISH' ? roomDown : roomUp;
    const roomPct = move > 0 ? (room / move) * 100 : null;
    if (roomPct != null && roomPct < 25) {
      roomOk = false;
      extension = 'HIGHLY_EXTENDED';
      pts = 1;
      checks.push(check('risk.emRoom', 'RISK', 'Expected Move remaining', STATUS.FAIL, `${round(roomPct, 0)}% room`, 'Limited room toward expected move'));
    } else if (roomPct != null && roomPct < 45) {
      extension = 'MODERATE_EXTENSION';
      pts = 3;
      checks.push(check('risk.emRoom', 'RISK', 'Expected Move remaining', STATUS.CAUTION, `${round(roomPct, 0)}% room`));
    } else {
      checks.push(check('risk.emRoom', 'RISK', 'Expected Move remaining', STATUS.PASS, roomPct == null ? null : `${round(roomPct, 0)}% room`));
    }
  } else {
    checks.push(check('risk.emRoom', 'RISK', 'Expected Move remaining', STATUS.UNAVAILABLE));
  }

  if (chg >= 3.5 || (vwapDist != null && Math.abs(vwapDist) >= 2)) {
    extension = extension === 'HIGHLY_EXTENDED' ? extension : 'MODERATE_EXTENSION';
    pts = Math.min(pts, 2);
    checks.push(check('risk.ext', 'RISK', 'Recent price extension', STATUS.CAUTION, `${round(chg, 2)}% day move`));
  } else {
    checks.push(check('risk.ext', 'RISK', 'Recent price extension', STATUS.PASS, `${round(chg, 2)}% day move`));
  }
  checks.push(check('risk.atr', 'RISK', 'ATR', STATUS.UNAVAILABLE));
  checks.push(check('risk.vol', 'RISK', 'Volatility', row.iv == null ? STATUS.UNAVAILABLE : STATUS.CAUTION, row.iv));

  if (roomOk && extension === 'LOW_RISK') pts = WEIGHTS.risk;
  return {
    points: round(clamp(pts, 0, WEIGHTS.risk), 1),
    max: WEIGHTS.risk,
    available: true,
    checks,
    extension,
  };
}

function scoreFii(ctx, direction) {
  const checks = [];
  const fiiNet = num(ctx.fii?.cash?.fiiNet);
  const label = ctx.fii?.positioningRegime?.label || null;
  if (fiiNet == null && !label) {
    checks.push(check('fii.net', 'FII', 'FII Net Position', STATUS.UNAVAILABLE, null, 'Index/market context only — not stock-level'));
    checks.push(check('fii.fut', 'FII', 'FII Futures Positioning', STATUS.UNAVAILABLE));
    return { checks, available: false };
  }
  let st = STATUS.CAUTION;
  if (direction === 'BULLISH' && (fiiNet >= 500 || /BULLISH/i.test(label || ''))) st = STATUS.PASS;
  if (direction === 'BEARISH' && (fiiNet <= -500 || /BEARISH/i.test(label || ''))) st = STATUS.PASS;
  if (direction === 'BULLISH' && fiiNet <= -2000) st = STATUS.FAIL;
  if (direction === 'BEARISH' && fiiNet >= 2000) st = STATUS.FAIL;
  checks.push(check('fii.net', 'FII', 'FII Net Position (cash)', st, fiiNet, 'Market context only — do not attribute to this stock'));
  checks.push(check('fii.fut', 'FII', 'Index Futures Long/Short', STATUS.UNAVAILABLE, null, ctx.fii?.futures?.note || 'Unavailable'));
  checks.push(check('fii.trend', 'FII', 'FII/DII Trend', label ? st : STATUS.UNAVAILABLE, label));
  return { checks, available: true };
}

function buildWaitFor({ direction, checksByCat, row, opportunityScore, confidence }) {
  const waiting = [];
  const rvol = num(row.relativeVolume);
  const rel = row.vwapRelation;
  const ltp = num(row.ltp);
  const high = num(row.high);
  const vwap = num(row.vwap);

  const pushTrig = (id, label, current, required, priority, why) => {
    waiting.push({
      id,
      label,
      current,
      required,
      status: 'WAIT',
      priority,
      why,
    });
  };

  if (direction === 'BULLISH') {
    if (rvol == null || rvol < 1.5) {
      pushTrig('rvol', 'Relative volume expansion', rvol == null ? '—' : `${round(rvol, 2)}x`, '> 1.50x', 10, 'Volume confirmation improves durability of the move');
    }
    if (rel === 'below' || (checksByCat.VWAP || []).some((c) => c.id === 'vwap.px' && c.status === STATUS.FAIL)) {
      pushTrig('vwap', 'Reclaim / hold VWAP', rel || '—', 'Sustain above VWAP', 20, 'Bullish setups prefer acceptance above VWAP');
    }
    if (ltp != null && high != null && high - ltp > 0 && ((high - ltp) / high) * 100 > 0.4) {
      pushTrig('breakout', 'Break & sustain day/resistance', `CMP ${round(ltp, 2)}`, `Sustain above ${round(high, 2)}`, 15, 'Breakout confirmation with volume');
    }
  } else if (direction === 'BEARISH') {
    if (rvol == null || rvol < 1.5) {
      pushTrig('rvol', 'Relative volume expansion', rvol == null ? '—' : `${round(rvol, 2)}x`, '> 1.50x', 10, 'Volume confirmation on downside');
    }
    if (rel === 'above') {
      pushTrig('vwap', 'Reject / hold below VWAP', rel, 'Sustain below VWAP', 20, 'Bearish setups prefer rejection at VWAP');
    }
    if (ltp != null && num(row.low) != null) {
      pushTrig('breakdown', 'Break & sustain day low/support', `CMP ${round(ltp, 2)}`, `Sustain below ${round(row.low, 2)}`, 15, 'Breakdown confirmation');
    }
  }

  // MTF always a common waiter when unavailable or weak
  const mtfFail = (checksByCat.MTF || []).filter((c) => c.status === STATUS.UNAVAILABLE || c.status === STATUS.CAUTION);
  if (mtfFail.length >= 3) {
    pushTrig('mtf', '15m/30m trend confirmation', 'N/A or mixed', direction === 'BEARISH' ? 'Bearish short-term TFs' : 'Bullish short-term TFs', 12, 'Higher-resolution trend confirmation missing in F&O path');
  }

  const sectorFail = (checksByCat.SECTOR || []).find((c) => c.status === STATUS.FAIL || c.status === STATUS.CAUTION);
  if (sectorFail && sectorFail.status === STATUS.FAIL) {
    pushTrig('sector', 'Sector alignment', String(sectorFail.value ?? 'weak'), 'Sector turns in trade direction', 8, 'Sector divergence vs stock direction');
  }

  waiting.sort((a, b) => b.priority - a.priority);
  const top = waiting.slice(0, 5);
  const potentialScore = round(clamp(opportunityScore + Math.min(12, top.length * 4), 0, 100), 0);
  const potentialConfidence = round(clamp(confidence + Math.min(12, top.length * 3), 0, 100), 0);

  return {
    triggers: top,
    topTrigger: top[0] || null,
    scenario: {
      note: 'Scenario estimate only — not a prediction. Recalculate with live engine if conditions occur.',
      currentScore: opportunityScore,
      potentialScore,
      currentConfidence: confidence,
      potentialConfidence,
    },
  };
}

function buildInvalidation(direction, row, vwap) {
  const items = [];
  const ltp = num(row.ltp);
  const low = num(row.low);
  const high = num(row.high);
  if (direction === 'BULLISH') {
    if (vwap != null) items.push({ text: `Price falls below VWAP (${round(vwap, 2)})`, level: vwap });
    if (low != null) items.push({ text: `Loses day support / low near ${round(low, 2)}`, level: low });
    items.push({ text: 'Long buildup reverses into long unwinding', level: null });
    items.push({ text: 'Sector loses relative strength vs peers', level: null });
    items.push({ text: 'Volume fails on breakout attempts', level: null });
  } else if (direction === 'BEARISH') {
    if (vwap != null) items.push({ text: `Price reclaims VWAP (${round(vwap, 2)})`, level: vwap });
    if (high != null) items.push({ text: `Reclaims day high / resistance near ${round(high, 2)}`, level: high });
    items.push({ text: 'Short buildup reverses into short covering', level: null });
    items.push({ text: 'Sector strengthens against short thesis', level: null });
  } else {
    items.push({ text: 'Directional buildup fails to emerge with volume', level: null });
  }
  items.push({ text: 'Options positioning becomes strongly conflicting', level: null });
  return {
    summary: direction === 'BULLISH' && low != null
      ? `Bullish thesis weakens materially below ${round(low, 2)}`
      : direction === 'BEARISH' && high != null
        ? `Bearish thesis weakens materially above ${round(high, 2)}`
        : 'Thesis weakens if primary buildup and VWAP structure reverse',
    items,
  };
}

function explainOpportunity(result) {
  const bits = [];
  bits.push(`${result.direction} setup via ${result.setup}.`);
  const strong = result.strongestFactors.slice(0, 3).map((s) => s.text);
  if (strong.length) bits.push(`Confirming: ${strong.join('; ')}.`);
  const weak = result.weakestFactors.slice(0, 2).map((s) => s.text);
  if (weak.length) bits.push(`Caveats: ${weak.join('; ')}.`);
  if (result.conflict.level !== 'LOW') bits.push(`Conflict level ${result.conflict.level}.`);
  if (result.extension === 'HIGHLY_EXTENDED') bits.push('Price appears extended vs expected-move/day range — score capped.');
  bits.push(`Grade ${result.grade} with opportunity ${result.opportunityScore}/100 and confidence ${result.confidence}%.`);
  return bits.join(' ');
}

/**
 * Evaluate one scanner row (+ context) into full opportunity checklist.
 * @param {object} row - enriched FO scanner row (includes smartMoney)
 * @param {object} ctx - { regime, indices, sectorStats, fii, chainMetrics? }
 */
function evaluateOpportunity(row, ctx = {}) {
  if (!row || typeof row !== 'object') {
    return {
      symbol: null,
      opportunityScore: 0,
      confidence: 0,
      grade: 'AVOID',
      readiness: { status: 'NOT_READY', label: 'NOT READY', stage: 'AVOID' },
      disclaimer: DISCLAIMER,
      checks: [],
      unavailableFields: ['row'],
    };
  }

  const sm = row.smartMoney || {};
  const setup = sm.setup || String(row.buildup || 'MIXED').replace(/_/g, ' ');
  const direction = directionFromSetup(setup, sm.score);
  const sectorStats = ctx.sectorStats || null;

  const market = scoreMarket(ctx, direction);
  const sector = scoreSector(row, sectorStats, direction);
  const price = scorePrice(row, direction);
  const oi = scoreOi(row, direction);
  const volume = scoreVolume(row, direction);
  const vwap = scoreVwap(row, direction);
  const options = scoreOptions(row, direction, ctx.chainMetrics || null);
  const smartMoney = scoreSmartMoney(row);
  const mtf = scoreMtf(row);
  const risk = scoreRisk(row, direction, options.expectedMove, vwap.distPct);
  const fii = scoreFii(ctx, direction);

  const components = {
    market: { score: market.points, max: market.max, available: market.available },
    sector: { score: sector.points, max: sector.max, available: sector.available },
    price: { score: price.points, max: price.max, available: price.available },
    oi: { score: oi.points, max: oi.max, available: oi.available },
    volume: { score: volume.points, max: volume.max, available: volume.available },
    vwap: { score: vwap.points, max: vwap.max, available: vwap.available },
    options: { score: options.points, max: options.max, available: options.available },
    smartMoney: { score: smartMoney.points, max: smartMoney.max, available: smartMoney.available },
    mtf: { score: mtf.points, max: mtf.max, available: mtf.available },
    risk: { score: risk.points, max: risk.max, available: risk.available },
  };

  const earned = Object.values(components).reduce((a, c) => a + (c.available ? c.score : 0), 0);
  const possible = Object.values(components).reduce((a, c) => a + (c.available ? c.max : 0), 0);
  // Scale to 0–100 on available weight only (missing data does not invent points)
  let opportunityScore = possible > 0 ? (earned / possible) * 100 : 0;
  if (risk.extension === 'HIGHLY_EXTENDED') opportunityScore = Math.min(opportunityScore, 78);
  opportunityScore = round(clamp(opportunityScore, 0, 100), 0);

  const allChecks = [
    ...market.checks,
    ...sector.checks,
    ...price.checks,
    ...oi.checks,
    ...volume.checks,
    ...vwap.checks,
    ...options.checks,
    ...smartMoney.checks,
    ...mtf.checks,
    ...fii.checks,
    ...risk.checks,
  ];

  const pass = allChecks.filter((c) => c.status === STATUS.PASS).length;
  const caution = allChecks.filter((c) => c.status === STATUS.CAUTION).length;
  const fail = allChecks.filter((c) => c.status === STATUS.FAIL).length;
  const unavailable = allChecks.filter((c) => c.status === STATUS.UNAVAILABLE).length;
  const assessed = pass + caution + fail;
  const completeness = allChecks.length ? (assessed / allChecks.length) : 0;

  let confidence = 40;
  confidence += completeness * 25;
  confidence += Math.min(20, pass * 1.2);
  confidence -= Math.min(25, fail * 4);
  confidence -= Math.min(10, caution * 0.4);
  if (num(sm.confidence) != null) confidence = confidence * 0.7 + num(sm.confidence) * 0.3;
  if (mtf.available && mtf.total > 0) confidence += (mtf.aligned / mtf.total) * 8;
  confidence = round(clamp(confidence, 0, 100), 0);

  const bullishChecks = allChecks.filter((c) => c.status === STATUS.PASS && ['OI', 'VOLUME', 'VWAP', 'SECTOR', 'PRICE'].includes(c.category));
  const failChecks = allChecks.filter((c) => c.status === STATUS.FAIL);
  let conflictLevel = 'LOW';
  if (failChecks.length >= 3) conflictLevel = 'HIGH';
  else if (failChecks.length >= 1 || (direction !== 'NEUTRAL' && caution >= 8)) conflictLevel = 'MEDIUM';

  if (conflictLevel === 'HIGH') confidence = Math.min(confidence, 55);
  if (conflictLevel === 'MEDIUM') confidence = Math.min(confidence, 78);

  const criticalFails = failChecks.filter((c) => ['OI', 'VOLUME', 'VWAP', 'SECTOR', 'MARKET'].includes(c.category)).length;
  const grade = gradeFrom({
    opportunityScore,
    confidence,
    conflictLevel,
    extension: risk.extension,
    criticalFails,
  });

  const checksByCat = {};
  for (const c of allChecks) {
    if (!checksByCat[c.category]) checksByCat[c.category] = [];
    checksByCat[c.category].push(c);
  }

  const wait = buildWaitFor({
    direction,
    checksByCat,
    row,
    opportunityScore,
    confidence,
  });
  const criticalMissing = wait.triggers.map((t) => t.label);
  const readiness = readinessFrom({
    grade,
    criticalMissing: readinessNeeds(components, direction, row),
    conflictLevel,
    opportunityScore,
    confidence,
  });

  const strongestFactors = [];
  if (oi.points >= 10) strongestFactors.push({ text: `${String(oi.buildup || setup).replace(/_/g, ' ')}`, category: 'OI' });
  if (volume.points >= 7) strongestFactors.push({ text: `RVOL ${num(row.relativeVolume) != null ? `${round(row.relativeVolume, 2)}x` : 'elevated'}`, category: 'VOLUME' });
  if (vwap.points >= 6) strongestFactors.push({ text: `Price ${row.vwapRelation || 'vs'} VWAP`, category: 'VWAP' });
  if (sector.points >= 6) strongestFactors.push({ text: `Sector ${row.sector || ''} supportive`, category: 'SECTOR' });
  if (options.alignment.includes('SUPPORT')) strongestFactors.push({ text: `Options ${options.alignment}`, category: 'OPTIONS' });
  if (smartMoney.points >= 6) strongestFactors.push({ text: `Smart Money proxy ${sm.score >= 0 ? '+' : ''}${sm.score}`, category: 'SMART_MONEY' });

  const weakestFactors = [];
  for (const c of failChecks.slice(0, 4)) weakestFactors.push({ text: `${c.label}: ${c.note || c.value || 'FAIL'}`, category: c.category });
  if (risk.extension !== 'LOW_RISK') weakestFactors.push({ text: `Extension: ${risk.extension.replace(/_/g, ' ')}`, category: 'RISK' });
  if (options.alignment === 'CONFLICTING') weakestFactors.push({ text: 'Options conflicting', category: 'OPTIONS' });

  const bucket =
    readiness.status === 'READY' ? 'READY_NOW'
      : conflictLevel === 'HIGH' || grade === 'AVOID' ? 'CONFLICTED'
        : readiness.stage === 'WATCH' || readiness.stage === 'CONFIRMING' ? 'EARLY'
          : grade === 'AVOID' ? 'AVOID'
            : 'EARLY';

  const levels = {
    support: [num(row.low), options.expectedMove?.lower].filter((x) => x != null),
    resistance: [num(row.high), options.expectedMove?.upper].filter((x) => x != null),
  };

  const result = {
    symbol: row.symbol,
    sector: row.sector || null,
    ltp: num(row.ltp),
    priceChangePct: num(row.priceChangePct),
    smartMoneyScore: num(sm.score),
    smartMoneyConfidence: num(sm.confidence),
    oiSignal: String(row.buildup || oi.buildup || 'NEUTRAL'),
    sectorStrength: num(sectorStats?.score),
    relativeVolume: num(row.relativeVolume),
    vwapRelation: row.vwapRelation || null,
    optionsAlignment: options.alignment,
    momentum: num(sm.components?.momentum?.score),
    opportunityScore,
    confidence,
    grade,
    setup,
    direction,
    primarySetup: setup,
    readiness,
    bucket,
    extension: risk.extension,
    components,
    categories: checksByCat,
    checks: allChecks,
    conflict: {
      level: conflictLevel,
      bullish: bullishChecks.map((c) => c.label),
      bearish: failChecks.map((c) => c.label),
      neutral: allChecks.filter((c) => c.status === STATUS.UNAVAILABLE).slice(0, 6).map((c) => c.label),
    },
    waitFor: wait,
    invalidation: buildInvalidation(direction, row, num(row.vwap)),
    strongestFactors,
    weakestFactors,
    expectedMove: options.expectedMove,
    levels,
    stats: { pass, caution, fail, unavailable },
    smartMoneyBreakdown: sm.components || null,
    mtf: { text: mtf.alignmentText, aligned: mtf.aligned, total: mtf.total },
    unavailableFields: allChecks.filter((c) => c.status === STATUS.UNAVAILABLE).map((c) => c.label),
    disclaimer: DISCLAIMER,
  };
  result.why = explainOpportunity(result);
  result.summary = {
    direction: result.direction,
    setup: result.setup,
    opportunity: result.opportunityScore,
    confidence: result.confidence,
    grade: result.grade,
    readiness: result.readiness.label,
    conflict: result.conflict.level,
    expectedMove: result.expectedMove,
    levels: result.levels,
    strongestFactors: result.strongestFactors,
    weakestFactors: result.weakestFactors,
  };
  return result;
}

function readinessNeeds(components, direction, row) {
  const missing = [];
  if (!components.volume.available || components.volume.score < 5) missing.push('volume');
  if (!components.vwap.available || components.vwap.score < 5) missing.push('vwap');
  if (!components.oi.available || components.oi.score < 8) missing.push('oi');
  if (!components.sector.available || components.sector.score < 4) missing.push('sector');
  if (direction === 'BULLISH' && row.vwapRelation === 'below') missing.push('vwap_hold');
  if (direction === 'BEARISH' && row.vwapRelation === 'above') missing.push('vwap_reject');
  return missing;
}

function buildOpportunityUniverse(rows, ctx = {}) {
  const evaluated = (rows || []).map((row) => {
    const sectorStats = ctx.sectorsByName?.get?.(row.sector) || ctx.sectorStatsBySymbol?.[row.symbol] || null;
    return evaluateOpportunity(row, { ...ctx, sectorStats });
  });
  evaluated.sort((a, b) => b.opportunityScore - a.opportunityScore || b.confidence - a.confidence);
  evaluated.forEach((r, i) => { r.rank = i + 1; });

  const top = (pred, n = 10) => evaluated.filter(pred).slice(0, n);
  const rankings = {
    topBullish: top((r) => r.direction === 'BULLISH' && r.opportunityScore >= 55),
    topBearish: top((r) => r.direction === 'BEARISH' && r.opportunityScore >= 55),
    topShortCovering: top((r) => r.oiSignal === 'SHORT_COVERING'),
    topLongUnwinding: top((r) => r.oiSignal === 'LONG_UNWINDING'),
    readyNow: top((r) => r.bucket === 'READY_NOW'),
    early: top((r) => r.bucket === 'EARLY'),
    conflicted: top((r) => r.bucket === 'CONFLICTED'),
    avoid: top((r) => r.grade === 'AVOID'),
    watchlist: top((r) => r.readiness.status === 'WAIT' && r.opportunityScore >= 65),
  };

  return {
    disclaimer: DISCLAIMER,
    rows: evaluated,
    rankings,
    heatmap: evaluated.slice(0, 40).map((r) => ({
      symbol: r.symbol,
      opportunityScore: r.opportunityScore,
      confidence: r.confidence,
      grade: r.grade,
      direction: r.direction,
    })),
  };
}

function filterOpportunityRows(rows, filter = {}) {
  let out = [...(rows || [])];
  const f = String(filter.filter || filter.preset || '').toUpperCase();
  if (f === 'A+' || f === 'APLUS') out = out.filter((r) => r.grade === 'A+');
  if (f === 'A' || f === 'A_AND_A+') out = out.filter((r) => r.grade === 'A' || r.grade === 'A+');
  if (f === 'BULLISH') out = out.filter((r) => r.direction === 'BULLISH');
  if (f === 'BEARISH') out = out.filter((r) => r.direction === 'BEARISH');
  if (f === 'LONG_BUILDUP') out = out.filter((r) => r.oiSignal === 'LONG_BUILDUP');
  if (f === 'SHORT_COVERING') out = out.filter((r) => r.oiSignal === 'SHORT_COVERING');
  if (f === 'SHORT_BUILDUP') out = out.filter((r) => r.oiSignal === 'SHORT_BUILDUP');
  if (f === 'LONG_UNWINDING') out = out.filter((r) => r.oiSignal === 'LONG_UNWINDING');
  if (f === 'HIGH_CONFIDENCE') out = out.filter((r) => r.confidence >= 80);
  if (f === 'HIGH_VOLUME') out = out.filter((r) => (r.relativeVolume || 0) >= 1.5);
  if (f === 'ABOVE_VWAP') out = out.filter((r) => r.vwapRelation === 'above');
  if (f === 'STRONG_SECTOR') out = out.filter((r) => (r.sectorStrength || 0) >= 55);
  if (f === 'READY') out = out.filter((r) => r.readiness?.status === 'READY');
  if (f === 'EARLY' || f === 'WATCH') out = out.filter((r) => r.bucket === 'EARLY' || r.readiness?.status === 'WAIT');

  const sort = String(filter.sort || 'opportunityScore');
  const dir = String(filter.dir || 'desc').toLowerCase() === 'asc' ? 1 : -1;
  const keyMap = {
    opportunityScore: (r) => r.opportunityScore,
    smartMoneyScore: (r) => r.smartMoneyScore ?? -999,
    confidence: (r) => r.confidence,
    volume: (r) => r.relativeVolume ?? -999,
    sectorStrength: (r) => r.sectorStrength ?? -999,
    momentum: (r) => r.momentum ?? -999,
    dayPct: (r) => r.priceChangePct ?? -999,
    oiSignal: (r) => String(r.oiSignal || ''),
  };
  const getter = keyMap[sort] || keyMap.opportunityScore;
  out.sort((a, b) => {
    const av = getter(a);
    const bv = getter(b);
    if (typeof av === 'string') return av.localeCompare(bv) * dir;
    return (av - bv) * dir;
  });
  return out;
}

module.exports = {
  DISCLAIMER,
  WEIGHTS,
  STATUS,
  evaluateOpportunity,
  buildOpportunityUniverse,
  filterOpportunityRows,
  directionFromSetup,
  gradeFrom,
};
