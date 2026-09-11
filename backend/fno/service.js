'use strict';

const { createProvider } = require('./providers');
const { analyzeOptionChain } = require('./calculations/optionChainMetrics');
const { computeMarketRegime } = require('./calculations/marketRegime');
const { explainBuildup, classifyBuildup } = require('./calculations/oiBuildup');
const { computeSmartMoneyProxy, buildRankings, summarizeMarketBias, evaluateSmartMoneyAlert, DISCLAIMER } = require('./calculations/smartMoney');
const { computeSectorStrength, rankSectors } = require('./calculations/sectorStrength');
const { SECTOR_MAP, sectorForSymbol } = require('./universe/sectors');
const { TICKER_ORDER } = require('./universe/underlyings');
const { dataEnvelope } = require('./normalize');

const CACHE_TTL_MS = {
  overview: 60_000,
  chain: 15_000,
  scanner: 120_000,
  fii: 300_000,
};

class FnoService {
  constructor({ config = null, provider = null } = {}) {
    this.config = config;
    this.provider = provider || createProvider({ config });
    this.cache = new Map();
    this.watchlist = new Set(['NIFTY', 'BANKNIFTY', 'HDFCBANK', 'RELIANCE', 'TCS']);
    this.alertRules = defaultAlertRules();
    this.alertHistory = [];
    /** @type {Map<string, {score:number,confidence:number,setup:string,signal:string,at:string}>} */
    this._smartMoneyPrev = new Map();
    /** @type {Map<string, Array<{at:string,score:number,confidence:number,priceChangePct:number|null,oiChangePct:number|null,relativeVolume:number|null,ltp:number|null}>>} */
    this._smartMoneyHistory = new Map();
    this._credentialSource = (config?.clientId && config?.pin && config?.totpSecret) ? 'env' : 'none';
  }

  _getCache(key) {
    const hit = this.cache.get(key);
    if (!hit) return null;
    if (Date.now() - hit.at > hit.ttl) return { ...hit.value, meta: { ...hit.value.meta, stale: true } };
    return hit.value;
  }

  _setCache(key, value, ttl) {
    this.cache.set(key, { at: Date.now(), ttl, value });
    return value;
  }

  async getTicker() {
    const cached = this._getCache('ticker');
    if (cached && !cached.meta?.stale) return cached;
    const env = await this.provider.getIndexQuotes(TICKER_ORDER);
    const bySym = new Map((env.data || []).map((q) => [q.symbol, q]));
    const ordered = TICKER_ORDER.map((id) => bySym.get(id) || { symbol: id, ltp: null, source: env.meta.source });
    return this._setCache('ticker', dataEnvelope(ordered, env.meta), CACHE_TTL_MS.overview);
  }

  async getMarketOverviewIntelligence() {
    const ticker = await this.getTicker();
    const nifty = (ticker.data || []).find((q) => q.symbol === 'NIFTY');
    const vix = (ticker.data || []).find((q) => q.symbol === 'INDIAVIX');

    let chainMetrics = null;
    try {
      const expiries = await this.provider.getOptionExpiries('NIFTY');
      const expiry = expiries.data?.[0];
      if (expiry) {
        const chainEnv = await this.provider.getOptionChain('NIFTY', expiry);
        chainMetrics = analyzeOptionChain({
          spot: chainEnv.data.spot,
          strikes: chainEnv.data.strikes,
          expiry,
          asOf: chainEnv.meta.asOf,
        });
      }
    } catch {
      chainMetrics = null;
    }

    const priceVsVwap =
      nifty?.ltp != null && nifty?.vwap != null
        ? nifty.ltp >= nifty.vwap ? 'above' : 'below'
        : nifty?.changePct != null
          ? nifty.changePct >= 0 ? 'above' : 'below'
          : null;

    const regime = computeMarketRegime({
      priceVsVwap,
      priceVsEma20: nifty?.changePct != null ? (nifty.changePct >= 0 ? 'above' : 'below') : null,
      priceVsEma50: null,
      breadthPctAbove50: null,
      advanceDeclineRatio: null,
      fiiNetFutures: null,
      pcr: chainMetrics?.metrics?.oiPcr ?? null,
      oiBuildupBias: null,
      indiaVix: vix?.ltp ?? null,
      momentumScore: nifty?.changePct != null ? nifty.changePct * 20 : null,
    });

    return dataEnvelope({
      ticker: ticker.data,
      regime,
      optionSnapshot: chainMetrics
        ? {
          pcr: chainMetrics.metrics.oiPcr,
          maxPain: chainMetrics.metrics.maxPain,
          atm: chainMetrics.atm,
          expectedMove: chainMetrics.expectedMove,
          interpretation: chainMetrics.interpretation,
        }
        : null,
    }, {
      ...ticker.meta,
      asOf: new Date().toISOString(),
    });
  }

