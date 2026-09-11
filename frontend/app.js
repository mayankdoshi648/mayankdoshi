/* frontend/app.js — legacy Live / DarvaX / Track (+ futures table host).
   F&O terminal navigation lives in js/terminal.js — do not redefine it here. */
const state = {
  signals: [],
  date: new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10),
};

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
}

function updateCounters(signals) {
  const total = document.getElementById('count-total');
  const buy = document.getElementById('count-buy');
  const sell = document.getElementById('count-sell');
  if (total) total.textContent = signals.length;
  if (buy) buy.textContent = signals.filter((s) => s.side === 'BUY').length;
  if (sell) sell.textContent = signals.filter((s) => s.side === 'SELL').length;
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
  const resp = await fetch(`/api/signals?date=${date}`);
  const signals = await resp.json();
  state.signals = Array.isArray(signals) ? signals : [];
  updateCounters(state.signals);

  const liveBody = document.getElementById('signal-rows');
  if (liveBody) {
    liveBody.innerHTML = '';
    state.signals.forEach((s) => liveBody.appendChild(renderSignalRow(s)));
  }

  const trackBody = document.getElementById('track-rows');
  if (trackBody) {
    trackBody.innerHTML = '';
    state.signals.forEach((s) => trackBody.appendChild(renderTrackRow(s)));
  }
}

async function loadStatus() {
  try {
    const resp = await fetch('/api/status');
    const status = await resp.json();
    const banner = document.getElementById('market-banner');
    if (!banner) return;
    if (!status.feedConnected) {
      if (status.hasDhan) {
        banner.textContent = status.lastError
          ? `Equity live socket disconnected (${status.lastError}) — F&O hybrid may still use Dhan; reconnect/restart if quotes stall.`
          : 'Equity live socket not connected — F&O can still pull via Dhan API credentials (More → Dhan API).';
      } else {
        banner.textContent = status.lastError
          ? `Dhan feed disconnected (${status.lastError}) — set credentials in More → Dhan API or .env, then restart if needed.`
          : 'Dhan feed not connected — set Client ID / PIN / TOTP in More → Dhan API (or .env) for live data.';
      }
      banner.classList.remove('hidden');
    } else if (!status.marketOpen) {
      banner.textContent = 'Market closed — showing last saved session.';
      banner.classList.remove('hidden');
    } else {
      banner.classList.add('hidden');
    }
  } catch {
    /* status endpoint may be unavailable during mock-only boots */
  }
}

function connectLiveSocket() {
  let ws;
  try {
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/live`);
  } catch {
    return;
  }
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === 'signal') {
      state.signals.push(msg);
      updateCounters(state.signals);
      document.getElementById('signal-rows')?.appendChild(renderSignalRow(msg));
      document.getElementById('track-rows')?.appendChild(renderTrackRow(msg));
      playAlert(msg);
    } else if (msg.type === 'outcome') {
      const signal = state.signals.find((s) => String(s.id) === String(msg.id));
      if (signal) signal.outcome = msg.outcome;
      const row = document.querySelector(`#track-rows tr[data-id="${msg.id}"]`);
      const cell = row?.querySelector('.outcome-cell');
      if (cell) cell.textContent = msg.outcome;
    }
  });
  ws.addEventListener('close', () => setTimeout(connectLiveSocket, 2000));
  ws.addEventListener('error', () => { try { ws.close(); } catch { /* ignore */ } });
}

function playAlert(signal) {
  document.getElementById('alert-sound')?.play()?.catch(() => {});
  if (window.Notification && Notification.permission === 'granted') {
    new Notification(`${signal.side} ${signal.symbol}`, { body: `Price ${signal.price}` });
  }
}

const datePicker = document.getElementById('date-picker');
if (datePicker) {
  datePicker.value = state.date;
  datePicker.addEventListener('change', (e) => {
    state.date = e.target.value;
    loadSignals(state.date);
  });
}

if (window.Notification && Notification.permission === 'default') {
  Notification.requestPermission().catch(() => {});
}

loadSignals(state.date);
loadStatus();
connectLiveSocket();
setInterval(loadStatus, 30000);

