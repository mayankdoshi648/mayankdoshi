import type { InstrumentDef } from './types.js';

/**
 * Instrument registry — extensible for FINNIFTY, MIDCPNIFTY, SENSEX, BANKEX, stocks.
 * Dhan IDX_I security IDs: NIFTY=13, BANKNIFTY=25
 */
export const INSTRUMENTS: InstrumentDef[] = [
  {
    id: 'NIFTY',
    symbol: 'NIFTY',
    displayName: 'NIFTY 50',
    spotSecurityId: '13',
    spotSegment: 'IDX_I',
    futuresUnderlying: 'NIFTY',
    futuresSegment: 'NSE_FNO',
    optionUnderlying: 'NIFTY',
    optionSegment: 'NSE_FNO',
    lotSize: 65,
    strikeInterval: 50,
    enabled: true,
  },
  {
    id: 'BANKNIFTY',
    symbol: 'BANKNIFTY',
    displayName: 'NIFTY BANK',
    spotSecurityId: '25',
    spotSegment: 'IDX_I',
    futuresUnderlying: 'BANKNIFTY',
    futuresSegment: 'NSE_FNO',
    optionUnderlying: 'BANKNIFTY',
    optionSegment: 'NSE_FNO',
    lotSize: 30,
    strikeInterval: 100,
    enabled: true,
  },
  {
    id: 'FINNIFTY',
    symbol: 'FINNIFTY',
    displayName: 'FINNIFTY',
    spotSecurityId: '27',
    spotSegment: 'IDX_I',
    futuresUnderlying: 'FINNIFTY',
    futuresSegment: 'NSE_FNO',
    optionUnderlying: 'FINNIFTY',
    optionSegment: 'NSE_FNO',
    lotSize: 60,
    strikeInterval: 50,
    enabled: false,
  },
  {
    id: 'MIDCPNIFTY',
    symbol: 'MIDCPNIFTY',
    displayName: 'MIDCPNIFTY',
    spotSecurityId: '442',
    spotSegment: 'IDX_I',
    futuresUnderlying: 'MIDCPNIFTY',
    futuresSegment: 'NSE_FNO',
    optionUnderlying: 'MIDCPNIFTY',
    optionSegment: 'NSE_FNO',
    lotSize: 120,
    strikeInterval: 25,
    enabled: false,
  },
];

export function getInstrument(id: string): InstrumentDef | undefined {
  return INSTRUMENTS.find((i) => i.id === id.toUpperCase());
}

export function enabledInstruments(): InstrumentDef[] {
  return INSTRUMENTS.filter((i) => i.enabled);
}
