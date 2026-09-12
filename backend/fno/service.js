'use strict';

const { createProvider } = require('./providers');
const { analyzeOptionChain } = require('./calculations/optionChainMetrics');
const { computeMarketRegime } = require('./calculations/marketRegime');
const { explainBuildup, classifyBuildup } = require('./calculations/oiBuildup');
const { computeSmartMoneyProxy, buildRankings, summarizeMarketBias, evaluateSmartMoneyAlert, DISCLAIMER } = require('./calculations/smartMoney');
const { evaluateOpportunity, buildOpportunityUniverse, filterOpportunityRows, DISCLAIMER: OPP_DISCLAIMER } = require('./calculations/opportunityChecklist');
const { computeSectorStrength, rankSectors } = require('./calculations/sectorStrength');
const { SECTOR_MAP, sectorForSymbol } = require('./universe/sectors');
const { TICKER_ORDER } = require('./universe/underlyings');
const { dataEnvelope } = require('./normalize');
const { getMarketDataStore, TTL: STORE_TTL, attachFreshness } = require('../marketData');

const CACHE_TTL_MS = {
  overview: STORE_TTL.OVERVIEW,
  chain: STORE_TTL.OPTION_CHAIN,
  scanner: STORE_TTL.SCANNER,
  futures: STORE_TTL.FUTURES_OI,
  fii: STORE_TTL.FII,
  ticker: STORE_TTL.TICKER,
};

class FnoService {
  constructor({ config = null, provider = null, dataSources = null } = {}) {
    this.config = config;
    this.dataSources = dataSources;
    this.provider = provider || createProvider({ config, dataSources });
    this.store = getMarketDataStore();
    this.watchlist = new Set(['NIFTY', 'BANKNIFTY', 'HDFCBANK', 'RELIANCE', 'TCS']);
    this.alertRules = defaultAlertRules();
    this.alertHistory = [];
    /** @type {Map<string, {score:number,confidence:number,setup:string,signal:string,at:string}>} */
    this._smartMoneyPrev = new Map();
    /** @type {Map<string, Array<{at:string,score:number,confidence:number,priceChangePct:number|null,oiChangePct:number|null,relativeVolume:number|null,ltp:number|null}>>} */
    this._smartMoneyHistory = new Map();
    this._credentialSource = (
      (config?.clientId && config?.accessToken)
      || (config?.clientId && config?.pin && config?.totpSecret)
    ) ? 'env' : 'none';
  }

  async _cached(key, ttl, fetcher, sourceHint = null) {
    return this.store.getOrFetch(key, ttl, async () => attachFreshness(await fetcher()), { sourceHint });
  }

  async getTicker() {
    return this._cached('fno:ticker', CACHE_TTL_MS.ticker, async () => {
      const env = await this.provider.getIndexQuotes(TICKER_ORDER);
      const bySym = new Map((env.data || []).map((q) => [q.symbol, q]));
      const ordered = TICKER_ORDER.map((id) => bySym.get(id) || { symbol: id, ltp: null, source: env.meta.source });
      return dataEnvelope(ordered, env.meta);
    }, 'NSE');
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
    const key = `fno:chain:${underlying}:${expiry || 'near'}`;
    return this._cached(key, CACHE_TTL_MS.chain, async () => {
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
      return dataEnvelope(analyzed, env.meta);
    }, 'DHAN');
  }

  async getExpiries(underlying = 'NIFTY') {
    return this.provider.getOptionExpiries(underlying);
  }