  async getOptionChain(underlying = 'NIFTY', expiry = null) {
    const key = `chain:${underlying}:${expiry || 'near'}`;
    const cached = this._getCache(key);
    if (cached && !cached.meta?.stale) return cached;

    let exp = expiry;
    if (!exp) {
      const ex = await this.provider.getOptionExpiries(underlying);
      exp = ex.data?.[0];
      if (!exp) throw new Error('No expiries available');
    }
    const env = await this.provider.getOptionChain(underlying, exp);
    const analyzed = analyzeOptionChain({
      spot: env.data.spot,
      strikes: env.data.strikes,
      expiry: exp,
      asOf: env.meta.asOf,
    });
    return this._setCache(key, dataEnvelope(analyzed, env.meta), CACHE_TTL_MS.chain);
  }

  async getExpiries(underlying = 'NIFTY') {
    return this.provider.getOptionExpiries(underlying);
  }

  async getFoScanner({ signal = null, sector = null, minAbsScore = 0 } = {}) {
    const cached = this._getCache('scanner');
    let env = cached && !cached.meta?.stale ? cached : null;
    if (!env) {
      env = await this.provider.getFuturesQuotes();
      this._setCache('scanner', env, CACHE_TTL_MS.scanner);
    }

    const regimeEnv = await this.getMarketOverviewIntelligence();
    const regimeScore = regimeEnv.data?.regime?.score ?? 50;

    // Sector map for confirmation (reuse analysis; tolerate cold cache)
    let sectorByName = new Map();
    try {
      const sectorsEnv = await this._sectorStatsFromRows(env.data || []);
      sectorByName = new Map((sectorsEnv || []).map((s) => [s.sector, s]));
    } catch {
      sectorByName = new Map();
    }

    let fiiCtx = null;
    try {
      const fii = await this.getFiiDii();
      fiiCtx = {
        fiiNetCash: fii.data?.cash?.fiiNet ?? null,
        fiiNetFutures: fii.data?.futures?.netFutures ?? null,
        fiiLongShortRatio: fii.data?.futures?.longShortRatio ?? null,
      };
    } catch {
      fiiCtx = null;
    }

    let rows = (env.data || []).map((row) => {
      const explained = explainBuildup({
        priceChangePct: row.priceChangePct,
        oiChangePct: row.oiChangePct,
        relativeVolume: row.relativeVolume,
        vwapRelation: row.vwapRelation,
        ivChangePct: row.ivChangePct,
        pcr: row.pcr,
        sectorReturnPct: null,
        marketRegimeScore: regimeScore,
      });
      const sectorName = row.sector || sectorForSymbol(row.symbol);
      const sectorStats = sectorByName.get(sectorName);
      const isIndex = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY'].includes(String(row.symbol).toUpperCase());
      const smart = computeSmartMoneyProxy(row, {
        marketRegimeScore: regimeScore,
        buildup: explained.classification,
        sector: sectorName,
        sectorChangePct: sectorStats?.returnPct ?? null,
        sectorScore: sectorStats?.score ?? null,
        isIndex,
        fiiNetCash: fiiCtx?.fiiNetCash ?? null,
        fiiNetFutures: fiiCtx?.fiiNetFutures ?? null,
        fiiLongShortRatio: fiiCtx?.fiiLongShortRatio ?? null,
        ivChange: row.ivChangePct,
      });
      this._recordSmartMoneyHistory(row.symbol, smart, row);
      const distHigh = row.high52w && row.ltp ? ((row.high52w - row.ltp) / row.high52w) * 100 : null;
      const distLow = row.low52w && row.ltp ? ((row.ltp - row.low52w) / row.low52w) * 100 : null;
      return {
        ...row,
        sector: sectorName,
        buildup: explained.classification,
        score: explained.score,
        why: explained.why,
        smartMoney: smart,
        dist52wHighPct: distHigh,
        dist52wLowPct: distLow,
      };
    });

    if (signal) rows = rows.filter((r) => r.buildup === signal);
    if (sector) rows = rows.filter((r) => r.sector === sector);
    if (minAbsScore) rows = rows.filter((r) => Math.abs(r.score) >= minAbsScore);

    rows.sort((a, b) => Math.abs(b.score) - Math.abs(a.score));
    return dataEnvelope(rows, env.meta);
  }

