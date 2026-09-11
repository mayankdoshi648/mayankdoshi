'use strict';

const { createProvider } = require('./providers');
const { analyzeOptionChain } = require('./calculations/optionChainMetrics');
const { computeMarketRegime } = require('./calculations/marketRegime');
const { explainBuildup, classifyBuildup } = require('./calculations/oiBuildup');
const { computeSmartMoneyProxy } = require('./calculations/smartMoney');
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
      const smart = computeSmartMoneyProxy(row, { marketRegimeScore: regimeScore });
      const distHigh = row.high52w && row.ltp ? ((row.high52w - row.ltp) / row.high52w) * 100 : null;
      const distLow = row.low52w && row.ltp ? ((row.ltp - row.low52w) / row.low52w) * 100 : null;
      return {
        ...row,
        sector: row.sector || sectorForSymbol(row.symbol),
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
    const ranked = [...(scan.data || [])]
      .map((r) => ({ ...r, proxyScore: r.smartMoney?.score ?? r.score }))
      .sort((a, b) => Math.abs(b.proxyScore) - Math.abs(a.proxyScore))
      .slice(0, limit);
    return dataEnvelope({
      disclaimer: 'Smart Money Proxy — based on market behaviour; does NOT identify actual institutional trades.',
      rows: ranked,
    }, scan.meta);
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
    for (const q of ticker.data || []) bySym.set(q.symbol, {
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
    });
    const rows = symbols.map((symbol) => bySym.get(symbol) || { symbol, ltp: null, buildup: 'NEUTRAL', score: null });
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

      if (reasons.length) {
        fired.push({
          symbol: row.symbol,
          sector: row.sector,
          reasons,
          score: row.score,
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
