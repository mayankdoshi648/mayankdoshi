// frontend/app.js
const state = {
  signals: [],
  date: new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10),
  markets: {
    universe: 'nifty50',
    sector: 'all',
    ranking: 'all',
    rows: [],
    sectors: [],
    loading: false,
  },
};

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
}

function formatNumber(n, digits = 2) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return Number(n).toLocaleString('en-IN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatVolume(n) {
  if (n == null) return '—';
  const v = Number(n);
  if (v >= 1e7) return `${(v / 1e7).toFixed(2)} Cr`;
  if (v >= 1e5) return `${(v / 1e5).toFixed(2)} L`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)} K`;
  return String(v);
}

function showErrorToast(message) {
  const el = document.getElementById('error-toast');
  if (!message) {
    el.classList.add('hidden');
    el.textContent = '';
    return;
  }
  el.textContent = message;
  el.classList.remove('hidden');
}

function updateAuthChip(auth, dashboardMode) {
  const chip = document.getElementById('auth-chip');
  const mode = auth?.mode || dashboardMode || 'demo';
  chip.classList.remove('mode-live', 'mode-demo', 'mode-error');
  if (mode === 'live' || auth?.authenticated) {
    chip.textContent = 'Dhan Live';
    chip.classList.add('mode-live');
  } else if (auth?.lastError && auth?.hasCredentials) {
    chip.textContent = 'Auth Error';
    chip.classList.add('mode-error');
  } else {
    chip.textContent = 'Demo';
    chip.classList.add('mode-demo');
  }
}

function updateCounters(signals) {
  document.getElementById('count-total').textContent = signals.length;
  document.getElementById('count-buy').textContent = signals.filter((s) => s.side === 'BUY').length;
  document.getElementById('count-sell').textContent = signals.filter((s) => s.side === 'SELL').length;
}

function renderSignalRow(signal) {
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td>${escapeHtml(signal.symbol)}</td>
    <td class="side-${signal.side.toLowerCase()}">${escapeHtml(signal.side)}</td>
    <td>${escapeHtml(signal.price)}</td>
    <td>${escapeHtml(new Date(signal.candle_time).toLocaleTimeString())}</td>
  `;
  tr.addEventListener('click', () => openChartModal(signal.symbol));
  return tr;
}

function renderTrackRow(signal) {
  const tr = document.createElement('tr');
  tr.dataset.id = signal.id;
  tr.innerHTML = `
    <td>${escapeHtml(signal.symbol)}</td>
    <td class="side-${signal.side.toLowerCase()}">${escapeHtml(signal.side)}</td>
    <td>${escapeHtml(signal.price)}</td>
    <td>${escapeHtml(new Date(signal.candle_time).toLocaleTimeString())}</td>
    <td class="outcome-cell">${escapeHtml(signal.outcome)}</td>
  `;
  return tr;
}

async function loadSignals(date) {
  try {
    const resp = await fetch(`/api/signals?date=${date}`);
    if (!resp.ok) throw new Error(`Signals HTTP ${resp.status}`);
    const signals = await resp.json();
    state.signals = signals;
    updateCounters(signals);

    const liveBody = document.getElementById('signal-rows');
    liveBody.innerHTML = '';
    signals.forEach((s) => liveBody.appendChild(renderSignalRow(s)));

    const trackBody = document.getElementById('track-rows');
    trackBody.innerHTML = '';
    signals.forEach((s) => trackBody.appendChild(renderTrackRow(s)));
  } catch (err) {
    showErrorToast(`Could not load signals: ${err.message}`);
  }
}

async function loadStatus() {
  try {
    const resp = await fetch('/api/status');
    if (!resp.ok) throw new Error(`Status HTTP ${resp.status}`);
    const status = await resp.json();
    updateAuthChip(status.auth, status.dashboardMode);
    const banner = document.getElementById('market-banner');
    if (status.dashboardMode === 'demo') {
      banner.textContent = status.auth?.lastError
        ? `Demo mode — ${status.auth.lastError}`
        : 'Demo mode — add DHAN_CLIENT_ID / DHAN_PIN / DHAN_TOTP_SECRET to .env for live Dhan quotes.';
      banner.classList.remove('hidden');
    } else if (!status.feedConnected && status.marketOpen) {
      banner.textContent = status.lastError
        ? `Dhan feed disconnected (${status.lastError}) — check credentials and restart.`
        : 'Dhan feed not connected — check DHAN credentials in .env and restart the server.';
      banner.classList.remove('hidden');
    } else if (!status.marketOpen) {
      banner.textContent = 'Market closed — Markets board still available via Dhan REST / demo.';
      banner.classList.remove('hidden');
    } else {
      banner.classList.add('hidden');
    }
  } catch (err) {
    showErrorToast(`Status check failed: ${err.message}`);
  }
}