  _sectorStatsFromRows(rows) {
    const bySector = new Map();
    for (const row of rows) {
      const sector = row.sector || sectorForSymbol(row.symbol) || 'OTHER';
      if (!bySector.has(sector)) {
        bySector.set(sector, {
          sector,
          returns: [],
          oiChanges: [],
          advances: 0,
          declines: 0,
          longBuildupCount: 0,
          shortBuildupCount: 0,
          shortCoveringCount: 0,
          longUnwindingCount: 0,
          rvols: [],
        });
      }
      const s = bySector.get(sector);
      if (row.priceChangePct != null) {
        s.returns.push(row.priceChangePct);
        if (row.priceChangePct >= 0) s.advances += 1;
        else s.declines += 1;
      }
      if (row.oiChangePct != null) s.oiChanges.push(row.oiChangePct);
      const b = classifyBuildup({ priceChangePct: row.priceChangePct, oiChangePct: row.oiChangePct });
      if (b === 'LONG_BUILDUP') s.longBuildupCount += 1;
      if (b === 'SHORT_BUILDUP') s.shortBuildupCount += 1;
      if (b === 'SHORT_COVERING') s.shortCoveringCount += 1;
      if (b === 'LONG_UNWINDING') s.longUnwindingCount += 1;
      if (row.relativeVolume != null) s.rvols.push(row.relativeVolume);
    }
    const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
    return [...bySector.values()].map((s) => {
      const stats = {
        sector: s.sector,
        returnPct: avg(s.returns),
        avgOiChangePct: avg(s.oiChanges),
        advanceDecline: s.declines === 0 ? (s.advances > 0 ? s.advances : null) : s.advances / s.declines,
        longBuildupCount: s.longBuildupCount,
        shortBuildupCount: s.shortBuildupCount,
        shortCoveringCount: s.shortCoveringCount,
        longUnwindingCount: s.longUnwindingCount,
        relativeVolume: avg(s.rvols),
      };
      return { ...stats, score: computeSectorStrength(stats) };
    });
  }

  _recordSmartMoneyHistory(symbol, smart, row) {
    if (!symbol || !smart) return;
    const key = String(symbol).toUpperCase();
    const point = {
      at: new Date().toISOString(),
      score: smart.score,
      confidence: smart.confidence,
      priceChangePct: row?.priceChangePct ?? null,
      oiChangePct: row?.oiChangePct ?? null,
      relativeVolume: row?.relativeVolume ?? null,
      ltp: row?.ltp ?? null,
      setup: smart.setup,
      signal: smart.signal,
    };
    const arr = this._smartMoneyHistory.get(key) || [];
    const last = arr[arr.length - 1];
    // Dedupe identical consecutive snapshots within ~30s
    if (last && Math.abs(new Date(point.at) - new Date(last.at)) < 30_000 && last.score === point.score) {
      return;
    }
    arr.push(point);
    this._smartMoneyHistory.set(key, arr.slice(-500));
  }

  _toSmartMoneyRow(r) {
    const sm = r.smartMoney || {};
    return {
      symbol: r.symbol,
      sector: r.sector,
      ltp: r.ltp,
      score: sm.score ?? r.proxyScore ?? r.score,
      confidence: sm.confidence ?? null,
      signal: sm.signal ?? null,
      setup: sm.setup ?? null,
      label: sm.label ?? null,
      quality: sm.quality ?? null,
      conflicting: Boolean(sm.conflicting),
      priceChangePct: r.priceChangePct,
      oiChangePct: r.oiChangePct,
      relativeVolume: r.relativeVolume,
      vwap: r.vwap,
      vwapRelation: r.vwapRelation,
      pcr: r.pcr,
      iv: r.iv,
      why: sm.why || r.why || [],
      smartMoney: sm,
    };
  }

  async getBuildupBuckets() {
    const scan = await this.getFoScanner();
    const buckets = {
      LONG_BUILDUP: [],
      SHORT_BUILDUP: [],
      SHORT_COVERING: [],
      LONG_UNWINDING: [],
    };
    for (const row of scan.data || []) {
      if (buckets[row.buildup]) buckets[row.buildup].push(row);
    }
    return dataEnvelope(buckets, scan.meta);
  }

