/**
 * Labeled MOCK payloads for static hosts (GitHub Pages).
 * Shareable mobile UI only — not live NSE/Dhan data.
 */

export const STATIC_DEMO_NOTICE =
  'STATIC DEMO (MOCK) — labeled sample for mobile GitHub Pages. Not live NSE/Dhan. Run the CAS API locally for real data.';

function tv(
  value: number | null,
  health: 'LIVE' | 'STALE' | 'UNAVAILABLE' = value == null ? 'UNAVAILABLE' : 'LIVE',
) {
  return {
    value,
    timestamp: value == null ? null : new Date().toISOString(),
    source: value == null ? 'UNAVAILABLE' : 'DERIVED',
    health,
    ageMs: value == null ? null : 0,
  };
}

function nextThursdayIso(): string {
  const d = new Date();
  const day = d.getUTCDay();
  const add = (4 - day + 7) % 7 || 7;
  d.setUTCDate(d.getUTCDate() + add);
  return d.toISOString().slice(0, 10);
}

function buildChain(spot: number, step: number, wings: number) {
  const atm = Math.round(spot / step) * step;
  const rows = [];
  for (let i = -wings; i <= wings; i += 1) {
    const strike = atm + i * step;
    const dist = Math.abs(i);
    rows.push({
      strike,
      call: {
        oi: 1_200_000 - dist * 80_000,
        oiChange: 40_000 - dist * 5_000,
        volume: 80_000 - dist * 4_000,
        iv: 12 + dist * 0.4,
        ltp: Math.max(5, 180 - dist * 22),
        bid: null,
        ask: null,
      },
      put: {
        oi: 1_050_000 - dist * 70_000,
        oiChange: 35_000 - dist * 4_000,
        volume: 70_000 - dist * 3_500,
        iv: 13 + dist * 0.35,
        ltp: Math.max(5, 160 - dist * 20),
        bid: null,
        ask: null,
      },
    });
  }
  return { atm, rows };
}

export function isStaticDemo(): boolean {
  if (import.meta.env.VITE_STATIC_DEMO === 'true') return true;
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname;
  return host.endsWith('github.io') || host.endsWith('vercel.app');
}

