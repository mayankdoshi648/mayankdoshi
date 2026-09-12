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

/** Labeled MOCK used on static hosts (GitHub Pages) when /api/* is unavailable. */
function staticBreadthDemo(universe) {
  const now = new Date().toISOString();
  const mkQuote = (id, label, last, changePct, extra = {}) => ({
    id,
    label,
    last,
    changePct,
    changePercent: changePct,
    direction: changePct > 0.05 ? 'up' : changePct < -0.05 ? 'down' : 'flat',
    arrow: changePct > 0.05 ? '▲' : changePct < -0.05 ? '▼' : '■',
    ema: {
      ema20: { above: changePct >= 0, value: last * 0.99 },
      ema50: { above: changePct >= -0.3, value: last * 0.98 },
      ema200: { above: true, value: last * 0.95 },
      bias: changePct >= 0 ? 'BULLISH' : 'BEARISH',
    },
    ...extra,
  });
  const dates = Array.from({ length: 30 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (29 - i));
    return d.toISOString().slice(0, 10);
  });
  const mkSeries = (start) => dates.map((_, i) => Number((start + Math.sin(i / 4) * 2 + i * 0.15).toFixed(2)));
  return {
    overview: {
      fromCache: true,
      quoteSource: 'STATIC_DEMO',
      scannedAt: now,
      headline: [
        mkQuote('NIFTY', 'NIFTY 50', 24850, 0.42),
        mkQuote('BANKNIFTY', 'BANK NIFTY', 51240, 0.31),
        mkQuote('INDIAVIX', 'INDIA VIX', 13.2, -1.1),
      ],
      size: [
        mkQuote('NIFTY', 'Large Cap', 24850, 0.42, { subtitle: 'Nifty 50' }),
        mkQuote('MIDCAP', 'Mid Cap', 13240, 0.55, { subtitle: 'Nifty Midcap' }),
        mkQuote('SMLCAP', 'Small Cap', 9800, -0.22, { subtitle: 'Nifty Smallcap' }),
      ],
      sectors: [
        mkQuote('BANK', 'Bank', 51240, 0.31),
        mkQuote('IT', 'IT', 38200, -0.45),
        mkQuote('AUTO', 'Auto', 21400, 0.62),
        mkQuote('PHARMA', 'Pharma', 19800, 0.18),
        mkQuote('METAL', 'Metal', 8900, -0.7),
        mkQuote('FMCG', 'FMCG', 56000, 0.12),
      ],
    },
    breadth: {
      universe: universe || 'nifty50',
      stockCount: universe === 'nifty500' ? 500 : 50,
      asOf: now.slice(0, 10),
      dataSource: 'STATIC_DEMO',
      fromCache: true,
      warning: 'STATIC DEMO (MOCK) — labeled sample for GitHub Pages. Not live NSE data.',
      gauges: {
        dma20: { value: 62, label: '20 DMA — LEADERS', subtitle: 'Short-term health', arrow: '▲' },
        dma50: { value: 54, label: '50 DMA — CORE', subtitle: 'Medium-term health', arrow: '▲' },
        dma200: { value: 48, label: '200 DMA — FOUNDATION', subtitle: 'Long-term health', arrow: '▼' },
      },
      diagnosis: {
        posture: 'SELECTIVE',
        tone: 'neutral',
        diagnosis: 'MOCK: short-term breadth constructive; long-term still mixed.',
      },
      series: {
        dates,
        index: mkSeries(24500),
        dma20: mkSeries(55),
        dma50: mkSeries(50),
        dma200: mkSeries(46),
      },
    },
  };
}

function isStaticHost() {
  const live = window.PowerBullLiveApi;
  if (live?.getLiveApiOrigin?.()) return false;
  return /github\.io$/i.test(location.hostname) || /vercel\.app$/i.test(location.hostname);
}

function apiFetch(path, options) {
  const live = window.PowerBullLiveApi;
  if (live?.apiFetch) return live.apiFetch(path, options);
  return fetch(path, { credentials: 'include', ...options });
}

function setBreadthDhanMsg(text, ok = null) {
  const el = document.getElementById('breadth-dhan-msg');
  if (!el) return;
  el.textContent = text || '';
  el.classList.toggle('ok', ok === true);
  el.classList.toggle('err', ok === false);
}