  async getSmartMoney(limit = 25) {
    const scan = await this.getFoScanner();
    const mapped = (scan.data || []).map((r) => this._toSmartMoneyRow(r));
    const market = summarizeMarketBias(mapped);
    const rankings = buildRankings(mapped);

    const indexSymbols = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY'];
    const bySym = new Map(mapped.map((r) => [r.symbol, r]));
    const ticker = await this.getTicker();
    const fii = await this.getFiiDii().catch(() => null);

    const indices = [];
    for (const sym of indexSymbols) {
      let row = bySym.get(sym);
      if (!row) {
        const q = (ticker.data || []).find((t) => t.symbol === sym);
        if (q) {
          const smart = computeSmartMoneyProxy({
            symbol: sym,
            ltp: q.ltp,
            vwap: q.vwap,
            priceChangePct: q.changePct,
            oiChangePct: null,
            relativeVolume: null,
            isIndex: true,
            fiiNetCash: fii?.data?.cash?.fiiNet ?? null,
            fiiNetFutures: fii?.data?.futures?.netFutures ?? null,
          });
          row = {
            symbol: sym,
            score: smart.score,
            confidence: smart.confidence,
            signal: smart.signal,
            setup: smart.setup,
            label: smart.label,
            priceChangePct: q.changePct,
            oiChangePct: null,
            relativeVolume: null,
            vwap: q.vwap,
            smartMoney: smart,
          };
        }
      } else {
        // Recompute with isIndex + FII for index cards if scanner row lacked FII application
        const smart = computeSmartMoneyProxy(row.smartMoney ? scan.data.find((x) => x.symbol === sym) || row : row, {
          isIndex: true,
          fiiNetCash: fii?.data?.cash?.fiiNet ?? null,
          fiiNetFutures: fii?.data?.futures?.netFutures ?? null,
          buildup: row.setup?.replace(/\s+/g, '_') || row.smartMoney?.buildup,
        });
        row = { ...row, score: smart.score, confidence: smart.confidence, signal: smart.signal, setup: smart.setup, smartMoney: smart };
      }
      if (row) {
        indices.push({
          symbol: sym,
          score: row.score,
          confidence: row.confidence,
          signal: row.signal,
          setup: row.setup,
          priceChangePct: row.priceChangePct,
          oiChangePct: row.oiChangePct,
          pcr: row.pcr ?? row.smartMoney?.components?.options?.detail?.pcr ?? null,
          vwap: row.vwap,
          fiiApplied: Boolean(row.smartMoney?.components?.fii?.available && row.smartMoney?.components?.fii?.score !== 0),
          smartMoney: row.smartMoney,
        });
      }
    }

    const ranked = [...mapped]
      .sort((a, b) => {
        if (Math.abs(b.score) !== Math.abs(a.score)) return Math.abs(b.score) - Math.abs(a.score);
        return (b.confidence || 0) - (a.confidence || 0);
      })
      .slice(0, limit);

    return dataEnvelope({
      disclaimer: DISCLAIMER,
      market: {
        bias: market.bias,
        avgScore: market.avgScore,
        bullish: market.bullish,
        bearish: market.bearish,
        neutral: market.neutral,
        score: Math.round(market.avgScore),
        confidence: mapped.length
          ? Math.round(mapped.reduce((a, r) => a + (r.confidence || 0), 0) / mapped.length)
          : 0,
      },
      rankings: {
        topLongs: rankings.topLongs.slice(0, limit),
        topShorts: rankings.topShorts.slice(0, limit),
        topShortCovering: rankings.topShortCovering,
        topLongUnwinding: rankings.topLongUnwinding,
        topEmerging: rankings.topEmerging,
      },
      indices,
      rows: ranked,
    }, scan.meta);
  }

