/* Standalone Market Breadth dashboard (separate from PowerBull Pro) */

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
}

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
      const src = data.quoteSource ? ` · ${data.quoteSource}` : '';
      statusEl.textContent = `Overview ${data.fromCache ? 'cached' : 'live'}${src}${stamp ? ` · ${stamp}` : ''}`;
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

function stopBreadthPoll() {
  if (breadthPollTimer) {
    clearInterval(breadthPollTimer);
    breadthPollTimer = null;
  }
}

function startBreadthPoll(statusEl) {
  stopBreadthPoll();
  let seenScanning = false;
  breadthPollTimer = setInterval(async () => {
    try {
      const s = await fetch('/api/breadth/status').then((r) => r.json());
      if (s.scanning) {
        seenScanning = true;
        if (s.progress?.total) {
          statusEl.textContent = `Refreshing ${s.progress.done}/${s.progress.total}`
            + (s.progress.symbol ? ` · ${s.progress.symbol}` : '');
        } else {
          statusEl.textContent = 'Refreshing breadth in background…';
        }
        return;
      }
      if (seenScanning) {
        stopBreadthPoll();
        // Pull fresh completed cache without forcing another scan
        loadBreadth({ force: false, quiet: true });
      }
    } catch { /* ignore */ }
  }, 1200);
}

async function loadBreadth({ force = false, quiet = false } = {}) {
  const universe = document.getElementById('breadth-universe').value;
  const statusEl = document.getElementById('breadth-status');
  const btn = document.getElementById('breadth-refresh');
  if (!quiet) {
    statusEl.textContent = force ? 'Refreshing…' : 'Loading…';
  }
  btn.disabled = true;

  try {
    const url = force
      ? `/api/breadth?universe=${universe}&refresh=1`
      : `/api/breadth?universe=${universe}`;
    const resp = await fetch(url);
    const data = await resp.json();
    if (data.error) throw new Error(data.error);
    renderBreadthReport(data);
    if (data.refreshing) {
      statusEl.textContent = `${data.stockCount || 0} stocks · showing cache · refreshing in background…`;
      startBreadthPoll(statusEl);
    } else {
      stopBreadthPoll();
    }
  } catch (err) {
    statusEl.textContent = `Error: ${err.message}`;
    stopBreadthPoll();
  } finally {
    btn.disabled = false;
  }
}

document.getElementById('breadth-refresh').addEventListener('click', () => {
  // Overview is fast; breadth returns cache immediately and refreshes behind the scenes
  loadOverview({ force: true });
  loadBreadth({ force: true });
});
document.getElementById('breadth-universe').addEventListener('change', () => loadBreadth({ force: false }));

loadOverview();
loadBreadth();