function connectLiveSocket() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/live`);
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === 'signal') {
      state.signals.push(msg);
      updateCounters(state.signals);
      document.getElementById('signal-rows').appendChild(renderSignalRow(msg));
      document.getElementById('track-rows').appendChild(renderTrackRow(msg));
      playAlert(msg);
    } else if (msg.type === 'outcome') {
      const signal = state.signals.find((s) => String(s.id) === String(msg.id));
      if (signal) signal.outcome = msg.outcome;
      const row = document.querySelector(`#track-rows tr[data-id="${msg.id}"]`);
      const cell = row && row.querySelector('.outcome-cell');
      if (cell) cell.textContent = msg.outcome;
    }
  });
  ws.addEventListener('close', () => setTimeout(connectLiveSocket, 2000));
}

function playAlert(signal) {
  document.getElementById('alert-sound').play().catch(() => {});
  if (Notification.permission === 'granted') {
    new Notification(`${signal.side} ${signal.symbol}`, { body: `Price ${signal.price}` });
  }
}

function showView(name) {
  const views = {
    markets: 'view-markets',
    live: 'view-live',
    darvax: 'view-darvax',
    track: 'view-track',
  };
  const tabs = {
    markets: 'tab-markets',
    live: 'tab-live',
    darvax: 'tab-darvax',
    track: 'tab-track',
  };
  Object.values(views).forEach((id) => document.getElementById(id).classList.add('hidden'));
  Object.values(tabs).forEach((id) => document.getElementById(id).classList.remove('active'));
  document.getElementById(views[name]).classList.remove('hidden');
  document.getElementById(tabs[name]).classList.add('active');
  document.getElementById('counters').classList.toggle('hidden', name !== 'live' && name !== 'track');
  document.getElementById('date-picker').classList.toggle('hidden', name === 'markets');
}

document.getElementById('tab-markets').addEventListener('click', () => {
  showView('markets');
  loadMarkets();
});

document.getElementById('tab-live').addEventListener('click', () => {
  showView('live');
});

document.getElementById('tab-darvax').addEventListener('click', () => {
  showView('darvax');
  loadDarvaxScans();
  loadPendingOrders();
});

document.getElementById('tab-track').addEventListener('click', () => {
  showView('track');
});

document.getElementById('date-picker').value = state.date;
document.getElementById('date-picker').addEventListener('change', (e) => {
  state.date = e.target.value;
  loadSignals(state.date);
});

if (window.Notification && Notification.permission === 'default') {
  Notification.requestPermission();
}

// --- Markets dashboard ---
function changeClass(pct) {
  if (pct == null) return 'flat';
  if (pct > 0) return 'up';
  if (pct < 0) return 'down';
  return 'flat';
}

function renderSectorChips(sectors) {
  const host = document.getElementById('sector-chips');
  host.innerHTML = '';

  const allBtn = document.createElement('button');
  allBtn.type = 'button';
  allBtn.className = `sector-chip${state.markets.sector === 'all' ? ' active' : ''}`;
  allBtn.dataset.sector = 'all';
  allBtn.textContent = 'All sectors';
  allBtn.addEventListener('click', () => {
    state.markets.sector = 'all';
    loadMarkets();
  });
  host.appendChild(allBtn);

  sectors.forEach((s) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `sector-chip${state.markets.sector === s.sector ? ' active' : ''}`;
    btn.dataset.sector = s.sector;
    const cls = changeClass(s.avgChangePct);
    btn.innerHTML = `${escapeHtml(s.sectorShort || s.sector)}<span class="chip-meta ${cls}">${s.avgChangePct > 0 ? '+' : ''}${formatNumber(s.avgChangePct, 1)}%</span>`;
    btn.addEventListener('click', () => {
      state.markets.sector = s.sector;
      loadMarkets();
    });
    host.appendChild(btn);
  });
}

