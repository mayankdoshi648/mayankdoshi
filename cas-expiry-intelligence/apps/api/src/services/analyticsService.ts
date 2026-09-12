import {
  CAS_CONFIG,
  DEFAULT_CAS_MODE,
  assessAlignment,
  computeBasis,
  computeBasisPct,
  computeCasIntelligence,
  computeCasRisk,
  computeMarketState,
  computeMaxPain,
  computePcrOi,
  computePcrVolume,
  computeSettlementZone,
  computeSignalScore,
  computeVwap,
  detectWalls,
  enabledInstruments,
  filterCandlesByTime,
  formatIstDate,
  formatIstTime,
  getInstrument,
  makeTimedValue,
  nearestAtmStrike,
  normalizeTsMs,
  resolveCasPhase,
  sliceAroundAtm,
  type Candle,
  type CasMode,
  type OptionStrikeRow,
} from '@cas/shared';
import { getDb } from '../db/client.js';
import * as dhan from './dhanClient.js';

function istWindowMs(dateIst: string, startHms: string, endHms: string): { startMs: number; endMs: number } {
  // dateIst: YYYY-MM-DD, times are IST
  const start = Date.parse(`${dateIst}T${startHms}+05:30`);
  const end = Date.parse(`${dateIst}T${endHms}+05:30`);
  return { startMs: start, endMs: end };
}

