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

function loadConfig() {
  const required = ['DHAN_CLIENT_ID', 'DHAN_PIN', 'DHAN_TOTP_SECRET'];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required env vars: ${missing.join(', ')}. Copy .env.example to .env and fill it in.`);
  }
  return {
    clientId: process.env.DHAN_CLIENT_ID,
    pin: process.env.DHAN_PIN,
    totpSecret: process.env.DHAN_TOTP_SECRET,
    port: Number(process.env.PORT || 3002),
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
}

function loadConfigOptional() {
  try {
    return loadConfig();
  } catch {
    return {
      port: Number(process.env.PORT || 3002),
      darvaxAutoTrade: false,
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
  }
}

module.exports = { loadConfig, loadConfigOptional };