function renderStockRow(row) {
  const el = document.createElement('article');
  el.className = 'stock-row';
  const chgCls = changeClass(row.changePct);
  const chgSign = row.changePct > 0 ? '+' : '';
  const pos = Math.max(0, Math.min(100, row.rangePosition ?? 0));
  el.innerHTML = `
    <div class="stock-main">
      <div class="stock-symbol">${escapeHtml(row.symbol)}</div>
      <div class="stock-name">${escapeHtml(row.name || row.symbol)}</div>
      <span class="stock-sector">${escapeHtml(row.sectorShort || row.sector || '—')}</span>
    </div>
    <div class="stock-price">
      <div class="stock-ltp">${formatNumber(row.ltp)}</div>
      <div class="stock-chg ${chgCls}">${chgSign}${formatNumber(row.changePct)}%</div>
      <div class="stock-name">Vol ${formatVolume(row.volume)}</div>
    </div>
    <div class="stock-52" title="52-week range">
      <div class="range-track">
        <div class="range-fill" style="width:${pos}%"></div>
        <div class="range-marker" style="left:${pos}%"></div>
      </div>
      <div class="range-labels">
        <span>L ${formatNumber(row.low52)}</span>
        <span>${row.pctFromHigh == null ? '—' : `${formatNumber(row.pctFromHigh)}% vs H`}</span>
        <span>H ${formatNumber(row.high52)}</span>
      </div>
    </div>
  `;
  return el;
}

function renderMarketsList(rows) {
  const host = document.getElementById('markets-list');
  host.innerHTML = '';
  if (!rows.length) {
    host.innerHTML = '<div class="markets-empty">No stocks match this sector / ranking filter.</div>';
    return;
  }
  rows.forEach((row) => host.appendChild(renderStockRow(row)));
}

async function loadMarkets({ force = false } = {}) {
  if (state.markets.loading) return;
  state.markets.loading = true;
  const statusEl = document.getElementById('markets-status');
  const countEl = document.getElementById('markets-count');
  const refreshBtn = document.getElementById('markets-refresh');
  statusEl.textContent = force ? 'Refreshing from Dhan…' : 'Loading market board…';
  refreshBtn.disabled = true;
  showErrorToast('');

  try {
    const params = new URLSearchParams({
      universe: state.markets.universe,
      sector: state.markets.sector,
      ranking: state.markets.ranking,
      limit: '100',
    });
    if (force) params.set('refresh', '1');

    const resp = await fetch(`/api/dashboard?${params}`);
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);

    state.markets.rows = data.rows || [];
    state.markets.sectors = data.sectors || [];
    updateAuthChip(data.auth, data.mode);
    renderSectorChips(state.markets.sectors);
    renderMarketsList(state.markets.rows);

    const modeLabel = data.mode === 'demo' ? 'Demo' : 'Live';
    statusEl.textContent = `${modeLabel} · ${new Date(data.scannedAt).toLocaleTimeString()} · ${escapeHtml(data.ranking)}`;
    countEl.textContent = `${data.count} / ${data.totalInUniverse} stocks`;
    if (data.warning) {
      document.getElementById('market-banner').textContent = data.warning;
      document.getElementById('market-banner').classList.remove('hidden');
    }
  } catch (err) {
    statusEl.textContent = 'Failed to load';
    showErrorToast(`Markets error: ${err.message}`);
    document.getElementById('markets-list').innerHTML =
      `<div class="markets-empty">Could not load dashboard. ${escapeHtml(err.message)}</div>`;
  } finally {
    state.markets.loading = false;
    refreshBtn.disabled = false;
  }
}

document.querySelectorAll('.rank-chip').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.rank-chip').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    state.markets.ranking = btn.dataset.ranking;
    loadMarkets();
  });
});

document.getElementById('markets-universe').addEventListener('change', (e) => {
  state.markets.universe = e.target.value;
  state.markets.sector = 'all';
  loadMarkets({ force: true });
});

document.getElementById('markets-refresh').addEventListener('click', () => {
  loadMarkets({ force: true });
});

// --- Chart modal ---
let activeChart = null;