  async getSmartMoneyDetail(symbol) {
    const sym = String(symbol || '').toUpperCase();
    if (!sym) throw new Error('symbol required');
    const scan = await this.getFoScanner();
    const row = (scan.data || []).find((r) => r.symbol === sym);
    let smart;
    let base = row;
    if (!row) {
      const ticker = await this.getTicker();
      const q = (ticker.data || []).find((t) => t.symbol === sym);
      if (!q) {
        return dataEnvelope(null, {
          asOf: new Date().toISOString(),
          source: scan.meta.source,
          isMock: scan.meta.isMock,
          error: `No data for ${sym}`,
        });
      }
      const fii = await this.getFiiDii().catch(() => null);
      const isIndex = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY'].includes(sym);
      smart = computeSmartMoneyProxy({
        symbol: sym,
        ltp: q.ltp,
        vwap: q.vwap,
        priceChangePct: q.changePct,
        isIndex,
        fiiNetCash: fii?.data?.cash?.fiiNet ?? null,
        fiiNetFutures: fii?.data?.futures?.netFutures ?? null,
      });
      base = { symbol: sym, ltp: q.ltp, vwap: q.vwap, priceChangePct: q.changePct };
    } else {
      smart = row.smartMoney || computeSmartMoneyProxy(row);
    }

    const history = this.getSmartMoneyHistory(sym, '1M');

    return dataEnvelope({
      symbol: sym,
      disclaimer: DISCLAIMER,
      quote: {
        ltp: base.ltp,
        priceChangePct: base.priceChangePct,
        oiChangePct: base.oiChangePct ?? null,
        relativeVolume: base.relativeVolume ?? null,
        vwap: base.vwap ?? null,
        vwapRelation: base.vwapRelation ?? null,
        sector: base.sector ?? null,
        pcr: base.pcr ?? null,
        iv: base.iv ?? null,
        buildup: base.buildup ?? smart.buildup,
      },
      score: smart.score,
      confidence: smart.confidence,
      signal: smart.signal,
      setup: smart.setup,
      label: smart.label,
      quality: smart.quality,
      conflicting: smart.conflicting,
      conflicts: smart.conflicts,
      components: smart.components,
      componentScores: smart.componentScores,
      bullishFactors: smart.bullishFactors,
      bearishFactors: smart.bearishFactors,
      conflictingFactors: smart.conflictingFactors,
      timeframes: smart.timeframes,
      why: smart.why,
      explanation: smart.explanation,
      interpretation: smart.interpretation,
      history,
    }, scan.meta);
  }

  getSmartMoneyHistory(symbol, range = '5D') {
    const key = String(symbol || '').toUpperCase();
    const all = this._smartMoneyHistory.get(key) || [];
    const now = Date.now();
    const windows = {
      '1D': 1 * 24 * 3600_000,
      '5D': 5 * 24 * 3600_000,
      '10D': 10 * 24 * 3600_000,
      '1M': 30 * 24 * 3600_000,
    };
    const ms = windows[range] || windows['5D'];
    const sliced = all.filter((p) => now - new Date(p.at).getTime() <= ms);
    let trend = 'STABLE';
    if (sliced.length >= 2) {
      const delta = sliced[sliced.length - 1].score - sliced[0].score;
      if (delta >= 15) trend = 'INCREASING';
      else if (delta <= -15) trend = 'DECREASING';
      else if (Math.abs(delta) >= 8 && Math.sign(sliced[0].score) !== Math.sign(sliced[sliced.length - 1].score)) {
        trend = 'REVERSING';
      }
    }
    return { range, trend, points: sliced };
  }

  async getSectorAnalysis() {
    const scan = await this.getFoScanner();
    const bySector = new Map();
    for (const row of scan.data || []) {
      const sector = row.sector || 'OTHER';
      if (!bySector.has(sector)) {
        bySector.set(sector, {
          sector,
          returns: [],
          oiChanges: [],
          advances: 0,
          declines: 0,
          longBuildupCount: 0,
          shortBuildupCount: 0,
          shortCoveringCount: 0,
          longUnwindingCount: 0,
          volumes: [],
          rvols: [],
          stocks: [],
        });
      }
      const s = bySector.get(sector);
      s.stocks.push(row);
      if (row.priceChangePct != null) {
        s.returns.push(row.priceChangePct);
        if (row.priceChangePct >= 0) s.advances += 1;
        else s.declines += 1;
      }
      if (row.oiChangePct != null) s.oiChanges.push(row.oiChangePct);
      if (row.buildup === 'LONG_BUILDUP') s.longBuildupCount += 1;
      if (row.buildup === 'SHORT_BUILDUP') s.shortBuildupCount += 1;
      if (row.buildup === 'SHORT_COVERING') s.shortCoveringCount += 1;
      if (row.buildup === 'LONG_UNWINDING') s.longUnwindingCount += 1;
      if (row.volume != null) s.volumes.push(row.volume);
      if (row.relativeVolume != null) s.rvols.push(row.relativeVolume);
    }

    const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
    const sectors = [...bySector.values()].map((s) => {
      const stats = {
        sector: s.sector,
        returnPct: avg(s.returns),
        avgOiChangePct: avg(s.oiChanges),
        advanceDecline: s.declines === 0 ? (s.advances > 0 ? s.advances : null) : s.advances / s.declines,
        longBuildupCount: s.longBuildupCount,
        shortBuildupCount: s.shortBuildupCount,
        shortCoveringCount: s.shortCoveringCount,
        longUnwindingCount: s.longUnwindingCount,
        relativeVolume: avg(s.rvols),
        stockCount: s.stocks.length,
      };
      return { ...stats, score: computeSectorStrength(stats) };
    });

    return dataEnvelope(rankSectors(sectors), {
      asOf: new Date().toISOString(),
      source: scan.meta.source,
      isMock: scan.meta.isMock,
      warning: scan.meta.warning,
    });
  }

