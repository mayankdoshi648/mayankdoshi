// frontend/app.js
const state = { signals: [], date: new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10) };

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
  const resp = await fetch(`/api/signals?date=${date}`);
  const signals = await resp.json();
  state.signals = signals;
  updateCounters(signals);

  const liveBody = document.getElementById('signal-rows');
  liveBody.innerHTML = '';
  signals.forEach((s) => liveBody.appendChild(renderSignalRow(s)));

  const trackBody = document.getElementById('track-rows');
  trackBody.innerHTML = '';
  signals.forEach((s) => trackBody.appendChild(renderTrackRow(s)));
}

async function loadStatus() {
  const resp = await fetch('/api/status');
  const status = await resp.json();
  const banner = document.getElementById('market-banner');
  if (!status.feedConnected) {
    banner.textContent = status.lastError
      ? `Dhan feed disconnected (${status.lastError}) — check DHAN_CLIENT_ID/DHAN_PIN/DHAN_TOTP_SECRET in .env and restart the server.`
      : 'Dhan feed not connected — check DHAN_CLIENT_ID/DHAN_PIN/DHAN_TOTP_SECRET in .env and restart the server.';
    banner.classList.remove('hidden');
  } else if (!status.marketOpen) {
    banner.textContent = 'Market closed — showing last saved session.';
    banner.classList.remove('hidden');
  } else {
    banner.classList.add('hidden');
  }
}

function connectLiveSocket() {
  const ws = new WebSocket(`ws://${location.host}/live`);
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

document.getElementById('tab-live').addEventListener('click', () => {
  showView('live');
});

document.getElementById('tab-breadth').addEventListener('click', () => {
  showView('breadth');
  loadOverview();
  loadBreadth();
});

document.getElementById('tab-darvax').addEventListener('click', () => {
  showView('darvax');
  loadDarvaxScans();
  loadPendingOrders();
});

document.getElementById('tab-track').addEventListener('click', () => {
  showView('track');
});

function showView(name) {
  const views = { live: 'view-live', breadth: 'view-breadth', darvax: 'view-darvax', track: 'view-track' };
  const tabs = { live: 'tab-live', breadth: 'tab-breadth', darvax: 'tab-darvax', track: 'tab-track' };
  Object.values(views).forEach((id) => document.getElementById(id).classList.add('hidden'));
  Object.values(tabs).forEach((id) => document.getElementById(id).classList.remove('active'));
  document.getElementById(views[name]).classList.remove('hidden');
  document.getElementById(tabs[name]).classList.add('active');
  document.getElementById('counters').classList.toggle('hidden', name === 'darvax' || name === 'breadth');
}

document.getElementById('date-picker').value = state.date;
document.getElementById('date-picker').addEventListener('change', (e) => {
  state.date = e.target.value;
  loadSignals(state.date);
});

if (window.Notification && Notification.permission === 'default') {
  Notification.requestPermission();
}

loadSignals(state.date);
loadStatus();
connectLiveSocket();
setInterval(loadStatus, 30000);

// Deep-link: ?tab=breadth|darvax|track|live
(() => {
  const tab = new URLSearchParams(location.search).get('tab');
  if (tab === 'breadth') {
    showView('breadth');
    loadOverview();
    loadBreadth();
  } else if (tab === 'darvax') {
    showView('darvax');
    loadDarvaxScans();
    loadPendingOrders();
  } else if (tab === 'track') {
    showView('track');
  }
})();

// --- appended to frontend/app.js ---
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
  }
}