function formatCandleTime(epochMs) {
  const ist = new Date(epochMs + 5.5 * 60 * 60 * 1000);
  const hh = String(ist.getUTCHours()).padStart(2, '0');
  const mm = String(ist.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

async function openChartModal(symbol) {
  try {
    const resp = await fetch(`/api/candles/${symbol}`);
    if (!resp.ok) throw new Error(`Candles HTTP ${resp.status}`);
    const candles = await resp.json();
    const modal = document.getElementById('chart-modal');
    document.getElementById('chart-title').textContent = symbol;
    modal.classList.remove('hidden');

    const ohlc = candles.map((c) => ({ x: formatCandleTime(c.time), o: c.open, h: c.high, l: c.low, c: c.close }));
    const markers = state.signals
      .filter((s) => s.symbol === symbol)
      .map((s) => ({ x: formatCandleTime(new Date(s.candle_time).getTime()), y: s.price, side: s.side }));

    if (activeChart) activeChart.destroy();
    const ctx = document.getElementById('chart-canvas').getContext('2d');
    activeChart = new Chart(ctx, {
      type: 'candlestick',
      data: {
        datasets: [
          { label: symbol, data: ohlc },
          {
            type: 'scatter',
            label: 'Signals',
            data: markers.map((m) => ({ x: m.x, y: m.y })),
            pointBackgroundColor: markers.map((m) => (m.side === 'BUY' ? '#21c55d' : '#ef4444')),
            pointStyle: markers.map((m) => (m.side === 'BUY' ? 'triangle' : 'rectRot')),
            pointRadius: 6,
          },
        ],
      },
      options: {
        scales: { x: { type: 'category' } },
      },
    });
  } catch (err) {
    showErrorToast(`Chart error: ${err.message}`);
  }
}

document.getElementById('chart-close').addEventListener('click', () => {
  document.getElementById('chart-modal').classList.add('hidden');
});

// --- DarvaX Scanner ---
function tierClass(tier) {
  if (tier === 'A+') return 'tier-aplus';
  if (tier === 'A') return 'tier-a';
  return 'tier-b';
}

function renderDarvaxRow(item) {
  const tr = document.createElement('tr');
  tr.dataset.symbol = item.symbol;
  const boxTop = item.box?.top?.toFixed(2) ?? '—';
  const boxBottom = item.box?.bottom?.toFixed(2) ?? '—';
  const canOrder = item.market === 'NSE' && (item.stage === 'BREAKOUT' || item.stage === 'SUPER_TREND');
  tr.innerHTML = `
    <td><button class="expand-btn" aria-label="Expand">▶</button></td>
    <td>${escapeHtml(item.symbol)}</td>
    <td>${escapeHtml(item.market)}</td>
    <td class="${tierClass(item.tier)}">${escapeHtml(item.strengthScore)} ${escapeHtml(item.tier || '')}</td>
    <td class="stage-${(item.stage || '').toLowerCase()}">${escapeHtml(item.stage || '—')}</td>
    <td>${escapeHtml(boxTop)}</td>
    <td>${escapeHtml(boxBottom)}</td>
    <td>${item.rsPercentile != null ? escapeHtml(item.rsPercentile.toFixed(0)) : '—'}</td>
    <td>${item.rvol != null ? escapeHtml(item.rvol.toFixed(1)) : '—'}</td>
    <td>${canOrder ? '<button class="btn order-btn">Order</button>' : '—'}</td>
  `;

  const detailTr = document.createElement('tr');
  detailTr.classList.add('hidden');
  detailTr.innerHTML = `<td colspan="10"><div class="darvax-reasons">${formatReasons(item)}</div></td>`;

  tr.querySelector('.expand-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    const open = detailTr.classList.toggle('hidden');
    tr.querySelector('.expand-btn').textContent = open ? '▶' : '▼';
  });

  const orderBtn = tr.querySelector('.order-btn');
  if (orderBtn) {
    orderBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      submitDarvaxOrder(item);
    });
  }

  return [tr, detailTr];
}

function formatReasons(item) {
  const pass = (item.reasonsPass || []).map((r) => `<div>${escapeHtml(r)}</div>`).join('');
  const fail = (item.reasonsFail || []).map((r) => `<div class="fail">${escapeHtml(r)}</div>`).join('');
  const stops = item.levels?.stops;
  const stopLine = stops
    ? `<div><strong>Stops:</strong> primary ${stops.primary?.toFixed(2)} (${escapeHtml(stops.primaryKey || '')}) | box ${stops.box_bottom?.toFixed(2)} | EMA ${stops.ema?.toFixed(2)}</div>`
    : '';
  return pass + fail + stopLine;
}

async function loadDarvaxScans() {
  const market = document.getElementById('darvax-market').value;
  const minScore = document.getElementById('darvax-min-score').value;
  const date = state.date;
  let url = `/api/darvax/scans?date=${date}&minScore=${minScore}`;
  if (market) url += `&market=${market}`;
  const statusEl = document.getElementById('darvax-status');
  statusEl.textContent = 'Loading...';
  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const items = await resp.json();
    const body = document.getElementById('darvax-rows');
    body.innerHTML = '';
    items.forEach((item) => {
      const [tr, detail] = renderDarvaxRow(item);
      body.appendChild(tr);
      body.appendChild(detail);
    });
    statusEl.textContent = `${items.length} results for ${date}`;
  } catch (err) {
    statusEl.textContent = `Error: ${err.message}`;
    showErrorToast(`DarvaX load failed: ${err.message}`);
  }
}

