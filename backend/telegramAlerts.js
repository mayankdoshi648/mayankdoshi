const TELEGRAM_API = 'https://api.telegram.org/bot';

function isTelegramConfigured(config) {
  return Boolean(config?.telegramBotToken && config?.telegramChatId);
}

function shouldAlert(item, config) {
  const minScore = config?.telegramMinScore ?? 85;
  if (item.strengthScore >= minScore) return true;
  if (item.stage === 'SUPER_TREND') return true;
  if (item.stage === 'BREAKOUT' && item.strengthScore >= (config?.telegramBreakoutMinScore ?? 70)) return true;
  return false;
}

function formatAlertMessage(scanDate, items) {
  const lines = [`🔥 *DarvaX Alert* — ${scanDate}`, ''];
  for (const item of items.slice(0, 15)) {
    const box = item.box?.top && item.box?.bottom
      ? `${item.box.top.toFixed(0)}/${item.box.bottom.toFixed(0)}`
      : '—';
    const fund = item.fundamentals;
    const fundLine = fund
      ? `ROCE ${fund.roce ?? '—'}% | Sales TTM ${fund.salesGrowthTtm ?? '—'}% | Profit TTM ${fund.profitGrowthTtm ?? '—'}%`
      : '';
    lines.push(
      `*${item.symbol}* (${item.market}) — ${item.stage}`,
      `Score ${item.strengthScore} ${item.tier || ''} | Box ${box} | RVOL ${item.rvol?.toFixed(1) ?? '—'}×`,
    );
    if (fundLine) lines.push(fundLine);
    const topReasons = (item.reasonsPass || []).slice(0, 3).map((r) => r.replace(/^✓\s*/, ''));
    if (topReasons.length) lines.push(topReasons.join(' · '));
    lines.push('');
  }
  if (items.length > 15) lines.push(`_+${items.length - 15} more in dashboard/Obsidian_`);
  return lines.join('\n');
}

async function sendTelegramMessage({ botToken, chatId, text, parseMode = 'Markdown' }, fetchImpl = fetch) {
  const url = `${TELEGRAM_API}${botToken}/sendMessage`;
  const resp = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: parseMode,
      disable_web_page_preview: true,
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`Telegram send failed HTTP ${resp.status}: ${body.slice(0, 200)}`);
  }
  return resp.json();
}

async function sendDarvaXAlerts({ scanDate, nseResults = [], usResults = [], config, fetchImpl = fetch }) {
  if (!isTelegramConfigured(config)) {
    return { sent: false, reason: 'Telegram not configured' };
  }

  const all = [...nseResults, ...usResults];
  const alertItems = all.filter((item) => shouldAlert(item, config)).sort((a, b) => b.strengthScore - a.strengthScore);

  if (!alertItems.length) {
    return { sent: false, reason: 'No stocks met alert criteria', count: 0 };
  }

  const text = formatAlertMessage(scanDate, alertItems);
  await sendTelegramMessage({
    botToken: config.telegramBotToken,
    chatId: config.telegramChatId,
    text,
  }, fetchImpl);

  return { sent: true, count: alertItems.length, symbols: alertItems.map((i) => i.symbol) };
}

module.exports = {
  isTelegramConfigured,
  shouldAlert,
  formatAlertMessage,
  sendTelegramMessage,
  sendDarvaXAlerts,
};