function asNumber(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function extractLtp(quotePayload: any, segment: string, securityId: string): { ltp: number | null; ts: string | null } {
  try {
    const block = quotePayload?.data?.[segment]?.[securityId] ?? quotePayload?.data?.[securityId];
    const ltp = asNumber(block?.last_price ?? block?.LTP ?? block?.ltp);
    const ts =
      block?.last_trade_time || block?.timestamp
        ? new Date(block.last_trade_time ?? block.timestamp).toISOString()
        : new Date().toISOString();
    return { ltp, ts: ltp == null ? null : ts };
  } catch {
    return { ltp: null, ts: null };
  }
}

function candlesFromIntraday(payload: any): Candle[] {
  // Dhan intraday often returns parallel arrays open/high/low/close/volume/timestamp
  if (!payload) return [];
  const data = payload.data ?? payload;
  if (Array.isArray(data)) {
    return data
      .map((c: any) => ({
        ts: normalizeTsMs(Number(c.start_Time ?? c.timestamp ?? c.ts ?? 0)),
        open: Number(c.open),
        high: Number(c.high),
        low: Number(c.low),
        close: Number(c.close),
        volume: Number(c.volume ?? 0),
      }))
      .filter((c: Candle) => Number.isFinite(c.close));
  }
  const tsArr = data.timestamp ?? data.start_Time ?? [];
  const out: Candle[] = [];
  for (let i = 0; i < tsArr.length; i += 1) {
    out.push({
      ts: normalizeTsMs(Number(tsArr[i])),
      open: Number(data.open?.[i]),
      high: Number(data.high?.[i]),
      low: Number(data.low?.[i]),
      close: Number(data.close?.[i]),
      volume: Number(data.volume?.[i] ?? 0),
    });
  }
  return out.filter((c) => Number.isFinite(c.close));
}

function optionRowsFromChain(payload: any): OptionStrikeRow[] {
  const data = payload?.data ?? payload ?? {};
  const oc = data.oc ?? data.optionChain ?? data;
  const rows: OptionStrikeRow[] = [];

  if (Array.isArray(oc)) {
    for (const row of oc) {
      const strike = asNumber(row.strikePrice ?? row.strike);
      if (strike == null) continue;
      rows.push({
        strike,
        call: {
          oi: asNumber(row.ce?.oi ?? row.callOi),
          oiChange: asNumber(row.ce?.oiChange ?? row.callOiChange),
          volume: asNumber(row.ce?.volume ?? row.callVolume),
          iv: asNumber(row.ce?.impliedVolatility ?? row.ce?.iv),
          ltp: asNumber(row.ce?.last_price ?? row.ce?.ltp),
          bid: asNumber(row.ce?.topBidPrice ?? row.ce?.bid),
          ask: asNumber(row.ce?.topAskPrice ?? row.ce?.ask),
        },
        put: {
          oi: asNumber(row.pe?.oi ?? row.putOi),
          oiChange: asNumber(row.pe?.oiChange ?? row.putOiChange),
          volume: asNumber(row.pe?.volume ?? row.putVolume),
          iv: asNumber(row.pe?.impliedVolatility ?? row.pe?.iv),
          ltp: asNumber(row.pe?.last_price ?? row.pe?.ltp),
          bid: asNumber(row.pe?.topBidPrice ?? row.pe?.bid),
          ask: asNumber(row.pe?.topAskPrice ?? row.pe?.ask),
        },
      });
    }
    return rows.sort((a, b) => a.strike - b.strike);
  }

  // Map keyed by strike
  for (const [strikeKey, val] of Object.entries(oc)) {
    const strike = asNumber(strikeKey);
    if (strike == null || typeof val !== 'object' || val == null) continue;
    const v = val as any;
    const ce = v.ce ?? v.CE ?? v.call ?? {};
    const pe = v.pe ?? v.PE ?? v.put ?? {};
    rows.push({
      strike,
      call: {
        oi: asNumber(ce.oi),
        oiChange: asNumber(ce.previous_oi != null && ce.oi != null ? Number(ce.oi) - Number(ce.previous_oi) : ce.oiChange),
        volume: asNumber(ce.volume),
        iv: asNumber(ce.implied_volatility ?? ce.iv),
        ltp: asNumber(ce.last_price ?? ce.ltp),
        bid: asNumber(ce.top_bid_price ?? ce.bid),
        ask: asNumber(ce.top_ask_price ?? ce.ask),
      },
      put: {
        oi: asNumber(pe.oi),
        oiChange: asNumber(pe.previous_oi != null && pe.oi != null ? Number(pe.oi) - Number(pe.previous_oi) : pe.oiChange),
        volume: asNumber(pe.volume),
        iv: asNumber(pe.implied_volatility ?? pe.iv),
        ltp: asNumber(pe.last_price ?? pe.ltp),
        bid: asNumber(pe.top_bid_price ?? pe.bid),
        ask: asNumber(pe.top_ask_price ?? pe.ask),
      },
    });
  }
  return rows.sort((a, b) => a.strike - b.strike);
}

export function listInstruments() {
  return enabledInstruments();
}

export async function listExpiries(instrumentId: string): Promise<string[]> {
  const inst = getInstrument(instrumentId);
  if (!inst) return [];
  if (!dhan.hasDhanCredentials()) return [];
  try {
    const raw: any = await dhan.fetchExpiryList({
      UnderlyingScrip: Number(inst.spotSecurityId),
      UnderlyingSeg: inst.spotSegment,
    });
    const list: string[] = raw?.data ?? raw ?? [];
    const expiries = (Array.isArray(list) ? list : []).map(String).sort();
    const db = getDb();
    const upsert = db.prepare(
      `INSERT OR IGNORE INTO expiry_dates(instrument_id, expiry) VALUES(?, ?)`,
    );
    for (const e of expiries) upsert.run(inst.id, e);
    return expiries;
  } catch {
    const rows = getDb()
      .prepare('SELECT expiry FROM expiry_dates WHERE instrument_id = ? ORDER BY expiry')
      .all(instrumentId) as { expiry: string }[];
    return rows.map((r) => r.expiry);
  }
}

export async function buildAnalytics(input: {
  instrumentId: string;
  expiry?: string | null;
  casMode?: CasMode;
  wingStrikes?: number;
}) {
  const inst = getInstrument(input.instrumentId);
  if (!inst) throw new Error(`Unknown instrument ${input.instrumentId}`);

  const casMode = input.casMode ?? DEFAULT_CAS_MODE;
  const now = new Date();
  const { config, phase } = resolveCasPhase(casMode, now);
  const istDate = formatIstDate(now);
  const wing = input.wingStrikes ?? 5;

  let spotLtp: number | null = null;
  let spotTs: string | null = null;
  let futLtp: number | null = null;
  let futTs: string | null = null;
  let candles: Candle[] = [];
  let optionRows: OptionStrikeRow[] = [];
  let optionTs: string | null = null;
  let expiry = input.expiry ?? null;
  let dataErrors: string[] = [];

  if (!dhan.hasDhanCredentials()) {
    dataErrors.push('Dhan credentials not configured — values show UNAVAILABLE');
  } else {
    try {
      const quote: any = await dhan.fetchMarketQuote({
        [inst.spotSegment]: [Number(inst.spotSecurityId)],
      });
      const spot = extractLtp(quote, inst.spotSegment, inst.spotSecurityId);
      spotLtp = spot.ltp;
      spotTs = spot.ts;
    } catch (e: any) {
      dataErrors.push(`Spot quote failed: ${e.message}`);
    }

    try {
      // Nearest futures via option/expiry infrastructure is preferred; for Phase 1 use index quote as fallback marker.
      // Futures LTP requires futures security id mapping — until mapped, mark UNAVAILABLE rather than fabricating.
      futLtp = null;
      futTs = null;
    } catch (e: any) {
      dataErrors.push(`Futures quote failed: ${e.message}`);
    }

    try {
      const hist: any = await dhan.fetchIntradayHistory({
        securityId: inst.spotSecurityId,
        exchangeSegment: inst.spotSegment,
        instrument: 'INDEX',
        interval: '1',
        oi: false,
        fromDate: `${istDate} 09:15:00`,
        toDate: `${istDate} 15:30:00`,
      });
      candles = candlesFromIntraday(hist);
    } catch (e: any) {
      dataErrors.push(`Intraday history failed: ${e.message}`);
    }

    try {
      if (!expiry) {
        const expiries = await listExpiries(inst.id);
        expiry = expiries[0] ?? null;
      }
      if (expiry) {
        const oc: any = await dhan.fetchOptionChain({
          UnderlyingScrip: Number(inst.spotSecurityId),
          UnderlyingSeg: inst.spotSegment,
          Expiry: expiry,
        });
        optionRows = optionRowsFromChain(oc);
        optionTs = new Date().toISOString();
      }
    } catch (e: any) {
      dataErrors.push(`Option chain failed: ${e.message}`);
    }
  }

  const sessionVwap = computeVwap(candles);
  const ref = config.referenceWindow;
  const { startMs, endMs } = istWindowMs(istDate, ref.start, ref.end);
  const refCandles = filterCandlesByTime(candles, startMs, endMs);
  const referenceVwap = computeVwap(refCandles);

  const basis = computeBasis(spotLtp, futLtp);
  const basisPct = computeBasisPct(spotLtp, futLtp);

  const alignment = assessAlignment({
    spotTs,
    futuresTs: futTs,
    optionTs,
  });

  const pcrOi = optionRows.length ? computePcrOi(optionRows) : null;
  const pcrVol = optionRows.length ? computePcrVolume(optionRows) : null;
  const maxPain = optionRows.length ? computeMaxPain(optionRows) : null;
  const walls =
    spotLtp != null && optionRows.length ? detectWalls(optionRows, spotLtp) : detectWalls([], 0);

  const settlement = computeSettlementZone({
    spot: spotLtp,
    futures: futLtp,
    basis,
    referenceVwap,
    maxPain,
    callWall: walls.callWall,
    putWall: walls.putWall,
    pcrOi,
    oiChangePressure: null,
    ivScore: null,
  });

  const locked = phase.lockDirectionalSignals;
  const marketState = computeMarketState({
    spot: spotLtp,
    vwap: sessionVwap,
    referenceVwap,
    basis,
    basisExpanding: null,
    momentum: null,
    callWall: walls.callWall,
    putWall: walls.putWall,
    ivHigh: null,
  });

  const casIntel = computeCasIntelligence({
    spot: spotLtp,
    referenceVwap,
    maxPain,
    callWall: walls.callWall,
    putWall: walls.putWall,
    basis,
    pcrOi,
    oiMagnetScore: null,
    lockedDirectional: locked,
  });

  const signal = computeSignalScore({
    locked,
    lockReason: locked ? `Directional signals locked during phase ${phase.label}` : undefined,
    spot: spotLtp,
    vwap: sessionVwap,
    referenceVwap,
    basis,
    basisWeakening: null,
    momentum: null,
    callWall: walls.callWall,
    putWall: walls.putWall,
    oiChangePressure: null,
    pcrOi,
  });

  const casRisk = computeCasRisk({
    isExpiryDay: Boolean(expiry && expiry === istDate),
    iv: null,
    spotFuturesDivergencePct: basisPct,
    distanceFromRefPct:
      spotLtp != null && referenceVwap != null ? ((spotLtp - referenceVwap) / spotLtp) * 100 : null,
    oiConcentration: null,
    nearWall:
      spotLtp != null &&
      ((walls.callDistance != null && walls.callDistance / spotLtp < 0.0025) ||
        (walls.putDistance != null && walls.putDistance / spotLtp < 0.0025)),
    rapidOiChange: null,
    ivExpanding: null,
    dataQuality: alignment.aligned ? 0.8 : 0.4,
    timestampMismatch: !alignment.aligned,
  });

  const atm =
    spotLtp != null ? nearestAtmStrike(spotLtp, inst.strikeInterval) : null;
  const chainSlice =
    atm != null ? sliceAroundAtm(optionRows, atm, inst.strikeInterval, wing) : optionRows.slice(0, 11);

  // Persist lightweight snapshot (never fabricate values)
  try {
    getDb()
      .prepare(
        `INSERT INTO market_snapshots(instrument_id, as_of, payload) VALUES(?, ?, ?)`,
      )
      .run(inst.id, now.toISOString(), JSON.stringify({ spotLtp, futLtp, sessionVwap, referenceVwap }));
  } catch {
    // non-fatal
  }

  return {
    asOf: now.toISOString(),
    istTime: formatIstTime(now),
    istDate,
    instrument: inst,
    expiry,
    cas: {
      mode: config.mode,
      displayName: config.displayName,
      isSimulation: config.isSimulation,
      sourceNote: config.sourceNote,
      phase,
      timeline: config.phases.map((p) => ({
        id: p.id,
        label: p.label,
        start: p.start,
        end: p.end,
        active: p.id === phase.id,
        lockDirectionalSignals: p.lockDirectionalSignals,
        settlementOnly: p.settlementOnly,
        description: p.description,
      })),
    },
    alignment,
    quotes: {
      spot: makeTimedValue(spotLtp, spotTs, 'DHAN'),
      futures: makeTimedValue(futLtp, futTs, 'DHAN'),
      basis: makeTimedValue(basis, spotTs ?? futTs, 'DERIVED'),
      basisPct: makeTimedValue(basisPct, spotTs ?? futTs, 'DERIVED'),
      sessionVwap: makeTimedValue(sessionVwap, candles.at(-1) ? new Date(candles.at(-1)!.ts).toISOString() : null, 'DERIVED'),
      referenceVwap: makeTimedValue(referenceVwap, refCandles.length ? new Date(endMs).toISOString() : null, 'DERIVED'),
    },
    optionMetrics: {
      pcrOi: makeTimedValue(pcrOi, optionTs, 'DERIVED'),
      pcrVolume: makeTimedValue(pcrVol, optionTs, 'DERIVED'),
      maxPain: makeTimedValue(maxPain, optionTs, 'DERIVED'),
      walls,
      atm,
    },
    settlementZone: settlement,
    marketState,
    casIntelligence: casIntel,
    signalScore: signal,
    casRisk,
    optionChain: chainSlice,
    dataErrors,
    notices: [
      ...(config.isSimulation
        ? ['SIMULATION MODE — SEBI proposal timings are not live NSE rules']
        : ['CAS mode: CURRENT NSE (configurable; update CAS_CONFIG when exchange revises timings)']),
      'Max Pain is one input to settlement analysis — not the settlement price.',
      'Market direction and CAS settlement pressure are independent outputs.',
      'This application does not place, modify, or cancel orders.',
      ...dataErrors,
    ],
  };
}

export function listCasModes() {
  return Object.values(CAS_CONFIG).map((c) => ({
    mode: c.mode,
    displayName: c.displayName,
    isSimulation: c.isSimulation,
    sourceNote: c.sourceNote,
  }));
}
