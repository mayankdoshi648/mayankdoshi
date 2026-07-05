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
  tr.innerHTML = `
    <td>${escapeHtml(signal.symbol)}</td>
    <td class="side-${signal.side.toLowerCase()}">${escapeHtml(signal.side)}</td>
    <td>${escapeHtml(signal.price)}</td>
    <td>${escapeHtml(new Date(signal.candle_time).toLocaleTimeString())}</td>
    <td>${escapeHtml(signal.outcome)}</td>
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
      ? `Dhan feed disconnected (${status.lastError}) — regenerate your token at web.dhan.co, update .env, and restart the server.`
      : 'Dhan feed not connected — check DHAN_CLIENT_ID/DHAN_ACCESS_TOKEN in .env and restart the server.';
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
  document.getElementById('view-live').classList.remove('hidden');
  document.getElementById('view-track').classList.add('hidden');
  document.getElementById('tab-live').classList.add('active');
  document.getElementById('tab-track').classList.remove('active');
});

document.getElementById('tab-track').addEventListener('click', () => {
  document.getElementById('view-track').classList.remove('hidden');
  document.getElementById('view-live').classList.add('hidden');
  document.getElementById('tab-track').classList.add('active');
  document.getElementById('tab-live').classList.remove('active');
});

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

// --- appended to frontend/app.js ---
let activeChart = null;

async function openChartModal(symbol) {
  const resp = await fetch(`/api/candles/${symbol}`);
  const candles = await resp.json();
  const modal = document.getElementById('chart-modal');
  document.getElementById('chart-title').textContent = symbol;
  modal.classList.remove('hidden');

  const ohlc = candles.map((c) => ({ x: c.time, o: c.open, h: c.high, l: c.low, c: c.close }));
  const markers = state.signals
    .filter((s) => s.symbol === symbol)
    .map((s) => ({ x: new Date(s.candle_time).getTime(), y: s.price, side: s.side }));

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
      scales: { x: { type: 'time', time: { unit: 'minute' } } },
    },
  });
}

document.getElementById('chart-close').addEventListener('click', () => {
  document.getElementById('chart-modal').classList.add('hidden');
});