async function loadPendingOrders() {
  try {
    const resp = await fetch('/api/darvax/orders/pending');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const orders = await resp.json();
    const body = document.getElementById('darvax-order-rows');
    body.innerHTML = '';
    orders.forEach((o) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(o.id)}</td>
        <td>${escapeHtml(o.symbol)}</td>
        <td>${escapeHtml(o.side)}</td>
        <td>${escapeHtml(o.quantity)}</td>
        <td>${escapeHtml(o.price)}</td>
        <td>${escapeHtml(o.status)}</td>
        <td><button class="btn approve-btn">Approve</button></td>
      `;
      tr.querySelector('.approve-btn').addEventListener('click', async () => {
        await fetch(`/api/darvax/orders/${o.id}/approve`, { method: 'POST' });
        loadPendingOrders();
      });
      body.appendChild(tr);
    });
  } catch (err) {
    showErrorToast(`Orders failed: ${err.message}`);
  }
}

async function submitDarvaxOrder(item) {
  const price = item.box?.top || item.close;
  const stopLoss = item.levels?.stops?.primary || item.box?.bottom;
  const previewResp = await fetch('/api/darvax/orders/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ price, stopLoss }),
  });
  const preview = await previewResp.json();
  if (!preview.quantity) {
    alert('Could not size position — check stop levels');
    return;
  }
  const ok = confirm(`Place BUY ${item.symbol} qty=${preview.quantity} @ ${price.toFixed(2)}? Stop ${stopLoss?.toFixed(2)}`);
  if (!ok) return;
  await fetch('/api/darvax/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      symbol: item.symbol,
      market: item.market,
      side: 'BUY',
      quantity: preview.quantity,
      price,
      stopLoss,
    }),
  });
  loadPendingOrders();
  alert('Order submitted — approve in Pending Orders (unless DARVAX_AUTO_TRADE=true)');
}

document.getElementById('darvax-refresh').addEventListener('click', loadDarvaxScans);
document.getElementById('darvax-market').addEventListener('change', loadDarvaxScans);
document.getElementById('darvax-min-score').addEventListener('change', loadDarvaxScans);
document.getElementById('darvax-run-scan').addEventListener('click', async () => {
  const statusEl = document.getElementById('darvax-status');
  statusEl.textContent = 'Running scan (Nifty 500 + S&P 500)... this may take ~20 min.';
  document.getElementById('darvax-run-scan').disabled = true;
  try {
    const resp = await fetch('/api/darvax/scan', { method: 'POST' });
    const data = await resp.json();
    if (data.error) throw new Error(data.error);
    statusEl.textContent = `Scan done NSE=${data.nse?.count ?? 0} US=${data.us?.count ?? 0}`;
    if (data.obsidian) statusEl.textContent += ` | Obsidian: ${data.obsidian.exportedCount} notes`;
    if (data.telegram?.sent) statusEl.textContent += ` | Telegram: ${data.telegram.count} alerts`;
    loadDarvaxScans();
  } catch (err) {
    statusEl.textContent = `Scan failed: ${err.message}`;
  } finally {
    document.getElementById('darvax-run-scan').disabled = false;
  }
});

document.getElementById('darvax-export-obsidian').addEventListener('click', async () => {
  const statusEl = document.getElementById('darvax-status');
  statusEl.textContent = 'Exporting to Obsidian...';
  try {
    const resp = await fetch('/api/darvax/export-obsidian', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: state.date }),
    });
    const data = await resp.json();
    if (data.error) throw new Error(data.error);
    statusEl.textContent = `Obsidian: ${data.exportedCount} stock notes → ${data.dailyPath}`;
  } catch (err) {
    statusEl.textContent = `Export failed: ${err.message}`;
  }
});

// Deep-link support
const params = new URLSearchParams(location.search);
const initialTab = params.get('tab') || 'markets';
if (['markets', 'live', 'darvax', 'track'].includes(initialTab)) {
  showView(initialTab);
} else {
  showView('markets');
}

loadSignals(state.date);
loadStatus();
loadMarkets();
connectLiveSocket();
setInterval(loadStatus, 30000);
setInterval(() => {
  if (!document.getElementById('view-markets').classList.contains('hidden')) {
    loadMarkets();
  }
}, 60000);
