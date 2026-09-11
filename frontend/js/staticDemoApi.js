/* frontend/js/staticDemoApi.js
 * Browser-side labeled MOCK for static hosts (GitHub Pages / Vercel).
 * Used only when /api/fno/* is unavailable.
 */
(function (global) {
  'use strict';

  const META = {
    asOf: new Date().toISOString(),
    source: 'static-demo',
    isMock: true,
    stale: false,
    warning: 'STATIC DEMO — labeled mock for shareable GitHub/Vercel hosting (not live NSE/Dhan)',
  };

  const env = (data, extra = {}) => ({ data, meta: { ...META, ...extra } });

  function hash01(seed) {
    let h = 2166136261;
    const s = String(seed);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return ((h >>> 0) % 10000) / 10000;
  }

  const SECTORS = {
    BANKING: ['HDFCBANK', 'ICICIBANK', 'SBIN', 'KOTAKBANK', 'AXISBANK'],
    IT: ['TCS', 'INFY', 'WIPRO', 'HCLTECH', 'TECHM'],
    AUTO: ['TATAMOTORS', 'MARUTI', 'M&M', 'BAJAJ-AUTO'],
    ENERGY: ['RELIANCE', 'ONGC', 'NTPC', 'POWERGRID'],
    FINANCE: ['BAJFINANCE', 'HDFCLIFE', 'SBILIFE'],
    PHARMA: ['SUNPHARMA', 'DRREDDY', 'CIPLA'],
    METALS: ['TATASTEEL', 'HINDALCO', 'JSWSTEEL'],
  };

  const SAMPLE = [
    { symbol: 'RELIANCE', sector: 'ENERGY', ltp: 2985.4, priceChangePct: 1.2, oiChangePct: 3.4 },
    { symbol: 'HDFCBANK', sector: 'BANKING', ltp: 1682.1, priceChangePct: 2.1, oiChangePct: 8.4 },
    { symbol: 'TCS', sector: 'IT', ltp: 4125.0, priceChangePct: -1.6, oiChangePct: 2.8 },
    { symbol: 'INFY', sector: 'IT', ltp: 1888.5, priceChangePct: -2.0, oiChangePct: 7.8 },
    { symbol: 'ICICIBANK', sector: 'BANKING', ltp: 1245.2, priceChangePct: 1.8, oiChangePct: 6.2 },
    { symbol: 'SBIN', sector: 'BANKING', ltp: 812.3, priceChangePct: 1.1, oiChangePct: 4.5 },
    { symbol: 'TATAMOTORS', sector: 'AUTO', ltp: 975.6, priceChangePct: 2.3, oiChangePct: 5.1 },
    { symbol: 'BAJFINANCE', sector: 'FINANCE', ltp: 7120.0, priceChangePct: -1.6, oiChangePct: 2.8 },
    { symbol: 'MARUTI', sector: 'AUTO', ltp: 12450, priceChangePct: 0.4, oiChangePct: -0.9 },
    { symbol: 'ITC', sector: 'OTHER', ltp: 465.2, priceChangePct: -0.3, oiChangePct: 1.1 },
    { symbol: 'LT', sector: 'OTHER', ltp: 3520, priceChangePct: -1.4, oiChangePct: 3.2 },
    { symbol: 'SUNPHARMA', sector: 'PHARMA', ltp: 1680, priceChangePct: -0.8, oiChangePct: 2.1 },
    { symbol: 'TATASTEEL', sector: 'METALS', ltp: 158, priceChangePct: -1.2, oiChangePct: 4.0 },
    { symbol: 'AXISBANK', sector: 'BANKING', ltp: 1120, priceChangePct: 1.4, oiChangePct: 5.0 },
    { symbol: 'KOTAKBANK', sector: 'BANKING', ltp: 1780, priceChangePct: 0.9, oiChangePct: 3.8 },
  ];

  function classify(price, oi) {
    if (Math.abs(price) < 0.05 || Math.abs(oi) < 0.05) return 'NEUTRAL';
    if (price > 0 && oi > 0) return 'LONG_BUILDUP';
    if (price < 0 && oi > 0) return 'SHORT_BUILDUP';
    if (price > 0 && oi < 0) return 'SHORT_COVERING';
    return 'LONG_UNWINDING';
  }

  function setupLabel(buildup) {
    return ({
      LONG_BUILDUP: 'LONG BUILDUP',
      SHORT_BUILDUP: 'SHORT BUILDUP',
      SHORT_COVERING: 'SHORT COVERING',
      LONG_UNWINDING: 'LONG UNWINDING',
    })[buildup] || 'MIXED';
  }

  function signalFor(score) {
    if (score >= 80) return 'VERY STRONG LONG';
    if (score >= 60) return 'STRONG LONG';
    if (score >= 40) return 'LONG';
    if (score >= 20) return 'MILD LONG';
    if (score > -20) return 'NEUTRAL';
    if (score > -40) return 'MILD SHORT';
    if (score > -60) return 'SHORT';
    if (score > -80) return 'STRONG SHORT';
    return 'VERY STRONG SHORT';
  }

  function makeSmart(row) {
    const buildup = classify(row.priceChangePct, row.oiChangePct);
    const setup = setupLabel(buildup);
    const rvol = row.relativeVolume;
    const dir = Math.sign(row.priceChangePct) || (buildup.includes('SHORT') && !buildup.includes('COVERING') ? -1 : 1);
    let score = Math.round(dir * (35 + Math.min(40, Math.abs(row.oiChangePct) * 4 + Math.abs(row.priceChangePct) * 8)));
    if (rvol >= 1.5) score += dir * 8;
    if (row.vwapRelation === 'above') score += 6;
    if (row.vwapRelation === 'below') score -= 6;
    score = Math.max(-100, Math.min(100, score));
    const confidence = Math.max(45, Math.min(95, 55 + Math.round(rvol * 10) + (row.pcr ? 8 : 0)));
    const components = {
      priceOi: {
        id: 'priceOi', score: Math.round(score * 0.35), max: 30, available: true, setup, buildup,
        detail: { priceChangePct: row.priceChangePct, oiChangePct: row.oiChangePct },
        reasons: [`Price: ${row.priceChangePct >= 0 ? '+' : ''}${row.priceChangePct}%`, `OI: ${row.oiChangePct >= 0 ? '+' : ''}${row.oiChangePct}% — ${buildup}`],
      },
      volume: {
        id: 'volume', score: Math.round(dir * Math.min(15, rvol * 5)), max: 15, available: true,
        detail: { relativeVolume: rvol, bucket: rvol < 0.75 ? 'weak' : rvol < 1.25 ? 'normal' : rvol < 2 ? 'strong' : 'very_strong' },
        reasons: [`Relative Volume: ${rvol}×`],
      },
      vwap: {
        id: 'vwap', score: row.vwapRelation === 'above' ? 8 : row.vwapRelation === 'below' ? -8 : 0, max: 15, available: true,
        detail: { distancePct: row.vwapRelation === 'above' ? 0.4 : -0.4 },
        reasons: [`Price ${row.vwapRelation || 'at'} VWAP`],
      },
      options: {
        id: 'options', score: row.pcr > 1.1 ? 5 : -3, max: 15, available: true,
        detail: { pcr: row.pcr },
        reasons: [`PCR ${row.pcr}`],
      },
      sector: {
        id: 'sector', score: Math.round(dir * 5), max: 10, available: true,
        detail: { aligned: true, sectorChangePct: row.priceChangePct * 0.6 },
        reasons: [`Sector: ${row.sector} supportive`],
      },
      fii: {
        id: 'fii', score: 0, max: 10, available: false,
        detail: {},
        reasons: ['FII data is index-level — not applied as stock positioning'],
      },
      momentum: {
        id: 'momentum', score: Math.round(dir * 2), max: 5, available: false,
        detail: { mode: 'session_proxy' },
        reasons: ['Multi-timeframe history limited — session persistence proxy only'],
      },
    };
    const why = Object.values(components).flatMap((c) => c.reasons);
    return {
      symbol: row.symbol,
      score,
      confidence,
      signal: signalFor(score),
      setup,
      buildup,
      label: signalFor(score).replace('LONG', 'BULLISH').replace('SHORT', 'BEARISH'),
      quality: confidence >= 75 ? 'HIGH' : confidence >= 55 ? 'MEDIUM' : 'LOW',
      conflicting: false,
      conflicts: [],
      components,
      componentScores: Object.fromEntries(Object.entries(components).map(([k, v]) => [k, v.score])),
      bullishFactors: why.filter((_, i) => score > 0).slice(0, 4).map((t) => ({ text: t })),
      bearishFactors: why.filter((_, i) => score < 0).slice(0, 4).map((t) => ({ text: t })),
      conflictingFactors: [],
      timeframes: {
        labels: { '5M': score > 0 ? 'Bullish' : 'Bearish', '15M': score > 0 ? 'Bullish' : 'Bearish', '30M': 'Neutral', '60M': score > 0 ? 'Bullish' : 'Bearish', DAILY: score > 0 ? 'Bullish' : 'Bearish' },
        overall: score > 20 ? 'MULTI-TIMEFRAME BULLISH' : score < -20 ? 'MULTI-TIMEFRAME BEARISH' : 'MIXED',
      },
      why,
      explanation: `Smart Money Proxy ${score >= 0 ? '+' : ''}${score} / 100\nConfidence ${confidence}%\nSignal ${signalFor(score)}\nPrimary Setup ${setup}\nWHY?\n${why.join('\n')}\nSignal Quality: ${confidence >= 75 ? 'HIGH' : 'MEDIUM'}`,
      interpretation: `${setup} positioning proxy. Components are broadly consistent for a positioning proxy (not proof of institutional intent).`,
      disclaimer: 'Smart Money Proxy — A quantitative positioning signal based on price, OI, volume, VWAP, options positioning, sector strength and institutional positioning. It does not identify actual institutional trades.',
      signals: [buildup, signalFor(score)],
    };
  }

  function enrichRow(base) {
    const rvol = Number((0.9 + hash01(`${base.symbol}:rvol`) * 1.8).toFixed(2));
    const vwap = Number((base.ltp * (1 - base.priceChangePct / 200)).toFixed(2));
    const row = {
      ...base,
      relativeVolume: rvol,
      vwap,
      vwapRelation: base.ltp >= vwap ? 'above' : 'below',
      volume: Math.round(2e5 + hash01(`${base.symbol}:vol`) * 1e6),
      iv: Number((12 + hash01(`${base.symbol}:iv`) * 8).toFixed(1)),
      ivChangePct: Number(((hash01(`${base.symbol}:ivc`) - 0.5) * 6).toFixed(2)),
      pcr: Number((0.7 + hash01(`${base.symbol}:pcr`) * 0.8).toFixed(2)),
      buildup: classify(base.priceChangePct, base.oiChangePct),
      score: Math.round(base.priceChangePct * 10 + base.oiChangePct * 3),
      why: [`Price ${base.priceChangePct}% with OI ${base.oiChangePct}%`],
    };
    row.smartMoney = makeSmart(row);
    return row;
  }

  const ROWS = SAMPLE.map(enrichRow);
  const watchlist = new Set(['NIFTY', 'BANKNIFTY', 'HDFCBANK', 'RELIANCE', 'TCS']);
  const history = new Map();

  function recordHistory(symbol, sm, row) {
    const key = String(symbol).toUpperCase();
    const arr = history.get(key) || [];
    arr.push({
      at: new Date().toISOString(),
      score: sm.score,
      confidence: sm.confidence,
      priceChangePct: row.priceChangePct,
      oiChangePct: row.oiChangePct,
      relativeVolume: row.relativeVolume,
      ltp: row.ltp,
      setup: sm.setup,
      signal: sm.signal,
    });
    history.set(key, arr.slice(-40));
  }

  ROWS.forEach((r) => recordHistory(r.symbol, r.smartMoney, r));

  function ticker() {
    const specs = [
      ['NIFTY', 24500], ['BANKNIFTY', 51200], ['FINNIFTY', 23400], ['MIDCPNIFTY', 11850], ['INDIAVIX', 13.45],
    ];
    return env(specs.map(([symbol, spot]) => {
      const changePct = Number(((hash01(`${symbol}:c`) - 0.45) * 2).toFixed(2));
      const change = Number((spot * changePct / 100).toFixed(2));
      return {
        symbol, segment: 'INDEX', ltp: spot, change, changePct,
        open: spot - change, high: spot * 1.004, low: spot * 0.997, prevClose: spot - change,
        volume: 1e6, vwap: spot - change / 2, oi: null, futuresPrice: spot + 12,
      };
    }));
  }

  function overview() {
    return env({
      ticker: ticker().data,
      regime: {
        label: 'BULLISH',
        score: 74,
        confidence: 0.86,
        factors: [
          { name: 'Price/VWAP', evidence: 'NIFTY above VWAP' },
          { name: 'OI', evidence: 'Net long buildup bias in scanners' },
          { name: 'Volume', evidence: 'Participation elevated vs average' },
          { name: 'PCR', evidence: 'OI PCR 1.18 — put-leaning' },
          { name: 'FII', evidence: 'Cash net supportive (demo)' },
          { name: 'Breadth', evidence: 'Demo breadth constructive' },
        ],
      },
      optionSnapshot: {
        pcr: 1.18,
        maxPain: 24400,
        atm: { strike: 24500, iv: 12.8 },
        expectedMove: { move: 220, lower1sd: 24280, upper1sd: 24720 },
        interpretation: {
          summary: 'Put support below spot; call resistance overhead.',
          evidence: ['Highest put OI near 24300', 'Highest call OI near 24600', 'ATM IV ~12.8%'],
          putSupport: 24300,
          callResistance: 24600,
        },
      },
    });
  }

  function scanner(qs) {
    let rows = [...ROWS];
    if (qs.signal) rows = rows.filter((r) => r.buildup === qs.signal);
    if (qs.sector) rows = rows.filter((r) => r.sector === qs.sector);
    rows.sort((a, b) => Math.abs(b.smartMoney.score) - Math.abs(a.smartMoney.score));
    return env(rows);
  }

  function smartMoney() {
    const mapped = ROWS.map((r) => ({
      symbol: r.symbol,
      sector: r.sector,
      ltp: r.ltp,
      score: r.smartMoney.score,
      confidence: r.smartMoney.confidence,
      signal: r.smartMoney.signal,
      setup: r.smartMoney.setup,
      priceChangePct: r.priceChangePct,
      oiChangePct: r.oiChangePct,
      relativeVolume: r.relativeVolume,
      vwap: r.vwap,
      vwapRelation: r.vwapRelation,
      pcr: r.pcr,
      smartMoney: r.smartMoney,
    }));
    const topLongs = [...mapped].filter((r) => r.score >= 20).sort((a, b) => b.score - a.score);
    const topShorts = [...mapped].filter((r) => r.score <= -20).sort((a, b) => a.score - b.score);
    return env({
      disclaimer: mapped[0]?.smartMoney?.disclaimer,
      market: { bias: 'BULLISH', avgScore: 18, score: 18, confidence: 72, bullish: topLongs.length, bearish: topShorts.length, neutral: 0 },
      rankings: {
        topLongs,
        topShorts,
        topShortCovering: mapped.filter((r) => r.setup === 'SHORT COVERING'),
        topLongUnwinding: mapped.filter((r) => r.setup === 'LONG UNWINDING'),
        topEmerging: topLongs.slice(0, 5),
      },
      indices: [
        { symbol: 'NIFTY', score: 72, confidence: 88, setup: 'LONG BUILDUP', signal: 'STRONG LONG' },
        { symbol: 'BANKNIFTY', score: 81, confidence: 92, setup: 'LONG BUILDUP', signal: 'VERY STRONG LONG' },
        { symbol: 'FINNIFTY', score: 48, confidence: 74, setup: 'LONG BUILDUP', signal: 'LONG' },
        { symbol: 'MIDCPNIFTY', score: 35, confidence: 68, setup: 'SHORT COVERING', signal: 'MILD LONG' },
      ],
      rows: mapped,
    });
  }

  function smartDetail(symbol) {
    const sym = String(symbol || '').toUpperCase();
    const row = ROWS.find((r) => r.symbol === sym);
    const indexLike = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY'].includes(sym);
    if (!row && !indexLike) return env(null, { error: `No data for ${sym}` });
    const sm = row ? row.smartMoney : makeSmart({
      symbol: sym, priceChangePct: 0.8, oiChangePct: 2.2, relativeVolume: 1.3, ltp: 24500, vwapRelation: 'above', pcr: 1.1, sector: 'INDEX',
    });
    return env({
      symbol: sym,
      disclaimer: sm.disclaimer,
      quote: row || { ltp: 24500, priceChangePct: 0.8, oiChangePct: null, relativeVolume: 1.3, vwapRelation: 'above', sector: 'INDEX' },
      score: sm.score,
      confidence: sm.confidence,
      signal: sm.signal,
      setup: sm.setup,
      label: sm.label,
      quality: sm.quality,
      conflicting: false,
      conflicts: [],
      components: sm.components,
      componentScores: sm.componentScores,
      bullishFactors: sm.bullishFactors,
      bearishFactors: sm.bearishFactors,
      conflictingFactors: [],
      timeframes: sm.timeframes,
      why: sm.why,
      explanation: sm.explanation,
      interpretation: sm.interpretation,
      history: { range: '1M', trend: 'INCREASING', points: history.get(sym) || [{ at: META.asOf, score: sm.score, confidence: sm.confidence, priceChangePct: row?.priceChangePct ?? 0.8, oiChangePct: row?.oiChangePct ?? 2, relativeVolume: row?.relativeVolume ?? 1.3 }] },
    });
  }

  function optionChain(underlying) {
    const spot = underlying === 'BANKNIFTY' ? 51200 : 24500;
    const step = underlying === 'BANKNIFTY' ? 100 : 50;
    const atm = Math.round(spot / step) * step;
    const strikes = [];
    for (let i = -6; i <= 6; i++) {
      const strike = atm + i * step;
      const callOi = Math.round(1e6 + hash01(`c${strike}`) * 3e6);
      const putOi = Math.round(1e6 + hash01(`p${strike}`) * 3e6);
      strikes.push({
        strike,
        call: { oi: callOi, oiChange: Math.round(callOi * 0.04), volume: 1e5, iv: 12 + Math.abs(i), ltp: Math.max(5, 120 - i * 15), change: 2 },
        put: { oi: putOi, oiChange: Math.round(putOi * 0.03), volume: 1.1e5, iv: 12.5 + Math.abs(i), ltp: Math.max(5, 110 + i * 15), change: -1 },
      });
    }
    return env({
      spot,
      expiry: '2026-09-17',
      atm: { strike: atm, iv: 12.8, straddle: 220 },
      metrics: {
        oiPcr: 1.18, volumePcr: 1.05, maxPain: atm - step, atmIv: 12.8,
        callOiResistance: { strike: atm + step * 2 },
        putOiSupport: { strike: atm - step * 2 },
        dteDays: 6,
      },
      expectedMove: { move: 220, lower1sd: spot - 220, upper1sd: spot + 220, lower2sd: spot - 440, upper2sd: spot + 440 },
      interpretation: { summary: 'Demo chain — labeled mock', evidence: ['ATM centered', 'Put wall below', 'Call wall above'] },
      highlights: { highestCallOi: { strike: atm + step * 2 }, highestPutOi: { strike: atm - step * 2 } },
      strikes,
    });
  }

  function sectors() {
    const list = Object.keys(SECTORS).map((sector, i) => {
      const ret = Number(((hash01(`sec:${sector}`) - 0.4) * 3).toFixed(2));
      return {
        rank: 0,
        sector,
        returnPct: ret,
        avgOiChangePct: Number(((hash01(`secoi:${sector}`) - 0.3) * 6).toFixed(2)),
        advanceDecline: Number((1 + hash01(`ad:${sector}`)).toFixed(2)),
        longBuildupCount: Math.round(1 + hash01(`lb:${sector}`) * 4),
        shortBuildupCount: Math.round(hash01(`sb:${sector}`) * 3),
        score: Math.round(40 + ret * 15 + hash01(`sc:${sector}`) * 20),
      };
    }).sort((a, b) => b.score - a.score).map((s, i) => ({ ...s, rank: i + 1 }));
    return env(list);
  }

  function parsePath(path) {
    const raw = String(path || '');
    const qIdx = raw.indexOf('?');
    const pathname = (qIdx >= 0 ? raw.slice(0, qIdx) : raw).replace(/^\/api\/fno\/?/, '');
    const parts = pathname.split('/').filter(Boolean);
    const qs = {};
    if (qIdx >= 0) {
      String(raw.slice(qIdx + 1)).split('&').forEach((pair) => {
        if (!pair) return;
        const [k, v] = pair.split('=');
        qs[decodeURIComponent(k)] = decodeURIComponent(v || '');
      });
    }
    return { parts, qs };
  }

  async function handle(path, options = {}) {
    const method = (options.method || 'GET').toUpperCase();
    const { parts, qs } = parsePath(path);

    if (parts[0] === 'ticker') return ticker();
    if (parts[0] === 'overview') return overview();
    if (parts[0] === 'scanner') return scanner(qs);
    if (parts[0] === 'buildups') {
      const buckets = { LONG_BUILDUP: [], SHORT_BUILDUP: [], SHORT_COVERING: [], LONG_UNWINDING: [] };
      for (const r of ROWS) if (buckets[r.buildup]) buckets[r.buildup].push(r);
      return env(buckets);
    }
    if (parts[0] === 'smart-money' && parts[1] && parts[2] === 'history') {
      const points = history.get(String(parts[1]).toUpperCase()) || [];
      return env({ range: qs.range || '5D', trend: 'STABLE', points });
    }
    if (parts[0] === 'smart-money' && parts[1]) return smartDetail(parts[1]);
    if (parts[0] === 'smart-money') return smartMoney();
    if (parts[0] === 'sectors' && parts[1]) return env(ROWS.filter((r) => r.sector === decodeURIComponent(parts[1])));
    if (parts[0] === 'sectors') return sectors();
    if (parts[0] === 'expiries') return env(['2026-09-17', '2026-09-24', '2026-10-01']);
    if (parts[0] === 'option-chain') return optionChain(String(parts[1] || 'NIFTY').toUpperCase());
    if (parts[0] === 'fii-dii') {
      return env({
        cash: { fiiNet: 1245.67, diiNet: -832.14, unit: 'INR crore', asOf: META.asOf.slice(0, 10), label: 'MOCK' },
        futures: { indexFuturesLong: null, indexFuturesShort: null, netFutures: null, note: 'Futures long/short unavailable in demo' },
        positioningRegime: { label: 'BULLISH', basis: 'FII cash net 1245.67', note: 'Demo cash-only regime' },
      });
    }
    if (parts[0] === 'watchlist' && method === 'POST') {
      try {
        const body = JSON.parse(options.body || '{}');
        if (body.symbol) watchlist.add(String(body.symbol).toUpperCase());
      } catch { /* ignore */ }
      return { symbols: [...watchlist] };
    }
    if (parts[0] === 'watchlist' && method === 'DELETE') {
      watchlist.delete(String(parts[1] || '').toUpperCase());
      return { symbols: [...watchlist] };
    }
    if (parts[0] === 'watchlist') {
      const bySym = new Map(ROWS.map((r) => [r.symbol, r]));
      const rows = [...watchlist].map((symbol) => {
        const row = bySym.get(symbol);
        if (row) {
          return { ...row, smartMoneyScore: row.smartMoney.score, smartMoneyConfidence: row.smartMoney.confidence };
        }
        return { symbol, ltp: null, buildup: 'NEUTRAL', score: null, smartMoneyScore: null, smartMoneyConfidence: null };
      });
      return env(rows);
    }
    if (parts[0] === 'alerts' && parts[1] === 'rules') {
      return { rules: { unusualVolumeMult: 2, smartMoneyScoreAbove: 80, smartMoneyCrossAbove: 60, smartMoneyConfidenceAbove: 80 } };
    }
    if (parts[0] === 'alerts') {
      const alerts = ROWS.filter((r) => Math.abs(r.smartMoney.score) >= 70).slice(0, 8).map((r) => ({
        symbol: r.symbol,
        sector: r.sector,
        reasons: [`Smart Money ${r.smartMoney.score >= 0 ? '+' : ''}${r.smartMoney.score}`, r.smartMoney.setup],
        score: r.score,
        smartMoneyScore: r.smartMoney.score,
        smartMoneyConfidence: r.smartMoney.confidence,
        buildup: r.buildup,
        at: META.asOf,
      }));
      return env({ rules: {}, alerts });
    }
    return env(null, { error: `Static demo: unhandled ${path}` });
  }

  global.FnoStaticDemoApi = { handle, META };
})(typeof window !== 'undefined' ? window : globalThis);