  async getSectorStocks(sector) {
    const scan = await this.getFoScanner({ sector });
    return scan;
  }

  async getFiiDii() {
    const cached = this._getCache('fii');
    if (cached && !cached.meta?.stale) return cached;
    const env = await this.provider.getFiiDii();
    const cash = env.data?.cash;
    let positioning = 'NEUTRAL';
    if (cash?.fiiNet != null) {
      if (cash.fiiNet >= 2000) positioning = 'STRONG_BULLISH';
      else if (cash.fiiNet >= 500) positioning = 'BULLISH';
      else if (cash.fiiNet <= -2000) positioning = 'STRONG_BEARISH';
      else if (cash.fiiNet <= -500) positioning = 'BEARISH';
    }
    const enriched = {
      ...env.data,
      positioningRegime: {
        label: positioning,
        basis: cash?.fiiNet != null ? `FII cash net ${cash.fiiNet}` : 'Insufficient FII data',
        note: env.data?.futures?.netFutures == null
          ? 'Futures long/short unavailable — regime uses cash net only when present'
          : null,
      },
    };
    return this._setCache('fii', dataEnvelope(enriched, env.meta), CACHE_TTL_MS.fii);
  }

  getWatchlist() {
    return [...this.watchlist];
  }

  async getWatchlistQuotes() {
    const symbols = this.getWatchlist();
    const scan = await this.getFoScanner();
    const bySym = new Map((scan.data || []).map((r) => [r.symbol, r]));
    const ticker = await this.getTicker();
    for (const q of ticker.data || []) {
      const existing = bySym.get(q.symbol);
      if (existing) {
        bySym.set(q.symbol, {
          ...existing,
          ltp: q.ltp ?? existing.ltp,
          priceChangePct: q.changePct ?? existing.priceChangePct,
          volume: q.volume ?? existing.volume,
          vwap: q.vwap ?? existing.vwap,
        });
      } else {
        bySym.set(q.symbol, {
          symbol: q.symbol,
          ltp: q.ltp,
          priceChangePct: q.changePct,
          oiChangePct: null,
          volume: q.volume,
          relativeVolume: null,
          vwap: q.vwap,
          iv: null,
          buildup: 'NEUTRAL',
          score: 0,
          smartMoney: null,
        });
      }
    }
    const rows = symbols.map((symbol) => {
      const row = bySym.get(symbol) || { symbol, ltp: null, buildup: 'NEUTRAL', score: null };
      return {
        ...row,
        smartMoneyScore: row.smartMoney?.score ?? null,
        smartMoneyConfidence: row.smartMoney?.confidence ?? null,
        smartMoneySetup: row.smartMoney?.setup ?? null,
      };
    });
    return dataEnvelope(rows, { asOf: new Date().toISOString(), source: scan.meta.source, isMock: scan.meta.isMock });
  }

  addWatchlist(symbol) {
    if (!symbol) return this.getWatchlist();
    this.watchlist.add(String(symbol).toUpperCase());
    return this.getWatchlist();
  }

  removeWatchlist(symbol) {
    this.watchlist.delete(String(symbol).toUpperCase());
    return this.getWatchlist();
  }

  getAlertRules() {
    return this.alertRules;
  }

