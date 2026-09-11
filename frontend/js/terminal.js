/* frontend/js/terminal.js — F&O Intelligence Terminal UI (no business math) */
(function () {
  const state = {
    view: 'overview',
    buildupSignal: 'LONG_BUILDUP',
    lastMeta: null,
    chain: null,
  };

  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[ch]));
  }

  function fmt(n, d = 2) {
    if (n == null || Number.isNaN(Number(n))) return '—';
    return Number(n).toFixed(d);
  }

  function fmtPct(n) {
    if (n == null || Number.isNaN(Number(n))) return '—';
    const v = Number(n);
    return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
  }

  function clsDir(n) {
    if (n == null || Number.isNaN(Number(n))) return '';
    return Number(n) >= 0 ? 'up' : 'down';
  }

  function setMeta(meta) {
    state.lastMeta = meta;
    const el = $('#data-meta');
    if (!el || !meta) return;
    const t = meta.asOf ? new Date(meta.asOf).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '—';
    el.textContent = `${meta.source || '?'} · ${t}${meta.isMock ? ' · MOCK' : ''}`;
    const banner = $('#mock-banner');
    if (meta.isMock || meta.warning) {
      banner.textContent = meta.warning
        ? `MOCK / FALLBACK — ${meta.warning}`
        : 'MOCK DATA — not a live exchange feed';
      banner.classList.remove('hidden');
    } else {
      banner.classList.add('hidden');
    }
  }

  async function api(path) {
    const resp = await fetch(path);
    const json = await resp.json();
    if (json.meta) setMeta(json.meta);
    if (!resp.ok && json.error) throw new Error(json.error);
    return json;
  }

  function showView(name) {
    state.view = name;
    $$('.view').forEach((v) => v.classList.toggle('active', v.dataset.view === name));
    $$('.bottom-nav [data-nav]').forEach((b) => b.classList.toggle('active', b.dataset.nav === name));
    $('#more-sheet')?.classList.add('hidden');
    loadView(name);
  }

  async function loadView(name) {
    try {
      if (name === 'overview') await renderOverview();
      if (name === 'intel') await renderIntel();
      if (name === 'chain' || name === 'oi') await renderChain(name === 'oi');
      if (name === 'smart') await renderSmart();
      if (name === 'sectors') await renderSectors();
      if (name === 'scanner') await renderScanner();
      if (name === 'fii') await renderFii();
      if (name === 'alerts') await renderAlerts();
      if (name === 'watch') await renderWatch();
      if (name === 'legacy') await renderFuturesTable();
    } catch (err) {
      console.error(err);
      $('#data-meta').textContent = `Error: ${err.message}`;
    }
  }

  async function renderTicker() {
    const env = await api('/api/fno/ticker');
    const root = $('#ticker');
    root.innerHTML = (env.data || []).map((q) => `
      <div class="tick">
        <div class="sym">${escapeHtml(q.symbol)}</div>
        <div class="ltp">${fmt(q.ltp, q.symbol === 'INDIAVIX' ? 2 : 2)}</div>
        <div class="chg ${clsDir(q.changePct)}">${fmtPct(q.changePct)} (${fmt(q.change)})</div>
        <div class="hi-lo">H ${fmt(q.high)} · L ${fmt(q.low)}${q.futuresPrice != null ? ` · F ${fmt(q.futuresPrice)}` : ''}</div>
      </div>
    `).join('');
  }

  async function renderOverview() {
    const env = await api('/api/fno/overview');
    const regime = env.data?.regime || {};
    const label = $('#regime-label');
    label.textContent = (regime.label || '—').replace(/_/g, ' ');
    label.className = `regime-label ${regime.label || ''}`;
    $('#regime-score').textContent = regime.score ?? '—';
    $('#regime-conf').textContent = regime.confidence != null ? `${Math.round(regime.confidence * 100)}%` : '—';
    $('#regime-factors').innerHTML = (regime.factors || []).map((f) => `
      <div class="factor"><span class="n">${escapeHtml(f.name)}</span><span class="e">${escapeHtml(f.evidence)}</span></div>
    `).join('') || '<div class="muted">No factors available</div>';

    const snap = env.data?.optionSnapshot;
    const opt = $('#overview-opt');
    if (!snap) {
      opt.innerHTML = '<div class="muted">Option snapshot unavailable</div>';
      $('#overview-interp').innerHTML = '';
    } else {
      opt.innerHTML = [
        ['OI PCR', fmt(snap.pcr)],
        ['Max Pain', fmt(snap.maxPain, 0)],
        ['ATM', snap.atm?.strike ?? '—'],
        ['ATM IV', snap.atm?.iv != null ? `${fmt(snap.atm.iv)}%` : '—'],
        ['Exp Move', snap.expectedMove ? `±${fmt(snap.expectedMove.move)}` : '—'],
        ['1σ Range', snap.expectedMove ? `${fmt(snap.expectedMove.lower1sd)} – ${fmt(snap.expectedMove.upper1sd)}` : '—'],
      ].map(([k, v]) => `<div class="metric"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('');
      const ev = snap.interpretation?.evidence || [];
      $('#overview-interp').innerHTML = `<strong>${escapeHtml(snap.interpretation?.summary || '')}</strong><ul>${ev.map((e) => `<li>${escapeHtml(e)}</li>`).join('')}</ul>`;
    }

    try {
      const sectors = await api('/api/fno/sectors');
      $('#overview-sectors').innerHTML = (sectors.data || []).slice(0, 8).map((s) => `
        <div class="sector-chip">
          <div class="s">#${s.rank} ${escapeHtml(s.sector)}</div>
          <div class="v ${clsDir(s.returnPct)}">${fmtPct(s.returnPct)} · score ${s.score}</div>
        </div>
      `).join('');
    } catch {
      $('#overview-sectors').innerHTML = '';
    }
  }

  async function renderIntel() {
    const env = await api(`/api/fno/scanner?signal=${state.buildupSignal}`);
    const body = $('#intel-table tbody');
    body.innerHTML = (env.data || []).map((r) => `
      <tr data-why="${escapeHtml((r.why || []).join(' | '))}">
        <td>${escapeHtml(r.symbol)}</td>
        <td>${fmt(r.ltp)}</td>
        <td class="${clsDir(r.priceChangePct)}">${fmtPct(r.priceChangePct)}</td>
        <td class="${clsDir(r.oiChangePct)}">${fmtPct(r.oiChangePct)}</td>
        <td>${fmt(r.relativeVolume)}</td>
        <td>${fmt(r.iv)}</td>
        <td>${escapeHtml((r.buildup || '').replace(/_/g, ' '))}</td>
        <td class="${clsDir(r.score)}">${r.score ?? '—'}</td>
      </tr>
    `).join('');
    body.querySelectorAll('tr').forEach((tr) => {
      tr.addEventListener('click', () => {
        const why = $('#intel-why');
        why.classList.remove('hidden');
        why.innerHTML = `<strong>WHY?</strong><div>${escapeHtml(tr.dataset.why)}</div>`;
      });
    });
  }

  async function ensureExpiries() {
    const und = $('#chain-underlying').value;
    const env = await api(`/api/fno/expiries/${und}`);
    const sel = $('#chain-expiry');
    const cur = sel.value;
    sel.innerHTML = (env.data || []).map((d) => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join('');
    if (cur && [...sel.options].some((o) => o.value === cur)) sel.value = cur;
  }

  async function renderChain(oiOnly = false) {
    await ensureExpiries();
    const und = $('#chain-underlying').value;
    const expiry = $('#chain-expiry').value;
    const env = await api(`/api/fno/option-chain/${und}?expiry=${encodeURIComponent(expiry)}`);
    state.chain = env.data;

    const m = env.data?.metrics || {};
    const em = env.data?.expectedMove;
    const metricsHtml = [
      ['Spot', fmt(env.data?.spot)],
      ['ATM', env.data?.atm?.strike ?? '—'],
      ['OI PCR', fmt(m.oiPcr)],
      ['Vol PCR', fmt(m.volumePcr)],
      ['Max Pain', fmt(m.maxPain, 0)],
      ['Call Resist', m.callOiResistance?.strike ?? '—'],
      ['Put Support', m.putOiSupport?.strike ?? '—'],
      ['ATM IV', m.atmIv != null ? `${fmt(m.atmIv)}%` : '—'],
      ['Exp Move', em ? `±${fmt(em.move)}` : '—'],
      ['1σ', em ? `${fmt(em.lower1sd)}–${fmt(em.upper1sd)}` : '—'],
      ['2σ', em ? `${fmt(em.lower2sd)}–${fmt(em.upper2sd)}` : '—'],
      ['Straddle', env.data?.atm?.straddle != null ? fmt(env.data.atm.straddle) : '—'],
    ].map(([k, v]) => `<div class="metric"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('');

    $('#chain-metrics').innerHTML = metricsHtml;
    $('#oi-metrics').innerHTML = metricsHtml;
    const ev = env.data?.interpretation?.evidence || [];
    $('#chain-interp').innerHTML = `<strong>${escapeHtml(env.data?.interpretation?.summary || '')}</strong><ul>${ev.map((e) => `<li>${escapeHtml(e)}</li>`).join('')}</ul>`;

    const hiCall = env.data?.highlights?.highestCallOi?.strike;
    const hiPut = env.data?.highlights?.highestPutOi?.strike;
    const atm = env.data?.atm?.strike;
    const spot = env.data?.spot;
    const around = (env.data?.strikes || []).filter((s) => spot == null || Math.abs(s.strike - spot) <= spot * 0.04);

    $('#chain-table tbody').innerHTML = around.map((s) => {
      const c = s.call || {};
      const p = s.put || {};
      const rowCls = [
        s.strike === atm ? 'atm' : '',
        s.strike === hiCall ? 'hi-call' : '',
        s.strike === hiPut ? 'hi-put' : '',
      ].filter(Boolean).join(' ');
      return `<tr class="${rowCls}">
        <td>${fmt(c.oi, 0)}</td><td class="${clsDir(c.oiChange)}">${fmt(c.oiChange, 0)}</td><td>${fmt(c.volume, 0)}</td><td>${fmt(c.iv)}</td>
        <td>${fmt(c.ltp)}</td><td class="${clsDir(c.change)}">${fmt(c.change)}</td>
        <td class="strike-col">${fmt(s.strike, 0)}${s.strike === atm ? ' ★' : ''}</td>
        <td class="${clsDir(p.change)}">${fmt(p.change)}</td><td>${fmt(p.ltp)}</td><td>${fmt(p.iv)}</td>
        <td>${fmt(p.volume, 0)}</td><td class="${clsDir(p.oiChange)}">${fmt(p.oiChange, 0)}</td><td>${fmt(p.oi, 0)}</td>
      </tr>`;
    }).join('');

    const maxOi = Math.max(1, ...around.map((s) => Math.max(s.call?.oi || 0, s.put?.oi || 0)));
    $('#oi-bars').innerHTML = around.map((s) => `
      <div class="oi-bar">
        <div>${fmt(s.strike, 0)}</div>
        <div class="c" style="width:${((s.call?.oi || 0) / maxOi) * 100}%"></div>
        <div class="p" style="width:${((s.put?.oi || 0) / maxOi) * 100}%"></div>
      </div>
    `).join('');

    if (oiOnly) showViewKeep('oi');
  }

  function showViewKeep(name) {
    $$('.view').forEach((v) => v.classList.toggle('active', v.dataset.view === name));
  }

  async function renderSmart() {
    const env = await api('/api/fno/smart-money?limit=40');
    $('#smart-table tbody').innerHTML = (env.data?.rows || []).map((r) => `
      <tr>
        <td>${escapeHtml(r.symbol)}</td>
        <td class="${clsDir(r.proxyScore)}">${r.proxyScore ?? r.score}</td>
        <td>${escapeHtml((r.smartMoney?.signals || [r.buildup]).slice(0, 2).join(', ').replace(/_/g, ' '))}</td>
        <td class="${clsDir(r.priceChangePct)}">${fmtPct(r.priceChangePct)}</td>
        <td class="${clsDir(r.oiChangePct)}">${fmtPct(r.oiChangePct)}</td>
        <td>${fmt(r.relativeVolume)}</td>
        <td title="${escapeHtml((r.smartMoney?.why || r.why || []).join(' | '))}">${escapeHtml((r.smartMoney?.why || r.why || []).slice(0, 3).join(' · '))}</td>
      </tr>
    `).join('');
  }

  async function renderSectors() {
    const env = await api('/api/fno/sectors');
    const body = $('#sector-table tbody');
    body.innerHTML = (env.data || []).map((s) => `
      <tr data-sector="${escapeHtml(s.sector)}">
        <td>${s.rank}</td>
        <td>${escapeHtml(s.sector)}</td>
        <td class="${clsDir(s.returnPct)}">${fmtPct(s.returnPct)}</td>
        <td class="${clsDir(s.avgOiChangePct)}">${fmtPct(s.avgOiChangePct)}</td>
        <td>${fmt(s.advanceDecline)}</td>
        <td>${s.longBuildupCount}</td>
        <td>${s.shortBuildupCount}</td>
        <td>${s.score}</td>
      </tr>
    `).join('');
    body.querySelectorAll('tr').forEach((tr) => {
      tr.addEventListener('click', async () => {
        const sector = tr.dataset.sector;
        const stocks = await api(`/api/fno/sectors/${encodeURIComponent(sector)}`);
        $('#sector-stocks').classList.remove('hidden');
        $('#sector-stocks-title').textContent = sector;
        $('#sector-stocks-table tbody').innerHTML = (stocks.data || []).map((r) => `
          <tr>
            <td>${escapeHtml(r.symbol)}</td>
            <td class="${clsDir(r.priceChangePct)}">${fmtPct(r.priceChangePct)}</td>
            <td class="${clsDir(r.oiChangePct)}">${fmtPct(r.oiChangePct)}</td>
            <td>${escapeHtml((r.buildup || '').replace(/_/g, ' '))}</td>
            <td class="${clsDir(r.score)}">${r.score}</td>
          </tr>
        `).join('');
      });
    });

    const scanSel = $('#scan-sector');
    if (scanSel && scanSel.options.length <= 1) {
      (env.data || []).forEach((s) => {
        const opt = document.createElement('option');
        opt.value = s.sector;
        opt.textContent = s.sector;
        scanSel.appendChild(opt);
      });
    }
  }

  async function renderScanner() {
    const sector = $('#scan-sector').value;
    const signal = $('#scan-signal').value;
    const qs = new URLSearchParams();
    if (sector) qs.set('sector', sector);
    if (signal) qs.set('signal', signal);
    const env = await api(`/api/fno/scanner?${qs}`);
    $('#scan-table tbody').innerHTML = (env.data || []).map((r, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${escapeHtml(r.symbol)}</td>
        <td>${escapeHtml(r.sector || '')}</td>
        <td>${fmt(r.ltp)}</td>
        <td class="${clsDir(r.priceChangePct)}">${fmtPct(r.priceChangePct)}</td>
        <td class="${clsDir(r.oiChangePct)}">${fmtPct(r.oiChangePct)}</td>
        <td>${fmt(r.relativeVolume)}</td>
        <td>${fmt(r.iv)}</td>
        <td>${escapeHtml((r.buildup || '').replace(/_/g, ' '))}</td>
        <td class="${clsDir(r.score)}">${r.score}</td>
      </tr>
    `).join('');
  }

  async function renderFii() {
    const env = await api('/api/fno/fii-dii');
    const d = env.data || {};
    const label = d.positioningRegime?.label || 'NEUTRAL';
    $('#fii-regime').innerHTML = `
      <div class="regime-main">
        <div class="k">FII POSITIONING REGIME</div>
        <div class="regime-label ${label}">${escapeHtml(label.replace(/_/g, ' '))}</div>
        <div class="muted">${escapeHtml(d.positioningRegime?.basis || '')}</div>
        <div class="muted">${escapeHtml(d.positioningRegime?.note || '')}</div>
      </div>`;
    const cash = d.cash || {};
    $('#fii-cash').innerHTML = [
      ['FII Net', cash.fiiNet != null ? fmt(cash.fiiNet) : '—'],
      ['DII Net', cash.diiNet != null ? fmt(cash.diiNet) : '—'],
      ['Unit', cash.unit || '—'],
      ['As of', cash.asOf || '—'],
    ].map(([k, v]) => `<div class="metric"><div class="k">${k}</div><div class="v">${escapeHtml(String(v))}</div></div>`).join('');

    const fut = d.futures || {};
    $('#fii-futures').innerHTML = `<strong>Index futures</strong>
      <ul>
        <li>Long: ${fut.indexFuturesLong ?? 'null (unavailable)'}</li>
        <li>Short: ${fut.indexFuturesShort ?? 'null (unavailable)'}</li>
        <li>Net: ${fut.netFutures ?? 'null'}</li>
        <li>${escapeHtml(fut.note || '')}</li>
      </ul>`;

    if (d.history) {
      $('#fii-history').innerHTML = `<table class="dense-table"><thead><tr><th>Window</th><th>FII Net</th><th>DII Net</th></tr></thead><tbody>
        ${Object.entries(d.history).map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td>${fmt(v.fiiNet)}</td><td>${fmt(v.diiNet)}</td></tr>`).join('')}
      </tbody></table>`;
    } else {
      $('#fii-history').innerHTML = '<p class="muted">Historical windows unavailable from live source.</p>';
    }
  }

  async function renderAlerts() {
    const rulesEnv = await api('/api/fno/alerts/rules');
    const rules = rulesEnv.rules || rulesEnv.data?.rules || {};
    $('#alerts-rules').innerHTML = Object.entries(rules).map(([k, v]) => `
      <div class="metric"><div class="k">${escapeHtml(k)}</div><div class="v">${escapeHtml(String(v))}</div></div>
    `).join('');
  }

  async function runAlerts() {
    const env = await api('/api/fno/alerts');
    $('#alerts-table tbody').innerHTML = (env.data?.alerts || []).map((a) => `
      <tr>
        <td>${escapeHtml(a.symbol)}</td>
        <td>${escapeHtml((a.reasons || []).join(' · '))}</td>
        <td>${escapeHtml((a.buildup || '').replace(/_/g, ' '))}</td>
        <td class="${clsDir(a.score)}">${a.score}</td>
      </tr>
    `).join('') || '<tr><td colspan="4">No alerts fired</td></tr>';
  }

  async function renderWatch() {
    const env = await api('/api/fno/watchlist');
    $('#watch-table tbody').innerHTML = (env.data || []).map((r) => `
      <tr>
        <td>${escapeHtml(r.symbol)}</td>
        <td>${fmt(r.ltp)}</td>
        <td class="${clsDir(r.priceChangePct)}">${fmtPct(r.priceChangePct)}</td>
        <td class="${clsDir(r.oiChangePct)}">${fmtPct(r.oiChangePct)}</td>
        <td>${fmt(r.volume, 0)}</td>
        <td>${escapeHtml((r.buildup || '').replace(/_/g, ' '))}</td>
        <td class="${clsDir(r.score)}">${r.score ?? '—'}</td>
        <td><button class="btn watch-del" data-sym="${escapeHtml(r.symbol)}">✕</button></td>
      </tr>
    `).join('');
    $$('.watch-del').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await fetch(`/api/fno/watchlist/${btn.dataset.sym}`, { method: 'DELETE' });
        renderWatch();
      });
    });
  }

  async function renderFuturesTable() {
    const env = await api('/api/fno/scanner');
    $('#futures-table tbody').innerHTML = (env.data || []).slice(0, 50).map((r) => `
      <tr>
        <td>${escapeHtml(r.symbol)}</td>
        <td>${fmt(r.ltp)}</td>
        <td class="${clsDir(r.priceChangePct)}">${fmtPct(r.priceChangePct)}</td>
        <td class="${clsDir(r.oiChangePct)}">${fmtPct(r.oiChangePct)}</td>
        <td>${fmt(r.volume, 0)}</td>
        <td>${fmt(r.iv)}</td>
      </tr>
    `).join('');
  }

  function wireNav() {
    $$('.bottom-nav [data-nav], #more-sheet [data-nav], [data-nav].linkish').forEach((btn) => {
      btn.addEventListener('click', () => {
        const nav = btn.dataset.nav;
        if (nav === 'more') {
          $('#more-sheet').classList.toggle('hidden');
          return;
        }
        showView(nav);
      });
    });
    $('#sheet-close')?.addEventListener('click', () => $('#more-sheet').classList.add('hidden'));
    $$('#buildup-seg button').forEach((btn) => {
      btn.addEventListener('click', () => {
        $$('#buildup-seg button').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        state.buildupSignal = btn.dataset.signal;
        renderIntel();
      });
    });
    $$('#legacy-seg button').forEach((btn) => {
      btn.addEventListener('click', () => {
        $$('#legacy-seg button').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        ['live', 'darvax', 'track', 'futures'].forEach((name) => {
          $(`#legacy-${name}`)?.classList.toggle('hidden', btn.dataset.legacy !== name);
        });
        if (btn.dataset.legacy === 'futures') renderFuturesTable();
        if (btn.dataset.legacy === 'darvax' && window.loadDarvaxScans) {
          window.loadDarvaxScans();
          window.loadPendingOrders?.();
        }
      });
    });
    $('#chain-underlying')?.addEventListener('change', async () => {
      await ensureExpiries();
      renderChain();
    });
    $('#chain-expiry')?.addEventListener('change', () => renderChain());
    $('#scan-sector')?.addEventListener('change', renderScanner);
    $('#scan-signal')?.addEventListener('change', renderScanner);
    $('#alerts-run')?.addEventListener('click', runAlerts);
    $('#watch-add')?.addEventListener('click', async () => {
      const symbol = $('#watch-input').value.trim().toUpperCase();
      if (!symbol) return;
      await fetch('/api/fno/watchlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol }),
      });
      $('#watch-input').value = '';
      renderWatch();
    });
    $('#btn-refresh')?.addEventListener('click', async () => {
      await renderTicker();
      await loadView(state.view);
    });
  }

  // Desktop: expand bottom nav with more destinations
  function expandDesktopNav() {
    if (window.matchMedia('(min-width: 900px)').matches) {
      const nav = $('.bottom-nav');
      const extras = ['oi', 'sectors', 'scanner', 'fii', 'alerts', 'watch', 'legacy'];
      extras.forEach((id) => {
        if (nav.querySelector(`[data-nav="${id}"]`)) return;
        const b = document.createElement('button');
        b.dataset.nav = id;
        b.innerHTML = `<span>·</span>${id}`;
        b.addEventListener('click', () => showView(id));
        nav.appendChild(b);
      });
    }
  }

  async function boot() {
    wireNav();
    expandDesktopNav();
    await renderTicker();
    await showView('overview');
    setInterval(renderTicker, 60_000);
  }

  window.FnoTerminal = { showView, refresh: boot };
  document.addEventListener('DOMContentLoaded', boot);
})();
