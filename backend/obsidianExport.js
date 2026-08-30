const fs = require('node:fs');
const path = require('node:path');

function sanitizeFilename(name) {
  return String(name).replace(/[^\w.-]/g, '_');
}

function formatReasonsList(reasonsPass = [], reasonsFail = []) {
  const lines = [];
  for (const r of reasonsPass) lines.push(`- [x] ${r.replace(/^✓\s*/, '').replace(/^~\s*/, '')}`);
  for (const r of reasonsFail) lines.push(`- [ ] ${r.replace(/^✗\s*/, '')} *(failed)*`);
  return lines.join('\n');
}

function renderStockNote(item, scanDate) {
  const boxTop = item.box?.top?.toFixed(2) ?? '—';
  const boxBottom = item.box?.bottom?.toFixed(2) ?? '—';
  const stops = item.levels?.stops;
  const patterns = Object.keys(item.patterns || {}).filter((k) => item.patterns[k] === true || typeof item.patterns[k] === 'string');

  return `---
symbol: ${item.symbol}
market: ${item.market}
date: ${scanDate}
strength_score: ${item.strengthScore}
tier: ${item.tier || 'Skip'}
stage: ${item.stage || 'UNKNOWN'}
box_top: ${item.box?.top ?? ''}
box_bottom: ${item.box?.bottom ?? ''}
pct_from_52w_high: ${item.pctFrom52wHigh ?? ''}
rvol: ${item.rvol ?? ''}
rs_percentile: ${item.rsPercentile ?? ''}
status: candidate
tags: [darvax, ${item.market.toLowerCase()}]
---

# ${item.symbol} — DarvaX Candidate (${scanDate})

## Score & Stage
- **Strength:** ${item.strengthScore}/100 (${item.tier || '—'})
- **Stage:** ${item.stage || '—'}
- **Close:** ${item.close?.toFixed(2) ?? '—'}

## Box Levels
| Level | Price |
|-------|-------|
| Box Top | ${boxTop} |
| Box Bottom | ${boxBottom} |
| Entry | ${item.levels?.entry?.toFixed(2) ?? boxTop} |
| Primary Stop | ${stops?.primary?.toFixed(2) ?? '—'} (${stops?.primaryKey ?? ''}) |
| Box Stop | ${stops?.box_bottom?.toFixed(2) ?? '—'} |
| 10% Stop | ${stops?.pct_10?.toFixed(2) ?? '—'} |
| EMA Stop | ${stops?.ema?.toFixed(2) ?? '—'} |

## Why It Qualifies
${formatReasonsList(item.reasonsPass, item.reasonsFail)}

## Patterns Detected
${patterns.length ? patterns.map((p) => `- ${p}`).join('\n') : '- None'}

## Fundamentals (Screener.in)
${item.fundamentals ? `
| Metric | Value |
|--------|-------|
| ROCE | ${item.fundamentals.roce ?? '—'}% |
| ROE | ${item.fundamentals.roe ?? '—'}% |
| Sales TTM | ${item.fundamentals.salesGrowthTtm ?? '—'}% |
| Profit TTM | ${item.fundamentals.profitGrowthTtm ?? '—'}% |
| Qtr Profit Var | ${item.fundamentals.qtrProfitVar?.toFixed(0) ?? '—'}% |
` : '- Not fetched'}
- **Entry:** above ${boxTop} on confirmed breakout
- **Stop:** ${stops?.primary?.toFixed(2) ?? boxBottom} (${stops?.primaryKey ?? 'box_bottom'})
- **Risk/share:** ${stops?.riskPerShare?.toFixed(2) ?? '—'}

## Links
- [[${scanDate}]] daily scan
`;
}

function renderDailyWatchlist(scanDate, results, market) {
  const qualified = results.filter((r) => r.qualifies || r.strengthScore >= 55);
  const rows = qualified.map((r) => {
    const box = r.box?.top && r.box?.bottom
      ? `${r.box.top.toFixed(0)}/${r.box.bottom.toFixed(0)}`
      : '—';
    return `| [[${scanDate}-${r.market}-${r.symbol}]] | ${r.market} | ${r.strengthScore} | ${r.tier || '—'} | ${r.stage || '—'} | ${box} | ${r.rsPercentile?.toFixed(0) ?? '—'} | ${r.rvol?.toFixed(1) ?? '—'} |`;
  }).join('\n');

  return `---
date: ${scanDate}
market: ${market || 'ALL'}
type: darvax-watchlist
tags: [darvax, watchlist, daily-scan]
---

# DarvaX Scan — ${scanDate}${market ? ` (${market})` : ''}

> Auto-exported from PowerBull Pro DarvaX scanner.

## Summary
- **Total scanned:** ${results.length}
- **Qualified (≥55):** ${qualified.length}
- **A+ (≥85):** ${results.filter((r) => r.strengthScore >= 85).length}
- **Breakouts:** ${results.filter((r) => r.stage === 'BREAKOUT' || r.stage === 'SUPER_TREND').length}

## Top Candidates

| Stock | Mkt | Score | Tier | Stage | Box T/B | RS% | RVOL |
|-------|-----|-------|------|-------|---------|-----|------|
${rows || '| — | — | — | — | — | — | — | — |'}

## Quick Filters (Dataview)

\`\`\`dataview
TABLE strength_score, stage, box_top, box_bottom
FROM "03-Watchlists/stocks"
WHERE date = date("${scanDate}")
SORT strength_score DESC
\`\`\`
`;
}

function exportToObsidian({ vaultPath, scanDate, nseResults = [], usResults = [], minScore = 55 }) {
  if (!vaultPath) throw new Error('OBSIDIAN_VAULT_PATH is required for export');

  const watchDir = path.join(vaultPath, '03-Watchlists');
  const stocksDir = path.join(watchDir, 'stocks');
  fs.mkdirSync(stocksDir, { recursive: true });

  const allResults = [...nseResults, ...usResults];
  const qualified = allResults.filter((r) => r.strengthScore >= minScore);

  const dailyPath = path.join(watchDir, `${scanDate}.md`);
  fs.writeFileSync(dailyPath, renderDailyWatchlist(scanDate, allResults));

  const nseDailyPath = path.join(watchDir, `${scanDate}-NSE.md`);
  fs.writeFileSync(nseDailyPath, renderDailyWatchlist(scanDate, nseResults, 'NSE'));

  const usDailyPath = path.join(watchDir, `${scanDate}-US.md`);
  fs.writeFileSync(usDailyPath, renderDailyWatchlist(scanDate, usResults, 'US'));

  const stockPaths = [];
  for (const item of qualified) {
    const fname = `${scanDate}-${item.market}-${sanitizeFilename(item.symbol)}.md`;
    const stockPath = path.join(stocksDir, fname);
    fs.writeFileSync(stockPath, renderStockNote(item, scanDate));
    stockPaths.push(stockPath);
  }

  return {
    dailyPath,
    nseDailyPath,
    usDailyPath,
    stockPaths,
    exportedCount: qualified.length,
  };
}

function exportFromDb(db, { vaultPath, scanDate, minScore = 55, getDarvaxScans }) {
  const date = scanDate || new Date().toISOString().slice(0, 10);
  const nseResults = getDarvaxScans(db, { scanDate: date, market: 'NSE', minScore: 0 });
  const usResults = getDarvaxScans(db, { scanDate: date, market: 'US', minScore: 0 });
  return exportToObsidian({ vaultPath, scanDate: date, nseResults, usResults, minScore });
}

module.exports = {
  exportToObsidian,
  exportFromDb,
  renderStockNote,
  renderDailyWatchlist,
};
