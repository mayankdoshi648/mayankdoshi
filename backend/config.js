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
  };
}

module.exports = { loadConfig };
