// backend/config.js
require('dotenv').config();

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
    port: Number(process.env.PORT || 3000),
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
}

function loadConfigOptional() {
  try {
    return loadConfig();
  } catch {
    return {
      port: Number(process.env.PORT || 3000),
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
    };
  }
}

module.exports = { loadConfig, loadConfigOptional };