export const staticDemo = {
  health: () => ({ ok: true, dhanConfigured: false, mode: 'STATIC_DEMO' }),

  instruments: () => ({
    instruments: [
      { id: 'NIFTY', displayName: 'NIFTY 50', symbol: 'NIFTY' },
      { id: 'BANKNIFTY', displayName: 'NIFTY BANK', symbol: 'BANKNIFTY' },
    ],
  }),

  casModes: () => ({
    defaultMode: 'CURRENT_NSE',
    modes: [
      { mode: 'CURRENT_NSE', displayName: 'CURRENT NSE', isSimulation: false },
      { mode: 'SEBI_PROPOSAL_A', displayName: 'SEBI PROPOSAL A — SIMULATION', isSimulation: true },
      { mode: 'SEBI_PROPOSAL_B', displayName: 'SEBI PROPOSAL B — SIMULATION', isSimulation: true },
    ],
  }),

  expiries: (id: string) => ({
    instrumentId: id,
    expiries: [nextThursdayIso()],
  }),

  analytics: (id: string, q: { expiry?: string; casMode?: string; wings?: number }) => {
    const isBank = id.toUpperCase().includes('BANK');
    const spot = isBank ? 51240 : 24850;
    const step = isBank ? 100 : 50;
    const wings = q.wings ?? 5;
    const { atm, rows } = buildChain(spot, step, wings);
    const fut = spot + (isBank ? 42 : 18);
    const sessionVwap = spot - 12;
    const referenceVwap = spot - 5;
    const maxPain = atm - step;
    const now = Date.now();
    const spotSeries = Array.from({ length: 60 }, (_, i) => ({
      t: now - (60 - i) * 60_000,
      close: spot - 30 + Math.sin(i / 7) * 18 + i * 0.4,
    }));
    const simulation = (q.casMode ?? 'CURRENT_NSE') !== 'CURRENT_NSE';

    return {
      asOf: new Date().toISOString(),
      istTime: new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false }),
      instrument: { id: id.toUpperCase(), displayName: isBank ? 'NIFTY BANK' : 'NIFTY 50' },
      expiry: q.expiry || nextThursdayIso(),
      cas: {
        mode: q.casMode ?? 'CURRENT_NSE',
        displayName: simulation ? 'SEBI PROPOSAL — SIMULATION' : 'CURRENT NSE',
        isSimulation: simulation,
        sourceNote: STATIC_DEMO_NOTICE,
        phase: {
          id: 'REGULAR',
          label: 'Regular Session',
          start: '09:15:00',
          end: '15:00:00',
          lockDirectionalSignals: false,
          settlementOnly: false,
        },
        timeline: [
          {
            id: 'PRE_MARKET',
            label: 'Pre-Market',
            start: '09:00:00',
            end: '09:15:00',
            active: false,
            lockDirectionalSignals: true,
          },
          {
            id: 'REGULAR',
            label: 'Regular Session',
            start: '09:15:00',
            end: '15:00:00',
            active: true,
            lockDirectionalSignals: false,
          },
          {
            id: 'CAS_WINDOW',
            label: 'CAS Window',
            start: '15:00:00',
            end: '15:30:00',
            active: false,
            lockDirectionalSignals: true,
          },
          {
            id: 'CLOSED',
            label: 'Closed',
            start: '15:30:00',
            end: '23:59:59',
            active: false,
            lockDirectionalSignals: true,
          },
        ],
      },
      quotes: {
        spot: tv(spot),
        futures: tv(fut),
        basis: tv(fut - spot),
        basisPct: tv(((fut - spot) / spot) * 100),
        sessionVwap: tv(sessionVwap),
        referenceVwap: tv(referenceVwap),
      },
      optionMetrics: {
        maxPain: tv(maxPain),
        pcrOi: tv(0.92),
        pcrVolume: tv(0.88),
        atmIv: tv(13.4),
        atm,
        walls: {
          callWall: atm + step * 4,
          putWall: atm - step * 3,
          callDistance: step * 4,
          putDistance: step * 3,
        },
      },
      settlementZone: {
        lower: atm - step * 2,
        central: atm,
        upper: atm + step * 2,
        confidence: 62,
        explanation: ['MOCK zone around ATM / max-pain cluster', STATIC_DEMO_NOTICE],
        factors: [],
      },
      marketState: {
        state: 'RANGE / PIN',
        confidence: 58,
        explanation: ['MOCK: spot hugging session VWAP', 'Basis stable — no strong directional impulse'],
        factors: [],
      },
      casIntelligence: {
        score: 54,
        state: 'PINNING / MAGNET',
        confidence: 57,
        explanation: ['MOCK: OI magnet near ATM', 'Max pain is one input only — not settlement'],
        factors: [],
        lockedDirectional: false,
      },
      signalScore: {
        score: 12,
        label: 'NEUTRAL',
        locked: false,
        factors: [],
        explanation: ['MOCK: no strong edge in sample tape'],
      },
      casRisk: {
        level: 'MEDIUM',
        score: 45,
        explanation: ['Static demo risk label — not a live assessment'],
        factors: ['MOCK sample'],
      },
      optionChain: rows,
      charts: {
        spotSeries,
        sessionVwap,
        referenceVwap,
        settlementCentral: atm,
        settlementLower: atm - step * 2,
        settlementUpper: atm + step * 2,
        callOiByStrike: rows.map((r) => ({ strike: r.strike, oi: r.call.oi })),
        putOiByStrike: rows.map((r) => ({ strike: r.strike, oi: r.put.oi })),
        oiChangeByStrike: rows.map((r) => ({
          strike: r.strike,
          call: r.call.oiChange,
          put: r.put.oiChange,
        })),
      },
      // aliases used by TerminalCharts
      // (kept identical keys above)
      dataErrors: [],
      notices: [STATIC_DEMO_NOTICE, 'Max Pain ≠ settlement. Direction ≠ CAS pressure.'],
    };
  },

  getDhanSettings: () => ({
    configured: false,
    clientIdMasked: null,
  }),

  saveDhanSettings: async () => {
    throw new Error(
      'STATIC DEMO — set Live API host (Cloudflare Worker URL) in Settings to save Dhan Client ID + Access Token, or run the CAS API on Node.',
    );
  },

  clearDhanSettings: async () => ({ ok: true, configured: false }),

  getFuturesSettings: () => ({
    mappings: [
      { instrumentId: 'NIFTY', securityId: null },
      { instrumentId: 'BANKNIFTY', securityId: null },
    ],
  }),

  saveFuturesSettings: async () => {
    throw new Error('STATIC DEMO — futures mappings cannot be saved on GitHub Pages.');
  },

  casHistory: () => ({
    rows: [],
    notice: `UNAVAILABLE — ${STATIC_DEMO_NOTICE}`,
  }),

  backtests: () => ({
    runs: [],
    notice: `Backtests unavailable in static demo. ${STATIC_DEMO_NOTICE}`,
  }),
};
