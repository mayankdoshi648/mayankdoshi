/**
 * CENTRAL CAS CONFIGURATION
 *
 * All CAS timings and regulatory modes live here.
 * Business logic MUST read from this object — never hard-code clock times.
 *
 * Modes:
 *  - CURRENT_NSE          → default live NSE CAS framework (reference)
 *  - SEBI_PROPOSAL_A      → SIMULATION ONLY
 *  - SEBI_PROPOSAL_B      → SIMULATION ONLY
 *
 * Timings are IST (Asia/Kolkata), expressed as HH:MM:SS strings.
 * Update this file when NSE/SEBI publish revised schedules.
 */

export type CasMode = 'CURRENT_NSE' | 'SEBI_PROPOSAL_A' | 'SEBI_PROPOSAL_B';

export type CasPhaseId =
  | 'PRE_MARKET'
  | 'REGULAR'
  | 'PRE_CAS'
  | 'REFERENCE_WINDOW'
  | 'TRANSITION_REFERENCE'
  | 'ORDER_ENTRY'
  | 'LIMIT_ONLY'
  | 'MATCHING'
  | 'CAS_COMPLETE'
  | 'POST_CAS_FO'
  | 'POST_CLOSE'
  | 'SESSION_END'
  | 'CLOSED';

export interface CasPhaseDef {
  id: CasPhaseId;
  label: string;
  /** Inclusive start HH:MM:SS IST */
  start: string;
  /** Exclusive end HH:MM:SS IST (except last phase) */
  end: string;
  /** Lock directional trading-style signals */
  lockDirectionalSignals: boolean;
  /** Emphasize settlement intelligence only */
  settlementOnly: boolean;
  description: string;
}

export interface CasModeConfig {
  mode: CasMode;
  displayName: string;
  /** Must be true for proposal modes */
  isSimulation: boolean;
  sourceNote: string;
  /** Equity cash continuous session end (IST) */
  cashContinuousEnd: string;
  /** Equity derivatives continuous session end (IST) */
  derivativesContinuousEnd: string;
  /** Reference VWAP calculation window */
  referenceWindow: { start: string; end: string };
  phases: CasPhaseDef[];
}

const CURRENT_NSE_PHASES: CasPhaseDef[] = [
  {
    id: 'PRE_MARKET',
    label: 'Pre-Market',
    start: '00:00:00',
    end: '09:15:00',
    lockDirectionalSignals: true,
    settlementOnly: false,
    description: 'Before regular session open',
  },
  {
    id: 'REGULAR',
    label: 'Regular Session',
    start: '09:15:00',
    end: '14:30:00',
    lockDirectionalSignals: false,
    settlementOnly: false,
    description: 'Normal continuous trading',
  },
  {
    id: 'PRE_CAS',
    label: 'Pre-CAS',
    start: '14:30:00',
    end: '15:00:00',
    lockDirectionalSignals: false,
    settlementOnly: false,
    description: 'Approaching reference / CAS window',
  },
  {
    id: 'REFERENCE_WINDOW',
    label: 'Reference Window',
    start: '15:00:00',
    end: '15:15:00',
    lockDirectionalSignals: false,
    settlementOnly: false,
    description: '3:00–3:15 PM reference-price calculation period',
  },
  {
    id: 'TRANSITION_REFERENCE',
    label: 'Transition / Reference',
    start: '15:15:00',
    end: '15:20:00',
    lockDirectionalSignals: true,
    settlementOnly: true,
    description: '3:15–3:20 PM transition/reference stage',
  },
  {
    id: 'ORDER_ENTRY',
    label: 'CAS Order Entry',
    start: '15:20:00',
    end: '15:25:00',
    lockDirectionalSignals: true,
    settlementOnly: true,
    description: '3:20–3:25 PM order entry / modification / cancellation',
  },
  {
    id: 'LIMIT_ONLY',
    label: 'CAS Limit Only',
    start: '15:25:00',
    end: '15:30:00',
    lockDirectionalSignals: true,
    settlementOnly: true,
    description: '3:25–3:30 PM limit orders only',
  },
  {
    id: 'MATCHING',
    label: 'CAS Matching',
    start: '15:30:00',
    end: '15:35:00',
    lockDirectionalSignals: true,
    settlementOnly: true,
    description: '3:30–3:35 PM order matching / trade confirmation',
  },
  {
    id: 'CAS_COMPLETE',
    label: 'CAS Complete',
    start: '15:35:00',
    end: '15:40:00',
    lockDirectionalSignals: true,
    settlementOnly: true,
    description: 'CAS complete; F&O still active until derivatives close',
  },
  {
    id: 'POST_CAS_FO',
    label: 'Post-CAS F&O',
    start: '15:40:00',
    end: '15:50:00',
    lockDirectionalSignals: true,
    settlementOnly: true,
    description: 'Post-CAS / F&O divergence window (derivatives may already be closed depending on product)',
  },
  {
    id: 'POST_CLOSE',
    label: 'Post-Close',
    start: '15:50:00',
    end: '16:00:00',
    lockDirectionalSignals: true,
    settlementOnly: true,
    description: '3:50–4:00 PM post-close session',
  },
  {
    id: 'SESSION_END',
    label: 'Session End',
    start: '16:00:00',
    end: '23:59:59',
    lockDirectionalSignals: true,
    settlementOnly: false,
    description: 'After session end',
  },
];

