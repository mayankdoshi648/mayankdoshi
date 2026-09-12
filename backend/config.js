// backend/config.js
require('dotenv').config();

function hasLoginCredentials(cfg) {
  return Boolean(cfg?.clientId && cfg?.pin && cfg?.totpSecret);
}

function hasStaticAccessToken(cfg) {
  return Boolean(cfg?.clientId && cfg?.accessToken);
}

function hasDhanCredentials(cfg) {
  return hasStaticAccessToken(cfg) || hasLoginCredentials(cfg);
}

function buildConfig({ requireDhan = true } = {}) {
  const cfg = {
    clientId: process.env.DHAN_CLIENT_ID || '',
    pin: process.env.DHAN_PIN || '',
    totpSecret: process.env.DHAN_TOTP_SECRET || '',
    accessToken: process.env.DHAN_ACCESS_TOKEN || '',
    accessTokenExpiry: process.env.DHAN_ACCESS_TOKEN_EXPIRY || '',
    port: Number(process.env.PORT || 3000),
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
  };
  cfg.hasDhan = hasDhanCredentials(cfg);

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
  baseConfig,
};