// Deep-link: ?tab=darvax|track|live|legacy|markets — optional; prefers FnoTerminal when present
(() => {
  const tab = new URLSearchParams(location.search).get('tab');
  if (!tab) return;
  if (tab === 'markets') {
    // terminal.js boot also handles ?tab=markets; keep as fallback if boot already ran
    const tryShow = () => window.FnoTerminal?.showView?.('markets');
    if (window.FnoTerminal) tryShow();
    else document.addEventListener('DOMContentLoaded', () => setTimeout(tryShow, 0));
    return;
  }
  if (tab === 'darvax' || tab === 'track' || tab === 'live' || tab === 'futures' || tab === 'legacy') {
    window.FnoTerminal?.showView?.('legacy');
    const legacyName = tab === 'legacy' ? 'live' : tab;
    document.querySelectorAll('#legacy-seg button').forEach((b) => {
      b.classList.toggle('active', b.dataset.legacy === legacyName);
    });
    ['live', 'darvax', 'track', 'futures'].forEach((name) => {
      document.getElementById(`legacy-${name}`)?.classList.toggle('hidden', name !== legacyName);
    });
    if (legacyName === 'darvax') {
      loadDarvaxScans();
      loadPendingOrders();
    }
  }
})();

/* —— Chart modal —— */
let activeChart = null;

function formatCandleTime(epochMs) {
  const ist = new Date(epochMs + 5.5 * 60 * 60 * 1000);
  const hh = String(ist.getUTCHours()).padStart(2, '0');
  const mm = String(ist.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

async function openChartModal(symbol) {
  const resp = await fetch(`/api/candles/${symbol}`);
  const candles = await resp.json();
  const modal = document.getElementById('chart-modal');
  const title = document.getElementById('chart-title');
  const canvas = document.getElementById('chart-canvas');
  if (!modal || !title || !canvas) return;
  if (!Array.isArray(candles)) return;

  title.textContent = symbol;
  modal.classList.remove('hidden');

  const ohlc = candles.map((c) => ({
    x: formatCandleTime(c.time),
    o: c.open,
    h: c.high,
    l: c.low,
    c: c.close,
  }));
  const markers = state.signals
    .filter((s) => s.symbol === symbol)
    .map((s) => ({
      x: formatCandleTime(new Date(s.candle_time).getTime()),
      y: s.price,
      side: s.side,
    }));

  if (activeChart) activeChart.destroy();
  const ctx = canvas.getContext('2d');
  activeChart = new Chart(ctx, {
    type: 'candlestick',
    data: {
      datasets: [
        { label: symbol, data: ohlc },
        {
          type: 'scatter',
          label: 'Signals',
          data: markers.map((m) => ({ x: m.x, y: m.y })),
          pointBackgroundColor: markers.map((m) => (m.side === 'BUY' ? '#22c55e' : '#ef4444')),
          pointStyle: markers.map((m) => (m.side === 'BUY' ? 'triangle' : 'rectRot')),
          pointRadius: 6,
        },
      ],
    },
    options: {
      scales: { x: { type: 'category' } },
    },
  });
}

document.getElementById('chart-close')?.addEventListener('click', () => {
  document.getElementById('chart-modal')?.classList.add('hidden');
});

/* —— DarvaX Scanner —— */
function tierClass(tier) {
  if (tier === 'A+') return 'tier-aplus';
  if (tier === 'A') return 'tier-a';
  return 'tier-b';
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

function renderDarvaxRow(item) {
  const tr = document.createElement('tr');
  tr.dataset.symbol = item.symbol;
  const boxTop = item.box?.top?.toFixed(2) ?? '—';
  const boxBottom = item.box?.bottom?.toFixed(2) ?? '—';
  const canOrder = item.market === 'NSE' && (item.stage === 'BREAKOUT' || item.stage === 'SUPER_TREND');
  tr.innerHTML = `
    <td><button type="button" class="expand-btn" aria-label="Expand">▶</button></td>
    <td>${escapeHtml(item.symbol)}</td>
    <td>${escapeHtml(item.market)}</td>
    <td class="${tierClass(item.tier)}">${escapeHtml(item.strengthScore)} ${escapeHtml(item.tier || '')}</td>
    <td class="stage-${(item.stage || '').toLowerCase()}">${escapeHtml(item.stage || '—')}</td>
    <td>${escapeHtml(boxTop)}</td>
    <td>${escapeHtml(boxBottom)}</td>
    <td>${item.rsPercentile != null ? escapeHtml(item.rsPercentile.toFixed(0)) : '—'}</td>
    <td>${item.rvol != null ? escapeHtml(item.rvol.toFixed(1)) : '—'}</td>
    <td>${canOrder ? '<button type="button" class="btn order-btn">Order</button>' : '—'}</td>
  `;

  const detailTr = document.createElement('tr');
  detailTr.classList.add('hidden');
  detailTr.innerHTML = `<td colspan="10"><div class="darvax-reasons">${formatReasons(item)}</div></td>`;

  tr.querySelector('.expand-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = detailTr.classList.toggle('hidden');
    const btn = tr.querySelector('.expand-btn');
    if (btn) btn.textContent = open ? '▶' : '▼';
  });

  const orderBtn = tr.querySelector('.order-btn');
  orderBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    submitDarvaxOrder(item);
  });

  return [tr, detailTr];
}