async function loadPendingOrders() {
  const resp = await fetch('/api/darvax/orders/pending');
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
    const obs = data.obsidian ? ` | Obsidian: ${data.obsidian.exportedCount} notes` : '';
    if (data.telegram?.sent) {
      statusEl.textContent += ` | Telegram: ${data.telegram.count} alerts`;
    }
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

// --- Market Overview (Nifty / VIX / size / sectors) ---
function fmtNum(n, digits = 2) {
  if (n == null || Number.isNaN(n)) return '—';
  return Number(n).toLocaleString('en-IN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function fmtPct(n) {
  if (n == null || Number.isNaN(n)) return '—';
  const sign = n > 0 ? '+' : '';
  return `${sign}${Number(n).toFixed(2)}%`;
}

function emaChipsHtml(ema) {
  const periods = [20, 50, 200];
  return periods.map((p) => {
    const key = `ema${p}`;
    const cell = ema?.[key];
    if (!cell || cell.above == null) {
      return `<span class="ema-chip na">EMA${p} —</span>`;
    }
    const cls = cell.above ? 'above' : 'below';
    const mark = cell.above ? '▲' : '▼';
    return `<span class="ema-chip ${cls}">EMA${p} ${mark}</span>`;
  }).join('');
}

function quoteCardHtml(q, { showEma = false, showSubtitle = false } = {}) {
  const dir = q.direction || 'flat';
  const sub = showSubtitle && (q.subtitle || q.subLabel)
    ? `<div class="q-sub">${escapeHtml(q.subtitle || q.subLabel)}</div>`
    : '';
  const ema = showEma
    ? `<div class="ema-row">${emaChipsHtml(q.ema)}</div>`
    : '';
  return `
    <div class="quote-card dir-${escapeHtml(dir)}" data-id="${escapeHtml(q.id)}">
      <div class="q-name">${escapeHtml(q.label)}</div>
      ${sub}
      <div class="q-row">
        <span class="q-last">${fmtNum(q.last, 2)}</span>
        <span class="q-arrow">${escapeHtml(q.arrow || '')}</span>
        <span class="q-chg">${fmtPct(q.changePct ?? q.changePercent)}</span>
      </div>
      ${ema}
    </div>
  `;
}

function sectorCardHtml(q) {
  const dir = q.direction || 'flat';
  const bias = q.ema?.bias || '';
  const biasHtml = bias
    ? `<div class="bias ${escapeHtml(bias)}">${escapeHtml(bias)}</div>`
    : `<div class="bias">EMA n/a</div>`;
  return `
    <div class="sector-card dir-${escapeHtml(dir)}" data-id="${escapeHtml(q.id)}">
      <div class="q-name">${escapeHtml(q.label)}</div>
      <div class="q-row">
        <span class="q-last">${fmtNum(q.last, 2)}</span>
        <span class="q-arrow">${escapeHtml(q.arrow || '')}</span>
        <span class="q-chg">${fmtPct(q.changePct ?? q.changePercent)}</span>
      </div>
      <div class="ema-row">${emaChipsHtml(q.ema)}</div>
      ${biasHtml}
    </div>
  `;
}

function renderOverview(data) {
  const headlineEl = document.getElementById('overview-headline');
  const sizeEl = document.getElementById('overview-size');
  const sectorsEl = document.getElementById('overview-sectors');
  if (!headlineEl || !sizeEl || !sectorsEl) return;

  headlineEl.innerHTML = (data.headline || []).map((q) => quoteCardHtml(q)).join('');
  sizeEl.innerHTML = (data.size || [])
    .map((q) => quoteCardHtml(q, { showEma: true, showSubtitle: true }))
    .join('');
  sectorsEl.innerHTML = (data.sectors || []).map((q) => sectorCardHtml(q)).join('');
}

async function loadOverview({ force = false } = {}) {
  const statusEl = document.getElementById('breadth-status');
  try {
    const url = force ? '/api/overview?refresh=1' : '/api/overview';
    const resp = await fetch(url);
    const data = await resp.json();
    if (data.error) throw new Error(data.error);
    renderOverview(data);
    if (statusEl && !statusEl.textContent.includes('Scanning')) {
      const stamp = data.scannedAt ? new Date(data.scannedAt).toLocaleTimeString() : '';
      statusEl.textContent = `Overview ${data.fromCache ? 'cached' : 'live'}${stamp ? ` · ${stamp}` : ''}`;
    }
  } catch (err) {
    if (statusEl) statusEl.textContent = `Overview error: ${err.message}`;
  }
}

// --- Market Breadth ---
let breadthIndexChart = null;
let breadthPctChart = null;
let breadthPollTimer = null;

function drawGauge(canvas, pct) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  const cx = w / 2;
  const cy = h / 2;
  const r = Math.min(w, h) / 2 - 10;
  ctx.clearRect(0, 0, w, h);

  // track
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = '#223040';
  ctx.lineWidth = 12;
  ctx.stroke();

  // value arc
  const value = Math.max(0, Math.min(100, pct ?? 0));
  const start = -Math.PI / 2;
  const end = start + (Math.PI * 2 * value) / 100;
  const color = value >= 50 ? '#21c55d' : '#ef4444';
  ctx.beginPath();
  ctx.arc(cx, cy, r, start, end);
  ctx.strokeStyle = color;
  ctx.lineWidth = 12;
  ctx.lineCap = 'round';
  ctx.stroke();

  // 50% tick
  const tickAngle = start + Math.PI;
  ctx.beginPath();
  ctx.moveTo(cx + Math.cos(tickAngle) * (r - 16), cy + Math.sin(tickAngle) * (r - 16));
  ctx.lineTo(cx + Math.cos(tickAngle) * (r + 4), cy + Math.sin(tickAngle) * (r + 4));
  ctx.strokeStyle = '#8892a0';
  ctx.lineWidth = 2;
  ctx.stroke();

  // center text
  ctx.fillStyle = '#e6edf3';
  ctx.font = 'bold 22px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(pct == null ? '—' : `${value.toFixed(0)}%`, cx, cy);
}

function renderBreadthGauges(gauges) {
  const keys = ['dma20', 'dma50', 'dma200'];
  keys.forEach((key) => {
    const card = document.querySelector(`.gauge-card[data-key="${key}"]`);
    if (!card || !gauges?.[key]) return;
    const g = gauges[key];
    drawGauge(card.querySelector('.gauge-canvas'), g.value);
    card.querySelector('.gauge-pct').textContent = g.value == null ? '—' : `${g.value}%`;
    card.querySelector('.gauge-arrow').textContent = g.arrow || '';
    card.querySelector('.gauge-title').textContent = g.label;
    card.querySelector('.gauge-sub').textContent = g.subtitle;
  });
}

function renderBreadthPosture(diagnosis) {
  const box = document.getElementById('breadth-posture');
  box.className = `breadth-posture tone-${diagnosis?.tone || 'neutral'}`;
  document.getElementById('breadth-posture-value').textContent = diagnosis?.posture || '—';
  document.getElementById('breadth-diagnosis').textContent = diagnosis?.diagnosis || '';
}

function renderBreadthCharts(series) {
  const labels = (series?.dates || []).map((d) => d.slice(5));
  const commonOpts = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { labels: { color: '#c9d4e0' } } },
    scales: {
      x: {
        ticks: { color: '#8892a0', maxTicksLimit: 8 },
        grid: { color: '#1a2330' },
      },
      y: {
        ticks: { color: '#8892a0' },
        grid: { color: '#1a2330' },
      },
    },
  };

  const indexCtx = document.getElementById('breadth-index-chart').getContext('2d');
  if (breadthIndexChart) breadthIndexChart.destroy();
  document.getElementById('breadth-index-chart').parentElement.style.height = '220px';
  breadthIndexChart = new Chart(indexCtx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Nifty 50',
        data: series?.index || [],
        borderColor: '#f5b400',
        backgroundColor: 'rgba(245,180,0,0.12)',
        fill: true,
        tension: 0.15,
        pointRadius: 0,
        borderWidth: 2,
      }],
    },
    options: commonOpts,
  });

  const pctCtx = document.getElementById('breadth-pct-chart').getContext('2d');
  if (breadthPctChart) breadthPctChart.destroy();
  document.getElementById('breadth-pct-chart').parentElement.style.height = '260px';
  breadthPctChart = new Chart(pctCtx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: '20 DMA',
          data: series?.breadth20 || [],
          borderColor: '#21c55d',
          tension: 0.15,
          pointRadius: 0,
          borderWidth: 2,
        },
        {
          label: '50 DMA',
          data: series?.breadth50 || [],
          borderColor: '#3b82f6',
          tension: 0.15,
          pointRadius: 0,
          borderWidth: 2,
        },
        {
          label: '200 DMA',
          data: series?.breadth200 || [],
          borderColor: '#94a3b8',
          tension: 0.15,
          pointRadius: 0,
          borderWidth: 2,
        },
      ],
    },
    options: {
      ...commonOpts,
      scales: {
        ...commonOpts.scales,
        y: {
          ...commonOpts.scales.y,
          min: 0,
          max: 100,
          ticks: {
            color: '#8892a0',
            callback: (v) => `${v}%`,
          },
        },
      },
      plugins: {
        ...commonOpts.plugins,
        annotation: undefined,
      },
    },
    plugins: [{
      id: 'fiftyLine',
      afterDraw(chart) {
        const { ctx, chartArea, scales } = chart;
        if (!scales.y || !chartArea) return;
        const y = scales.y.getPixelForValue(50);
        ctx.save();
        ctx.strokeStyle = '#8892a0';
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(chartArea.left, y);
        ctx.lineTo(chartArea.right, y);
        ctx.stroke();
        ctx.restore();
      },
    }],
  });
}

