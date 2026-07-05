// backend/marketWindow.js
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const OPEN_MINUTES = 9 * 60 + 30;
const CLOSE_MINUTES = 15 * 60 + 30;

function isMarketOpen(date = new Date()) {
  const ist = new Date(date.getTime() + IST_OFFSET_MS);
  const day = ist.getUTCDay();
  if (day === 0 || day === 6) return false;
  const totalMinutes = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  return totalMinutes >= OPEN_MINUTES && totalMinutes <= CLOSE_MINUTES;
}

module.exports = { isMarketOpen, IST_OFFSET_MS };
