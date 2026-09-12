'use strict';

/**
 * Canonical index underlyings for F&O terminal.
 * `id` is the internal symbol used by service/ticker; `symbol` alias kept for providers.
 */
const INDEX_UNDERLYINGS = [
  {
    id: 'NIFTY',
    symbol: 'NIFTY',
    label: 'NIFTY',
    nseName: 'NIFTY 50',
    yahoo: '^NSEI',
    dhanScrip: 13,
    dhanSeg: 'IDX_I',
  },
  {
    id: 'BANKNIFTY',
    symbol: 'BANKNIFTY',
    label: 'BANKNIFTY',
    nseName: 'NIFTY BANK',
    yahoo: '^NSEBANK',
    dhanScrip: 25,
    dhanSeg: 'IDX_I',
  },
  {
    id: 'FINNIFTY',
    symbol: 'FINNIFTY',
    label: 'FINNIFTY',
    nseName: 'NIFTY FIN SERVICE',
    nseAliases: ['NIFTY FIN SERVICE', 'NIFTY FINANCIAL SERVICES'],
    yahoo: null,
    dhanScrip: 27,
    dhanSeg: 'IDX_I',
  },
  {
    id: 'MIDCPNIFTY',
    symbol: 'MIDCPNIFTY',
    label: 'MIDCPNIFTY',
    nseName: 'NIFTY MID SELECT',
    nseAliases: ['NIFTY MID SELECT', 'NIFTY MIDCAP SELECT', 'NIFTY MIDCAP 50'],
    yahoo: null,
    dhanScrip: 442,
    dhanSeg: 'IDX_I',
  },
  {
    id: 'SENSEX',
    symbol: 'SENSEX',
    label: 'SENSEX',
    nseName: 'SENSEX',
    nseAliases: ['SENSEX', 'BSE SENSEX'],
    yahoo: '^BSESN',
    dhanScrip: 51,
    dhanSeg: 'BSE_I',
  },
  {
    id: 'INDIAVIX',
    symbol: 'INDIA VIX',
    label: 'INDIA VIX',
    nseName: 'INDIA VIX',
    yahoo: '^INDIAVIX',
    dhanScrip: null,
    dhanSeg: null,
  },
];

/** Default ticker strip order (service.js). */
const TICKER_ORDER = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY', 'INDIAVIX'];

/** Default list including display aliases used by mock/NSE providers. */
const DEFAULT_INDEX_TICKERS = [
  'NIFTY',
  'BANKNIFTY',
  'FINNIFTY',
  'MIDCPNIFTY',
  'INDIA VIX',
  'INDIAVIX',
  'SENSEX',
];

module.exports = {
  INDEX_UNDERLYINGS,
  TICKER_ORDER,
  DEFAULT_INDEX_TICKERS,
};
