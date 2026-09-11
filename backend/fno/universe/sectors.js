'use strict';

/**
 * Major Indian sectors → representative liquid F&O equity symbols (~40–80 names).
 */
const SECTOR_MAP = {
  BANKING: [
    'HDFCBANK', 'ICICIBANK', 'KOTAKBANK', 'AXISBANK', 'SBIN',
    'INDUSINDBK', 'BANDHANBNK', 'FEDERALBNK', 'IDFCFIRSTB',
  ],
  'PSU BANK': ['SBIN', 'BANKBARODA', 'PNB', 'CANBK', 'UNIONBANK'],
  'PRIVATE BANK': ['HDFCBANK', 'ICICIBANK', 'KOTAKBANK', 'AXISBANK', 'INDUSINDBK'],
  'FINANCIAL SERVICES': [
    'BAJFINANCE', 'BAJAJFINSV', 'HDFCLIFE', 'SBILIFE', 'ICICIPRULI',
    'PFC', 'RECLTD', 'CHOLAFIN', 'MUTHOOTFIN', 'LICHSGFIN',
  ],
  IT: ['TCS', 'INFY', 'HCLTECH', 'TECHM', 'WIPRO', 'LTIM', 'PERSISTENT', 'COFORGE', 'MPHASIS'],
  AUTO: [
    'MARUTI', 'TATAMOTORS', 'M&M', 'BAJAJ-AUTO', 'HEROMOTOCO',
    'EICHERMOT', 'TVSMOTOR', 'ASHOKLEY', 'BHARATFORG',
  ],
  PHARMA: [
    'SUNPHARMA', 'DRREDDY', 'CIPLA', 'DIVISLAB', 'AUROPHARMA',
    'LUPIN', 'TORNTPHARM', 'BIOCON', 'ALKEM',
  ],
  FMCG: [
    'HINDUNILVR', 'ITC', 'NESTLEIND', 'BRITANNIA', 'DABUR',
    'MARICO', 'GODREJCP', 'COLPAL', 'TATACONSUM',
  ],
  METALS: [
    'TATASTEEL', 'JSWSTEEL', 'HINDALCO', 'VEDL', 'NATIONALUM',
    'SAIL', 'JINDALSTEL', 'NMDC',
  ],
  ENERGY: [
    'RELIANCE', 'ONGC', 'NTPC', 'POWERGRID', 'BPCL',
    'IOC', 'GAIL', 'TATAPOWER', 'ADANIGREEN',
  ],
  REALTY: ['DLF', 'GODREJPROP', 'OBEROIRLTY', 'PRESTIGE', 'BRIGADE', 'PHOENIXLTD'],
  'CONSUMER DURABLES': ['TITAN', 'HAVELLS', 'VOLTAS', 'CROMPTON', 'DIXON', 'WHIRLPOOL'],
  MEDIA: ['ZEEL', 'SUNTV', 'PVRINOX'],
  INFRA: ['LT', 'ADANIPORTS', 'SIEMENS', 'ABB', 'ULTRACEMCO', 'AMBUJACEM', 'GRASIM'],
  CEMENT: ['ULTRACEMCO', 'AMBUJACEM', 'SHREECEM', 'DALBHARAT', 'ACC'],
  TELECOM: ['BHARTIARTL', 'INDUSTOWER', 'IDEA'],
  CHEMICALS: ['PIDILITIND', 'SRF', 'AARTIIND', 'DEEPAKNTR', 'UPL'],
};

/** Alias expected by mock provider / scanners. */
const SECTOR_FO_SYMBOLS = SECTOR_MAP;

function sectorForSymbol(symbol) {
  const key = String(symbol || '').toUpperCase();
  for (const [sector, symbols] of Object.entries(SECTOR_MAP)) {
    if (symbols.includes(key)) return sector;
  }
  return 'OTHER';
}

function allFoSymbols() {
  const set = new Set();
  for (const symbols of Object.values(SECTOR_MAP)) {
    for (const s of symbols) set.add(s);
  }
  return [...set].sort();
}

const ALL_SECTOR_FO_SYMBOLS = allFoSymbols();

const SYMBOL_TO_SECTOR = {};
for (const [sector, symbols] of Object.entries(SECTOR_MAP)) {
  for (const sym of symbols) {
    if (!SYMBOL_TO_SECTOR[sym]) SYMBOL_TO_SECTOR[sym] = sector;
  }
}

module.exports = {
  SECTOR_MAP,
  SECTOR_FO_SYMBOLS,
  ALL_SECTOR_FO_SYMBOLS,
  SYMBOL_TO_SECTOR,
  sectorForSymbol,
  allFoSymbols,
};