async function loadDarvaxScans() {
  const market = document.getElementById('darvax-market')?.value ?? '';
  const minScore = document.getElementById('darvax-min-score')?.value ?? '55';
  const date = state.date;
  let url = `/api/darvax/scans?date=${date}&minScore=${minScore}`;
  if (market) url += `&market=${market}`;
  const statusEl = document.getElementById('darvax-status');
  if (statusEl) statusEl.textContent = 'Loading...';
  try {
    const resp = await fetch(url);
    const items = await resp.json();
    const body = document.getElementById('darvax-rows');
    if (!body) return;
    body.innerHTML = '';
    const list = Array.isArray(items) ? items : [];
    list.forEach((item) => {
      const [tr, detail] = renderDarvaxRow(item);
      body.appendChild(tr);
      body.appendChild(detail);
    });
    if (statusEl) statusEl.textContent = `${list.length} results for ${date}`;
  } catch (err) {
    if (statusEl) statusEl.textContent = `Error: ${err.message}`;
  }
}

async function loadPendingOrders() {
  try {
    const resp = await fetch('/api/darvax/orders/pending');
    const orders = await resp.json();
    const body = document.getElementById('darvax-order-rows');
    if (!body) return;
    body.innerHTML = '';
    (Array.isArray(orders) ? orders : []).forEach((o) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(o.id)}</td>
        <td>${escapeHtml(o.symbol)}</td>
        <td>${escapeHtml(o.side)}</td>
        <td>${escapeHtml(o.quantity)}</td>
        <td>${escapeHtml(o.price)}</td>
        <td>${escapeHtml(o.status)}</td>
        <td><button type="button" class="btn approve-btn">Approve</button></td>
      `;
      tr.querySelector('.approve-btn')?.addEventListener('click', async () => {
        await fetch(`/api/darvax/orders/${o.id}/approve`, { method: 'POST' });
        loadPendingOrders();
      });
      body.appendChild(tr);
    });
  } catch {
    /* ignore when darvax routes unavailable */
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
  const ok = confirm(`Place BUY ${item.symbol} qty=${preview.quantity} @ ${Number(price).toFixed(2)}? Stop ${stopLoss != null ? Number(stopLoss).toFixed(2) : '—'}`);
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

document.getElementById('darvax-refresh')?.addEventListener('click', loadDarvaxScans);
document.getElementById('darvax-market')?.addEventListener('change', loadDarvaxScans);
document.getElementById('darvax-min-score')?.addEventListener('change', loadDarvaxScans);

document.getElementById('darvax-run-scan')?.addEventListener('click', async () => {
  const statusEl = document.getElementById('darvax-status');
  const runBtn = document.getElementById('darvax-run-scan');
  if (statusEl) statusEl.textContent = 'Running scan (Nifty 500 + S&P 500)... this may take ~20 min.';
  if (runBtn) runBtn.disabled = true;
  try {
    const resp = await fetch('/api/darvax/scan', { method: 'POST' });
    const data = await resp.json();
    if (data.error) throw new Error(data.error);
    if (data.telegram?.sent && statusEl) {
      statusEl.textContent += ` | Telegram: ${data.telegram.count} alerts`;
    }
    loadDarvaxScans();
  } catch (err) {
    if (statusEl) statusEl.textContent = `Scan failed: ${err.message}`;
  } finally {
    if (runBtn) runBtn.disabled = false;
  }
});

document.getElementById('darvax-export-obsidian')?.addEventListener('click', async () => {
  const statusEl = document.getElementById('darvax-status');
  if (statusEl) statusEl.textContent = 'Exporting to Obsidian...';
  try {
    const resp = await fetch('/api/darvax/export-obsidian', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: state.date }),
    });
    const data = await resp.json();
    if (data.error) throw new Error(data.error);
    if (statusEl) statusEl.textContent = `Obsidian: ${data.exportedCount} stock notes → ${data.dailyPath}`;
  } catch (err) {
    if (statusEl) statusEl.textContent = `Export failed: ${err.message}`;
  }
});

window.loadDarvaxScans = loadDarvaxScans;
window.loadPendingOrders = loadPendingOrders;