/**
 * SEBI Proposal A — SIMULATION placeholders.
 * Replace timings when mapping exact consultation-paper slots.
 * Clearly labelled simulation; not live NSE rules.
 */
const SEBI_PROPOSAL_A_PHASES: CasPhaseDef[] = CURRENT_NSE_PHASES.map((p) => {
  // Illustrative shift: extend reference by 5 minutes for simulation demos
  if (p.id === 'REFERENCE_WINDOW') {
    return { ...p, end: '15:20:00', description: '[SIM] Extended reference window (Proposal A placeholder)' };
  }
  if (p.id === 'TRANSITION_REFERENCE') {
    return { ...p, start: '15:20:00', end: '15:22:00', description: '[SIM] Compressed transition (Proposal A placeholder)' };
  }
  if (p.id === 'ORDER_ENTRY') {
    return { ...p, start: '15:22:00', end: '15:28:00', description: '[SIM] Extended order entry (Proposal A placeholder)' };
  }
  if (p.id === 'LIMIT_ONLY') {
    return { ...p, start: '15:28:00', end: '15:32:00', description: '[SIM] Limit-only (Proposal A placeholder)' };
  }
  if (p.id === 'MATCHING') {
    return { ...p, start: '15:32:00', end: '15:37:00', description: '[SIM] Matching (Proposal A placeholder)' };
  }
  if (p.id === 'CAS_COMPLETE') {
    return { ...p, start: '15:37:00', description: '[SIM] CAS complete (Proposal A placeholder)' };
  }
  return { ...p, description: `[SIM] ${p.description}` };
});

/**
 * SEBI Proposal B — SIMULATION placeholders (alternate structure).
 */
const SEBI_PROPOSAL_B_PHASES: CasPhaseDef[] = CURRENT_NSE_PHASES.map((p) => {
  if (p.id === 'REFERENCE_WINDOW') {
    return { ...p, start: '15:00:00', end: '15:10:00', description: '[SIM] Shorter reference window (Proposal B placeholder)' };
  }
  if (p.id === 'TRANSITION_REFERENCE') {
    return { ...p, start: '15:10:00', end: '15:15:00', description: '[SIM] Transition (Proposal B placeholder)' };
  }
  if (p.id === 'ORDER_ENTRY') {
    return { ...p, start: '15:15:00', end: '15:25:00', description: '[SIM] Earlier order entry (Proposal B placeholder)' };
  }
  if (p.id === 'LIMIT_ONLY') {
    return { ...p, start: '15:25:00', end: '15:30:00', description: '[SIM] Limit-only (Proposal B placeholder)' };
  }
  if (p.id === 'MATCHING') {
    return { ...p, start: '15:30:00', end: '15:40:00', description: '[SIM] Longer matching (Proposal B placeholder)' };
  }
  if (p.id === 'CAS_COMPLETE') {
    return { ...p, start: '15:40:00', end: '15:45:00', description: '[SIM] CAS complete (Proposal B placeholder)' };
  }
  if (p.id === 'POST_CAS_FO') {
    return { ...p, start: '15:45:00', end: '15:50:00', description: '[SIM] Post-CAS F&O (Proposal B placeholder)' };
  }
  return { ...p, description: `[SIM] ${p.description}` };
});