  updateAlertRules(partial = {}) {
    this.alertRules = { ...this.alertRules, ...partial };
    return this.alertRules;
  }

  async evaluateAlerts() {
    const scan = await this.getFoScanner();
    const rules = this.alertRules;
    const fired = [];
    for (const row of scan.data || []) {
      const reasons = [];
      if (row.relativeVolume != null && row.relativeVolume >= rules.unusualVolumeMult) {
        reasons.push(`Unusual volume ${row.relativeVolume.toFixed(2)}x`);
      }
      if (row.oiChangePct != null && Math.abs(row.oiChangePct) >= rules.unusualOiPct) {
        reasons.push(`Unusual OI ${row.oiChangePct.toFixed(2)}%`);
      }
      if (row.ivChangePct != null && row.ivChangePct >= rules.ivExpansionPct) {
        reasons.push(`IV expansion ${row.ivChangePct.toFixed(2)}%`);
      }
      if (row.ivChangePct != null && row.ivChangePct <= -rules.ivContractionPct) {
        reasons.push(`IV contraction ${row.ivChangePct.toFixed(2)}%`);
      }
      if (row.vwapRelation === 'above' && (row.priceChangePct || 0) >= rules.breakoutPct) {
        reasons.push('VWAP breakout');
      }
      if (row.vwapRelation === 'below' && (row.priceChangePct || 0) <= -rules.breakoutPct) {
        reasons.push('VWAP breakdown');
      }
      const priceOiDiv =
        row.priceChangePct != null &&
        row.oiChangePct != null &&
        Math.sign(row.priceChangePct) !== Math.sign(row.oiChangePct) &&
        Math.abs(row.priceChangePct) >= 1 &&
        Math.abs(row.oiChangePct) >= rules.unusualOiPct;
      if (priceOiDiv) reasons.push('Price/OI divergence');

      const sm = row.smartMoney;
      if (sm) {
        const prev = this._smartMoneyPrev.get(row.symbol) || null;
        const smRules = {
          scoreAbove: rules.smartMoneyScoreAbove,
          scoreBelow: rules.smartMoneyScoreBelow,
          crossAbove: rules.smartMoneyCrossAbove,
          crossBelow: rules.smartMoneyCrossBelow,
          confidenceAbove: rules.smartMoneyConfidenceAbove,
        };
        const triggers = evaluateSmartMoneyAlert(prev, sm, smRules);
        for (const t of triggers) reasons.push(t.message);
        this._smartMoneyPrev.set(row.symbol, {
          score: sm.score,
          confidence: sm.confidence,
          setup: sm.setup,
          signal: sm.signal,
          at: new Date().toISOString(),
        });
      }

      if (reasons.length) {
        fired.push({
          symbol: row.symbol,
          sector: row.sector,
          reasons,
          score: row.score,
          smartMoneyScore: sm?.score ?? null,
          smartMoneyConfidence: sm?.confidence ?? null,
          buildup: row.buildup,
          at: new Date().toISOString(),
          channels: { push: false, telegram: false, whatsapp: false, email: false },
        });
      }
    }
    this.alertHistory = [...fired, ...this.alertHistory].slice(0, 200);
    return dataEnvelope({ rules, alerts: fired }, scan.meta);
  }

  getAlertHistory() {
    return this.alertHistory;
  }

  getDhanStatus() {
    const has = Boolean(this.config?.clientId && this.config?.pin && this.config?.totpSecret);
    const id = this.config?.clientId || '';
    const forceMock = process.env.FNO_FORCE_MOCK === '1';
    let note = 'No Dhan credentials — using NSE public / labeled mock';
    if (has && forceMock) {
      note = 'Dhan credentials present but FNO_FORCE_MOCK=1 — labeled mock only. Save again or unset force mock for live pull.';
    } else if (has) {
      note = 'Dhan credentials configured — hybrid provider can pull live option chain / quotes';
    }
    return {
      hasDhan: has,
      liveCapable: has && !forceMock,
      source: this._credentialSource || (has ? 'env' : 'none'),
      clientIdMasked: id.length > 4 ? `${id.slice(0, 2)}••••${id.slice(-2)}` : (id ? '••••' : null),
      forceMock,
      provider: this.provider?.name || null,
      note,
    };
  }

