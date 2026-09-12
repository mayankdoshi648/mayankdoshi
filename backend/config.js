// backend/config.js
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

function envAny(names, fallback = '') {
  for (const name of names) {
    const v = process.env[name];
    if (v != null && String(v).trim() !== '') return String(v).trim();
  }
  return fallback;
}

function kotakEnv() {
  return {
    kotakNeoConsumerKey: envAny([
      'KOTAK_NEO_CONSUMER_KEY',
      'KOTAK_CONSUMER_KEY',
      'NEO_CONSUMER_KEY',
      'CONSUMER_KEY',
    ]),
    kotakNeoMobile: envAny(['KOTAK_NEO_MOBILE', 'KOTAK_MOBILE', 'MOBILE_NUMBER']),
    kotakNeoUcc: envAny(['KOTAK_NEO_UCC', 'KOTAK_UCC', 'UCC']),
    kotakNeoMpin: envAny(['KOTAK_NEO_MPIN', 'KOTAK_MPIN', 'MPIN']),
    kotakNeoTotpSecret: envAny(['KOTAK_NEO_TOTP_SECRET', 'KOTAK_TOTP_SECRET', 'TOTP_SECRET']),
  };
}

function hasLoginCredentials(cfg) {
  return Boolean(cfg?.clientId && cfg?.pin && cfg?.totpSecret);
}

function hasStaticAccessToken(cfg) {
  return Boolean(cfg?.clientId && cfg?.accessToken);
}

function hasDhanCredentials(cfg) {
  return hasStaticAccessToken(cfg) || hasLoginCredentials(cfg);
}

function hasKotakNeoCredentials(cfg) {
  return Boolean(cfg?.kotakNeoConsumerKey);
}

function buildConfig({ requireDhan = true } = {}) {
  const cfg = {
    clientId: process.env.DHAN_CLIENT_ID || '',
    pin: process.env.DHAN_PIN || '',
    totpSecret: process.env.DHAN_TOTP_SECRET || '',
    accessToken: process.env.DHAN_ACCESS_TOKEN || '',
    accessTokenExpiry: process.env.DHAN_ACCESS_TOKEN_EXPIRY || '',
    // Market Breadth primary listen (dual-app). Override with PORT=.
    port: Number(process.env.PORT || 3002),
    // Original PowerBull Pro listen port.
    powerbullPort: Number(process.env.POWERBULL_PORT || 3000),
    forceDemo: process.env.DEMO_MODE === 'true',
    darvaxAutoTrade: process.env.DARVAX_AUTO_TRADE === 'true',
    darvaxRiskPct: Number(process.env.DARVAX_RISK_PCT || 1),
    darvaxCapital: Number(process.env.DARVAX_CAPITAL || 1000000),
    darvaxMinScore: Number(process.env.DARVAX_MIN_SCORE || 70),
    darvaxStyle: process.env.DARVAX_STYLE || 'swing',
    obsidianVaultPath: process.env.OBSIDIAN_VAULT_PATH || '',
    obsidianMinScore: Number(process.env.OBSIDIAN_MIN_SCORE || 55),
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
    telegramChatId: process.env.TELEGRAM_CHAT_ID || '',
    telegramMinScore: Number(process.env.TELEGRAM_MIN_SCORE || 85),
    telegramBreakoutMinScore: Number(process.env.TELEGRAM_BREAKOUT_MIN_SCORE || 70),
    fundamentalsMaxFetch: Number(process.env.FUNDAMENTALS_MAX_FETCH || 30),
    ...kotakEnv(),
  };
  cfg.hasDhan = hasDhanCredentials(cfg);
  cfg.hasKotakNeo = hasKotakNeoCredentials(cfg);

  if (requireDhan && !cfg.hasDhan) {
    throw new Error(
      'Missing Dhan credentials. Set DHAN_CLIENT_ID + DHAN_ACCESS_TOKEN, or DHAN_CLIENT_ID + DHAN_PIN + DHAN_TOTP_SECRET.'
    );
  }
  return cfg;
}

function loadConfig() {
  try {
    return buildConfig({ requireDhan: true });
  } catch {
    return buildConfig({ requireDhan: false });
  }
}

function loadConfigOptional() {
  return buildConfig({ requireDhan: false });
}

function baseConfig() {
  return buildConfig({ requireDhan: false });
}

module.exports = {
  loadConfig,
  loadConfigOptional,
  buildConfig,
  hasDhanCredentials,
  hasLoginCredentials,
  hasStaticAccessToken,
  hasKotakNeoCredentials,
  baseConfig,
};