function wireBreadthDhanPanel() {
  const live = window.PowerBullLiveApi;
  const hostInput = document.getElementById('breadth-live-api');
  if (hostInput && live?.getLiveApiOrigin) {
    const origin = live.getLiveApiOrigin() || '';
    if (origin && !hostInput.value) hostInput.value = origin;
  }

  document.getElementById('breadth-live-api-save')?.addEventListener('click', () => {
    if (!live) {
      setBreadthDhanMsg('Live API helper missing — hard-refresh the page.', false);
      return;
    }
    const origin = live.setLiveApiOrigin(hostInput?.value || '');
    if (!origin) {
      setBreadthDhanMsg('Enter a valid https:// Worker URL.', false);
      return;
    }
    setBreadthDhanMsg(`Live API host saved: ${origin}`, true);
    loadOverview({ force: true });
    loadBreadth({ force: false });
  });

  document.getElementById('breadth-dhan-save')?.addEventListener('click', async () => {
    const clientId = document.getElementById('breadth-dhan-client-id')?.value.trim() || '';
    const accessToken = document.getElementById('breadth-dhan-access-token')?.value.trim() || '';
    if (!clientId || !accessToken) {
      setBreadthDhanMsg('Need Client ID + Access Token.', false);
      return;
    }
    if (!live?.getLiveApiOrigin?.() && isStaticHost()) {
      setBreadthDhanMsg('Save Live API host first (Cloudflare Worker URL).', false);
      return;
    }
    setBreadthDhanMsg('Saving Dhan credentials…');
    try {
      const resp = await apiFetch('/api/fno/credentials/dhan', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, accessToken, persistEnv: false }),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(json.error || json.message || `HTTP ${resp.status}`);
      const tok = document.getElementById('breadth-dhan-access-token');
      if (tok) tok.value = '';
      setBreadthDhanMsg('Dhan saved on live host (encrypted cookie). Breadth DMA still needs Node for full live scan.', true);
    } catch (err) {
      setBreadthDhanMsg(err.message || 'Save failed', false);
    }
  });

  document.getElementById('breadth-dhan-clear')?.addEventListener('click', async () => {
    setBreadthDhanMsg('Clearing…');
    try {
      const resp = await apiFetch('/api/fno/credentials/dhan', { method: 'DELETE' });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(json.error || `HTTP ${resp.status}`);
      document.getElementById('breadth-dhan-client-id').value = '';
      document.getElementById('breadth-dhan-access-token').value = '';
      setBreadthDhanMsg('Dhan credentials cleared on live host.', true);
    } catch (err) {
      setBreadthDhanMsg(err.message || 'Clear failed', false);
    }
  });
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
    if (isStaticHost() && !window.PowerBullLiveApi?.getLiveApiOrigin?.()) throw new Error('static-host');
    const url = force ? '/api/overview?refresh=1' : '/api/overview';
    const resp = await apiFetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    if (data.error) throw new Error(data.error || data.message || 'overview error');
    renderOverview(data);
    if (statusEl && !statusEl.textContent.includes('Scanning')) {
      const stamp = data.scannedAt ? new Date(data.scannedAt).toLocaleTimeString() : '';
      const src = data.quoteSource ? ` · ${data.quoteSource}` : '';
      statusEl.textContent = `Overview ${data.fromCache ? 'cached' : 'live'}${src}${stamp ? ` · ${stamp}` : ''}`;
    }
  } catch (err) {
    const demo = staticBreadthDemo().overview;
    renderOverview(demo);
    if (statusEl) {
      statusEl.textContent = `STATIC DEMO (MOCK) · overview — not live NSE (${err.message})`;
    }
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
      const s = await apiFetch('/api/breadth/status').then((r) => r.json());
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
    if (isStaticHost() && !window.PowerBullLiveApi?.getLiveApiOrigin?.()) throw new Error('static-host');
    const url = force
      ? `/api/breadth?universe=${universe}&refresh=1`
      : `/api/breadth?universe=${universe}`;
    const resp = await apiFetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    if (data.error) throw new Error(data.error || data.message || 'breadth error');
    renderBreadthReport(data);
    if (data.refreshing) {
      statusEl.textContent = `${data.stockCount || 0} stocks · showing cache · refreshing in background…`;
      startBreadthPoll(statusEl);
    } else {
      stopBreadthPoll();
    }
  } catch (err) {
    const demo = staticBreadthDemo(universe).breadth;
    renderBreadthReport(demo);
    stopBreadthPoll();
    statusEl.textContent = `STATIC DEMO (MOCK) · ${demo.stockCount} stocks — not live NSE (${err.message})`;
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

wireBreadthDhanPanel();
loadOverview();
loadBreadth();
