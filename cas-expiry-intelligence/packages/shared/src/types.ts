/** Shared domain types — single source of truth for API + web + engines */

export type HealthStatus = 'LIVE' | 'STALE' | 'UNAVAILABLE';
export type DataSource = 'DHAN' | 'NSE' | 'DERIVED' | 'UNAVAILABLE';

export type MarketDirectionState =
  | 'TREND UP'
  | 'TREND DOWN'
  | 'RANGE / PIN'
  | 'BREAKOUT RISK'
  | 'HIGH VOLATILITY'
  | 'NO EDGE';

export type CasSettlementState =
  | 'UPWARD SETTLEMENT PRESSURE'
  | 'DOWNWARD SETTLEMENT PRESSURE'
  | 'PINNING / MAGNET'
  | 'BREAKOUT / DISLOCATION RISK'
  | 'HIGH UNCERTAINTY';

export type CasRiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';
export type WallStatus = 'BUILDING' | 'HOLDING' | 'WEAKENING' | 'BREAKING' | 'UNAVAILABLE';

export interface TimedValue<T = number> {
  value: T | null;
  timestamp: string | null;
  source: DataSource;
  health: HealthStatus;
  ageMs: number | null;
}

export interface InstrumentDef {
  id: string;
  symbol: string;
  displayName: string;
  spotSecurityId: string;
  spotSegment: string;
  futuresUnderlying: string;
  futuresSegment: string;
  /** Optional static override; monthly IDs usually come from Settings. */
  futuresSecurityId?: string | null;
  optionUnderlying: string;
  optionSegment: string;
  lotSize: number;
  strikeInterval: number;
  enabled: boolean;
}

export interface AlignmentReport {
  aligned: boolean;
  spotTimestamp: string | null;
  futuresTimestamp: string | null;
  optionChainTimestamp: string | null;
  casTimestamp: string | null;
  maxSkewMs: number;
  thresholdMs: number;
  message: string | null;
}

export interface FactorContribution {
  name: string;
  weight: number;
  rawValue: number | string | null;
  score: number;
  note: string;
  available: boolean;
}

export interface SettlementZoneResult {
  lower: number | null;
  central: number | null;
  upper: number | null;
  factors: FactorContribution[];
  confidence: number;
  explanation: string[];
  unavailableReason?: string;
}

export interface MarketStateResult {
  state: MarketDirectionState;
  confidence: number;
  factors: FactorContribution[];
  explanation: string[];
}

export interface CasIntelligenceResult {
  score: number;
  state: CasSettlementState;
  confidence: number;
  factors: FactorContribution[];
  explanation: string[];
  lockedDirectional: boolean;
}

export interface SignalScoreResult {
  score: number | null;
  label: string;
  locked: boolean;
  lockReason?: string;
  factors: FactorContribution[];
  explanation: string[];
}

export interface CasRiskResult {
  level: CasRiskLevel;
  score: number;
  factors: string[];
  explanation: string[];
}

export interface OptionSide {
  oi: number | null;
  oiChange: number | null;
  volume: number | null;
  iv: number | null;
  ltp: number | null;
  bid: number | null;
  ask: number | null;
}

export interface OptionStrikeRow {
  strike: number;
  call: OptionSide;
  put: OptionSide;
}

export interface OptionWalls {
  callWall: number | null;
  putWall: number | null;
  callWallStatus: WallStatus;
  putWallStatus: WallStatus;
  callDistance: number | null;
  putDistance: number | null;
}

export interface Candle {
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}