export const CAS_CONFIG: Record<CasMode, CasModeConfig> = {
  CURRENT_NSE: {
    mode: 'CURRENT_NSE',
    displayName: 'CURRENT NSE',
    isSimulation: false,
    sourceNote:
      'Reference timings based on currently applicable NSE Closing Auction Session framework. Update CAS_CONFIG when NSE revises the schedule. Equity derivatives typically continue until 15:40 IST.',
    cashContinuousEnd: '15:30:00',
    derivativesContinuousEnd: '15:40:00',
    referenceWindow: { start: '15:00:00', end: '15:15:00' },
    phases: CURRENT_NSE_PHASES,
  },
  SEBI_PROPOSAL_A: {
    mode: 'SEBI_PROPOSAL_A',
    displayName: 'SEBI PROPOSAL A — SIMULATION',
    isSimulation: true,
    sourceNote:
      'SIMULATION ONLY. Placeholder mapping of SEBI consultation Proposal A. Not live NSE rules unless explicitly confirmed by exchange circular.',
    cashContinuousEnd: '15:30:00',
    derivativesContinuousEnd: '15:40:00',
    referenceWindow: { start: '15:00:00', end: '15:20:00' },
    phases: SEBI_PROPOSAL_A_PHASES,
  },
  SEBI_PROPOSAL_B: {
    mode: 'SEBI_PROPOSAL_B',
    displayName: 'SEBI PROPOSAL B — SIMULATION',
    isSimulation: true,
    sourceNote:
      'SIMULATION ONLY. Placeholder mapping of SEBI consultation Proposal B. Not live NSE rules unless explicitly confirmed by exchange circular.',
    cashContinuousEnd: '15:30:00',
    derivativesContinuousEnd: '15:40:00',
    referenceWindow: { start: '15:00:00', end: '15:10:00' },
    phases: SEBI_PROPOSAL_B_PHASES,
  },
};

export const DEFAULT_CAS_MODE: CasMode = 'CURRENT_NSE';

export function parseIstHmsToSeconds(hms: string): number {
  const [h, m, s] = hms.split(':').map((x) => Number(x));
  return h * 3600 + m * 60 + (s || 0);
}

/** Convert a Date (UTC instant) to IST wall-clock seconds since midnight. */
export function istSecondsSinceMidnight(now: Date = new Date()): number {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return get('hour') * 3600 + get('minute') * 60 + get('second');
}

export function resolveCasPhase(
  mode: CasMode,
  now: Date = new Date(),
): { config: CasModeConfig; phase: CasPhaseDef } {
  const config = CAS_CONFIG[mode];
  const sec = istSecondsSinceMidnight(now);
  for (const phase of config.phases) {
    const start = parseIstHmsToSeconds(phase.start);
    const end = parseIstHmsToSeconds(phase.end);
    if (sec >= start && sec < end) {
      return { config, phase };
    }
  }
  // Fallback closed
  const closed: CasPhaseDef = {
    id: 'CLOSED',
    label: 'Closed',
    start: '00:00:00',
    end: '00:00:00',
    lockDirectionalSignals: true,
    settlementOnly: false,
    description: 'Outside defined phases',
  };
  return { config, phase: closed };
}

export function formatIstTime(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(now);
}

export function formatIstDate(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