function renderBreadthReport(data) {
  renderBreadthGauges(data.gauges);
  renderBreadthPosture(data.diagnosis);
  renderBreadthCharts(data.series);
  const statusEl = document.getElementById('breadth-status');
  const src = data.dataSource || 'yahoo';
  const cache = data.fromCache ? 'cached' : 'fresh';
  statusEl.textContent = `${data.stockCount} stocks · as of ${data.asOf || '—'} · ${src} · ${cache}`
    + (data.warning ? ` · warn: ${data.warning}` : '');
}

async function loadBreadth({ force = false } = {}) {
  const universe = document.getElementById('breadth-universe').value;
  const statusEl = document.getElementById('breadth-status');
  const btn = document.getElementById('breadth-refresh');
  statusEl.textContent = force
    ? `Scanning ${universe === 'nifty500' ? 'Nifty 500' : 'Nifty 50'}… this can take a few minutes`
    : 'Loading…';
  btn.disabled = true;

  if (breadthPollTimer) {
    clearInterval(breadthPollTimer);
    breadthPollTimer = null;
  }

  breadthPollTimer = setInterval(async () => {
    try {
      const s = await fetch('/api/breadth/status').then((r) => r.json());
      if (s.scanning && s.progress?.total) {
        statusEl.textContent = `Scanning ${s.progress.done}/${s.progress.total}`
          + (s.progress.symbol ? ` · ${s.progress.symbol}` : '');
      }
    } catch { /* ignore */ }
  }, 1500);

  try {
    const url = force
      ? `/api/breadth?universe=${universe}&refresh=1`
      : `/api/breadth?universe=${universe}`;
    const resp = await fetch(url);
    const data = await resp.json();
    if (data.error) throw new Error(data.error);
    renderBreadthReport(data);
  } catch (err) {
    statusEl.textContent = `Error: ${err.message}`;
  } finally {
    btn.disabled = false;
    if (breadthPollTimer) {
      clearInterval(breadthPollTimer);
      breadthPollTimer = null;
    }
  }
}

document.getElementById('breadth-refresh').addEventListener('click', () => {
  loadOverview({ force: true });
  loadBreadth({ force: true });
});
document.getElementById('breadth-universe').addEventListener('change', () => loadBreadth({ force: false }));
