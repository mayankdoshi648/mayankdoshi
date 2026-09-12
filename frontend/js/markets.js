/* frontend/js/markets.js — Equity Markets board (sector / rankings / 52w) */
(function (global) {
  'use strict';

  const state = {
    universe: 'nifty50',
    sector: 'all',
    ranking: 'all',
    loading: false,
    wired: false,
  };

  const $ = (sel, el = document) => el.querySelector(sel);

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

  function changeClass(pct) {
    if (pct == null) return 'flat';
    if (pct > 0) return 'up';
    if (pct < 0) return 'down';
    return 'flat';
  }

  function showError(message) {
    const el = $('#markets-error');
    if (!el) return;
    if (!message) {
      el.classList.add('hidden');
      el.textContent = '';
      return;
    }
    el.textContent = message;
    el.classList.remove('hidden');
  }

  function renderSectorChips(sectors) {
    const host = $('#sector-chips');
    if (!host) return;
    host.innerHTML = '';

    const allBtn = document.createElement('button');
    allBtn.type = 'button';
    allBtn.className = `sector-chip${state.sector === 'all' ? ' active' : ''}`;
    allBtn.textContent = 'All sectors';
    allBtn.addEventListener('click', () => {
      state.sector = 'all';
      loadMarkets();
    });
    host.appendChild(allBtn);

    (sectors || []).forEach((s) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `sector-chip${state.sector === s.sector ? ' active' : ''}`;
      const cls = changeClass(s.avgChangePct);
      const sign = s.avgChangePct > 0 ? '+' : '';
      btn.innerHTML = `${escapeHtml(s.sectorShort || s.sector)}<span class="chip-meta ${cls}">${sign}${formatNumber(s.avgChangePct, 1)}%</span>`;
      btn.addEventListener('click', () => {
        state.sector = s.sector;
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
    const host = $('#markets-list');
    if (!host) return;
    host.innerHTML = '';
    if (!rows.length) {
      host.innerHTML = '<div class="markets-empty">No stocks match this sector / ranking filter.</div>';
      return;
    }
    rows.forEach((row) => host.appendChild(renderStockRow(row)));
  }

  async function loadMarkets({ force = false } = {}) {
    if (state.loading) return;
    state.loading = true;
    const statusEl = $('#markets-status');
    const countEl = $('#markets-count');
    const refreshBtn = $('#markets-refresh');
    if (statusEl) statusEl.textContent = force ? 'Refreshing…' : 'Loading market board…';
    if (refreshBtn) refreshBtn.disabled = true;
    showError('');

    try {
      const params = new URLSearchParams({
        universe: state.universe,
        sector: state.sector,
        ranking: state.ranking,
        limit: '100',
      });
      if (force) params.set('refresh', '1');

      const apiFetch = window.PowerBullLiveApi?.apiFetch || ((p, o) => fetch(p, { credentials: 'include', ...o }));
      const resp = await apiFetch(`/api/dashboard?${params}`);
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(data.error || `HTTP ${resp.status} — run npm start for Markets (needs Node API)`);
      }

      renderSectorChips(data.sectors || []);
      renderMarketsList(data.rows || []);

      const modeLabel = data.mode === 'demo' ? 'Demo' : 'Live';
      if (statusEl) {
        statusEl.textContent = `${modeLabel} · ${data.scannedAt ? new Date(data.scannedAt).toLocaleTimeString() : '—'} · ${data.ranking || state.ranking}`;
      }
      if (countEl) countEl.textContent = `${data.count ?? 0} / ${data.totalInUniverse ?? 0} stocks`;
      if (data.warning) showError(data.warning);
    } catch (err) {
      if (statusEl) statusEl.textContent = 'Failed to load';
      showError(`Markets error: ${err.message}`);
      const host = $('#markets-list');
      if (host) {
        host.innerHTML = `<div class="markets-empty">${escapeHtml(err.message)}</div>`;
      }
    } finally {
      state.loading = false;
      if (refreshBtn) refreshBtn.disabled = false;
    }
  }

  function wireOnce() {
    if (state.wired) return;
    state.wired = true;

    $$('.rank-chip').forEach((btn) => {
      btn.addEventListener('click', () => {
        $$('.rank-chip').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        state.ranking = btn.dataset.ranking;
        loadMarkets();
      });
    });

    $('#markets-universe')?.addEventListener('change', (e) => {
      state.universe = e.target.value;
      state.sector = 'all';
      loadMarkets({ force: true });
    });

    $('#markets-refresh')?.addEventListener('click', () => {
      loadMarkets({ force: true });
    });
  }

  function $$(sel) {
    return [...document.querySelectorAll(sel)];
  }

  async function render() {
    wireOnce();
    const universeEl = $('#markets-universe');
    if (universeEl) universeEl.value = state.universe;
    await loadMarkets();
  }

  global.MarketsBoard = { render, loadMarkets, state };
})(typeof window !== 'undefined' ? window : globalThis);