  async getFoScanner({ signal = null, sector = null, minAbsScore = 0 } = {}) {
    const env = await this._cached('fno:futures', CACHE_TTL_MS.futures, async () => {
      return this.provider.getFuturesQuotes();
    }, 'DHAN');

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
    return this._cached('fno:fii', CACHE_TTL_MS.fii, async () => {
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
      return dataEnvelope(enriched, { ...env.meta, source: env.meta?.source || 'NSE' });
    }, 'NSE');
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

      // Opportunity thresholds — reuse same scanner row; evaluate lightly without full board rebuild cost per alert pass
      try {
        const opp = evaluateOpportunity(row, {});
        if (rules.opportunityScoreAbove != null && opp.opportunityScore >= rules.opportunityScoreAbove) {
          reasons.push(`Opportunity score ${opp.opportunityScore} ≥ ${rules.opportunityScoreAbove}`);
        }
        if (rules.opportunityConfidenceAbove != null && opp.confidence >= rules.opportunityConfidenceAbove) {
          reasons.push(`Opportunity confidence ${opp.confidence}% ≥ ${rules.opportunityConfidenceAbove}%`);
        }
        if (rules.opportunityGradeAPlus && opp.grade === 'A+') {
          reasons.push('Opportunity grade A+');
        }
        if (rules.opportunityReady && opp.readiness?.status === 'READY') {
          reasons.push('Opportunity READY');
        }
      } catch {
        /* ignore opportunity eval errors in alert loop */
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

  async _opportunityContext() {
    const overview = await this.getMarketOverviewIntelligence();
    const sectorsEnv = await this.getSectorAnalysis();
    let fii = null;
    try {
      fii = await this.getFiiDii();
    } catch {
      fii = null;
    }
    const indices = {};
    for (const q of overview.data?.ticker || []) {
      indices[String(q.symbol).toUpperCase()] = q;
    }
    const sectorsByName = new Map((sectorsEnv.data || []).map((s) => [s.sector, s]));
    return {
      regime: overview.data?.regime || null,
      indices,
      fii: fii?.data || null,
      sectorsByName,
      optionSnapshot: overview.data?.optionSnapshot || null,
    };
  }

  async getOpportunityBoard({ filter = null, sort = 'opportunityScore', dir = 'desc', limit = 80 } = {}) {
    const scan = await this.getFoScanner();
    const ctx = await this._opportunityContext();
    const universe = buildOpportunityUniverse(scan.data || [], ctx);
    const filtered = filterOpportunityRows(universe.rows, { filter, sort, dir });
    const rows = filtered.slice(0, Math.max(1, Number(limit) || 80));
    return dataEnvelope({
      disclaimer: OPP_DISCLAIMER,
      rows,
      rankings: universe.rankings,
      heatmap: universe.heatmap,
      metaExtras: {
        filter: filter || null,
        sort,
        dir,
        total: universe.rows.length,
        shown: rows.length,
      },
    }, scan.meta);
  }

  async getOpportunityDetail(symbol) {
    const sym = String(symbol || '').toUpperCase();
    const scan = await this.getFoScanner();
    const row = (scan.data || []).find((r) => String(r.symbol).toUpperCase() === sym);
    if (!row) {
      return dataEnvelope(null, {
        asOf: new Date().toISOString(),
        source: 'error',
        isMock: false,
        error: `Symbol not found: ${sym}`,
      });
    }
    const ctx = await this._opportunityContext();
    const sectorStats = ctx.sectorsByName.get(row.sector) || null;
    let chainMetrics = null;
    // Only attach index option snapshot as soft market options context — never invent stock chain.
    if (['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY'].includes(sym) && ctx.optionSnapshot) {
      chainMetrics = {
        pcr: ctx.optionSnapshot.pcr,
        atmIv: ctx.optionSnapshot.atm?.iv ?? null,
        expectedMove: ctx.optionSnapshot.expectedMove || null,
        callResistance: null,
        putSupport: null,
      };
    }
    const detail = evaluateOpportunity(row, { ...ctx, sectorStats, chainMetrics });
    return dataEnvelope(detail, scan.meta);
  }

  getDhanStatus() {
    const hasStatic = Boolean(this.config?.clientId && this.config?.accessToken);
    const hasLogin = Boolean(this.config?.clientId && this.config?.pin && this.config?.totpSecret);
    const has = hasStatic || hasLogin;
    const id = this.config?.clientId || '';
    const forceMock = process.env.FNO_FORCE_MOCK === '1';
    let note = 'No Dhan credentials — using NSE public / labeled mock';
    if (has && forceMock) {
      note = 'Dhan credentials present but FNO_FORCE_MOCK=1 — labeled mock only. Save again or unset force mock for live pull.';
    } else if (hasStatic) {
      note = 'Dhan client id + access token configured — hybrid provider can pull live option chain / quotes';
    } else if (has) {
      note = 'Dhan credentials configured — hybrid provider can pull live option chain / quotes';
    }
    const runtime = process.env.POWERBULL_RUNTIME || 'node';
    const cloudflare = runtime === 'cloudflare';
    if (cloudflare && !has) {
      note = 'No Dhan credentials — enter Client ID + Access Token (encrypted session cookie). PIN/TOTP is Node-only.';
    } else if (cloudflare && hasStatic) {
      note = 'Dhan Client ID + Access Token active (Cloudflare session or Pages secret). Token is never returned by GET.';
    }
    return {
      hasDhan: has,
      liveCapable: has && !forceMock,
      source: this._credentialSource || (has ? 'env' : 'none'),
      authMode: hasStatic ? 'access_token' : (hasLogin ? 'pin_totp' : null),
      clientIdMasked: id.length > 4 ? `${id.slice(0, 2)}••••${id.slice(-2)}` : (id ? '••••' : null),
      forceMock,
      provider: this.provider?.name || null,
      note,
      runtime,
      staticOnly: false,
      persistSupported: !cloudflare,
      pinTotpSupported: !cloudflare,
    };
  }

  /**
   * Apply Dhan credentials at runtime and rebuild the market-data provider.
   * Secrets are kept in-memory (and optionally written to process.env); never returned by GET.
   * Accepts either accessToken+clientId OR clientId+pin+totpSecret.
   */
  setDhanCredentials({
    clientId,
    pin,
    totpSecret,
    accessToken,
    persistEnv = false,
    clearForceMock = true,
  } = {}) {
    const cid = String(clientId || '').trim();
    const p = String(pin || '').trim();
    const secret = String(totpSecret || '').trim().replace(/\s+/g, '');
    const token = String(accessToken || '').trim();
    const useStatic = Boolean(cid && token);
    const useLogin = Boolean(cid && p && secret);
    if (!useStatic && !useLogin) {
      throw new Error('Provide clientId + accessToken, or clientId + pin + totpSecret');
    }
    this.config = this.config || {};
    this.config.clientId = cid;
    if (useStatic) {
      this.config.accessToken = token;
      // Keep optional login secrets if already present; not required for live.
      if (p) this.config.pin = p;
      if (secret) this.config.totpSecret = secret;
    } else {
      this.config.pin = p;
      this.config.totpSecret = secret;
    }
    this.config.hasDhan = true;
    this._credentialSource = 'runtime';

    process.env.DHAN_CLIENT_ID = cid;
    if (useStatic) {
      process.env.DHAN_ACCESS_TOKEN = token;
    } else {
      process.env.DHAN_PIN = p;
      process.env.DHAN_TOTP_SECRET = secret;
    }
    if (clearForceMock) delete process.env.FNO_FORCE_MOCK;

    this.provider = createProvider({ config: this.config, preferMock: false, dataSources: this.dataSources });
    this.store.invalidate('fno:');

    if (persistEnv) {
      try {
        persistDhanEnv({
          clientId: cid,
          pin: useLogin ? p : undefined,
          totpSecret: useLogin ? secret : undefined,
          accessToken: useStatic ? token : undefined,
        });
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
      this.config.accessToken = '';
      this.config.hasDhan = false;
    }
    delete process.env.DHAN_CLIENT_ID;
    delete process.env.DHAN_PIN;
    delete process.env.DHAN_TOTP_SECRET;
    delete process.env.DHAN_ACCESS_TOKEN;
    this._credentialSource = 'none';
    this.provider = createProvider({ config: this.config || {}, preferMock: false, dataSources: this.dataSources });
    this.store.invalidate('fno:');
    return this.getDhanStatus();
  }

  async testDhanCredentials(override = null) {
    const { fetchAccessToken } = require('../dhanAuth');
    const cfg = override
      ? {
        clientId: String(override.clientId || '').trim(),
        pin: String(override.pin || '').trim(),
        totpSecret: String(override.totpSecret || '').trim().replace(/\s+/g, ''),
        accessToken: String(override.accessToken || '').trim(),
      }
      : {
        clientId: this.config?.clientId,
        pin: this.config?.pin,
        totpSecret: this.config?.totpSecret,
        accessToken: this.config?.accessToken,
      };

    if (cfg.clientId && cfg.accessToken) {
      return {
        ok: true,
        expiryTime: this.config?.accessTokenExpiry || null,
        authMode: 'access_token',
        message: 'Static Dhan access token accepted (PIN/TOTP not required)',
      };
    }

    if (!cfg.clientId || !cfg.pin || !cfg.totpSecret) {
      throw new Error('Dhan credentials missing — need clientId + accessToken, or pin + totpSecret');
    }
    const { accessToken, expiryTime } = await fetchAccessToken(cfg);
    return {
      ok: true,
      expiryTime: expiryTime || null,
      authMode: 'pin_totp',
      message: 'Dhan access token generated successfully',
      // Do not return tokenPreview — avoids leaking token fragments to clients/logs.
      tokenLength: accessToken ? String(accessToken).length : 0,
    };
  }
}

function persistDhanEnv({ clientId, pin, totpSecret, accessToken }) {
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
    if (value === undefined || value === null) return;
    const line = `${key}=${value}`;
    const re = new RegExp(`^${key}=.*$`, 'm');
    if (re.test(text)) text = text.replace(re, line);
    else text = `${text.trimEnd()}\n${line}\n`;
  };
  upsert('DHAN_CLIENT_ID', clientId);
  if (accessToken) upsert('DHAN_ACCESS_TOKEN', accessToken);
  if (pin) upsert('DHAN_PIN', pin);
  if (totpSecret) upsert('DHAN_TOTP_SECRET', totpSecret);
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
    opportunityScoreAbove: 85,
    opportunityConfidenceAbove: 80,
    opportunityGradeAPlus: true,
    opportunityReady: true,
  };
}

let singleton = null;
function getFnoService(config, { dataSources = null } = {}) {
  if (!singleton) singleton = new FnoService({ config, dataSources });
  return singleton;
}

module.exports = {
  FnoService,
  getFnoService,
  defaultAlertRules,
  classifyBuildup,
  SECTOR_MAP,
};