  /**
   * Apply Dhan credentials at runtime and rebuild the market-data provider.
   * Secrets are kept in-memory (and optionally written to process.env); never returned by GET.
   */
  setDhanCredentials({ clientId, pin, totpSecret, persistEnv = false, clearForceMock = true } = {}) {
    const cid = String(clientId || '').trim();
    const p = String(pin || '').trim();
    const secret = String(totpSecret || '').trim().replace(/\s+/g, '');
    if (!cid || !p || !secret) {
      throw new Error('clientId, pin, and totpSecret are required');
    }
    this.config = this.config || {};
    this.config.clientId = cid;
    this.config.pin = p;
    this.config.totpSecret = secret;
    this.config.hasDhan = true;
    this._credentialSource = 'runtime';

    process.env.DHAN_CLIENT_ID = cid;
    process.env.DHAN_PIN = p;
    process.env.DHAN_TOTP_SECRET = secret;
    if (clearForceMock) delete process.env.FNO_FORCE_MOCK;

    this.provider = createProvider({ config: this.config, preferMock: false });
    this.cache.clear();

    if (persistEnv) {
      try {
        persistDhanEnv({ clientId: cid, pin: p, totpSecret: secret });
      } catch (err) {
        return {
          ...this.getDhanStatus(),
          persisted: false,
          persistError: err.message,
        };
      }
    }

    return { ...this.getDhanStatus(), persisted: Boolean(persistEnv) };
  }

  clearDhanCredentials() {
    if (this.config) {
      this.config.clientId = '';
      this.config.pin = '';
      this.config.totpSecret = '';
      this.config.hasDhan = false;
    }
    delete process.env.DHAN_CLIENT_ID;
    delete process.env.DHAN_PIN;
    delete process.env.DHAN_TOTP_SECRET;
    this._credentialSource = 'none';
    this.provider = createProvider({ config: this.config || {}, preferMock: false });
    this.cache.clear();
    return this.getDhanStatus();
  }

  async testDhanCredentials(override = null) {
    const { fetchAccessToken } = require('../dhanAuth');
    const cfg = override
      ? {
        clientId: String(override.clientId || '').trim(),
        pin: String(override.pin || '').trim(),
        totpSecret: String(override.totpSecret || '').trim().replace(/\s+/g, ''),
      }
      : {
        clientId: this.config?.clientId,
        pin: this.config?.pin,
        totpSecret: this.config?.totpSecret,
      };
    if (!cfg.clientId || !cfg.pin || !cfg.totpSecret) {
      throw new Error('Dhan credentials missing');
    }
    const { accessToken, expiryTime } = await fetchAccessToken(cfg);
    return {
      ok: true,
      expiryTime: expiryTime || null,
      tokenPreview: accessToken ? `${String(accessToken).slice(0, 4)}…` : null,
      message: 'Dhan access token generated successfully',
    };
  }
}

function persistDhanEnv({ clientId, pin, totpSecret }) {
  const fs = require('fs');
  const path = require('path');
  const envPath = path.join(process.cwd(), '.env');
  let text = '';
  try {
    text = fs.readFileSync(envPath, 'utf8');
  } catch {
    text = '';
  }
  const upsert = (key, value) => {
    const line = `${key}=${value}`;
    const re = new RegExp(`^${key}=.*$`, 'm');
    if (re.test(text)) text = text.replace(re, line);
    else text = `${text.trimEnd()}\n${line}\n`;
  };
  upsert('DHAN_CLIENT_ID', clientId);
  upsert('DHAN_PIN', pin);
  upsert('DHAN_TOTP_SECRET', totpSecret);
  fs.writeFileSync(envPath, text.endsWith('\n') ? text : `${text}\n`, 'utf8');
}

function defaultAlertRules() {
  return {
    unusualVolumeMult: 2,
    unusualOiPct: 8,
    ivExpansionPct: 10,
    ivContractionPct: 10,
    breakoutPct: 1.5,
    largeCallOiAdd: 500000,
    largePutOiAdd: 500000,
    pcrChange: 0.15,
    smartMoneyScoreAbove: 80,
    smartMoneyScoreBelow: -80,
    smartMoneyCrossAbove: 60,
    smartMoneyCrossBelow: -60,
    smartMoneyConfidenceAbove: 80,
  };
}

let singleton = null;
function getFnoService(config) {
  if (!singleton) singleton = new FnoService({ config });
  return singleton;
}

module.exports = {
  FnoService,
  getFnoService,
  defaultAlertRules,
  classifyBuildup,
  SECTOR_MAP,
};
