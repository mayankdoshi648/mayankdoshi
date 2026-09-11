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
    const data = env.data || {};
    if (data.disclaimer) $('#smart-disclaimer').textContent = data.disclaimer;

    const m = data.market || {};
    $('#smart-market-bias').textContent = m.bias || '—';
    $('#smart-market-bias').className = `v ${m.bias === 'BULLISH' ? 'up' : m.bias === 'BEARISH' ? 'down' : ''}`;
    $('#smart-market-score').textContent = m.score != null ? `${m.score >= 0 ? '+' : ''}${m.score}` : '—';
    $('#smart-market-score').className = `v ${clsDir(m.score)}`;
    $('#smart-market-conf').textContent = m.confidence != null ? `${m.confidence}%` : '—';

    $('#smart-indices').innerHTML = (data.indices || []).map((ix) => `
      <button type="button" class="index-chip" data-symbol="${escapeHtml(ix.symbol)}">
        <span class="sym">${escapeHtml(ix.symbol)}</span>
        <span class="sc ${clsDir(ix.score)}">${ix.score >= 0 ? '+' : ''}${ix.score ?? '—'}</span>
        <span class="cf">${ix.confidence != null ? `${ix.confidence}%` : '—'}</span>
      </button>
    `).join('');

    state.smartRankings = data.rankings || {};
    state.smartRankKey = state.smartRankKey || 'topLongs';
    bindSmartRankTabs();
    paintSmartTable(state.smartRankings[state.smartRankKey] || data.rows || []);

    $('#smart-indices').querySelectorAll('[data-symbol]').forEach((btn) => {
      btn.addEventListener('click', () => openSmartDetail(btn.dataset.symbol));
    });
    $('#smart-detail-close')?.addEventListener('click', () => {
      $('#smart-detail')?.classList.add('hidden');
    }, { once: true });
  }

  function bindSmartRankTabs() {
    const tabs = $('#smart-rank-tabs');
    if (!tabs || tabs.dataset.bound) return;
    tabs.dataset.bound = '1';
    tabs.querySelectorAll('[data-rank]').forEach((btn) => {
      btn.addEventListener('click', () => {
        tabs.querySelectorAll('[data-rank]').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        state.smartRankKey = btn.dataset.rank;
        paintSmartTable(state.smartRankings?.[state.smartRankKey] || []);
      });
    });
  }

  function paintSmartTable(rows) {
    $('#smart-table tbody').innerHTML = (rows || []).map((r, i) => `
      <tr data-symbol="${escapeHtml(r.symbol)}" class="smart-row">
        <td>${i + 1}</td>
        <td>${escapeHtml(r.symbol)}</td>
        <td class="${clsDir(r.score)}">${r.score != null ? `${r.score >= 0 ? '+' : ''}${r.score}` : '—'}</td>
        <td>${r.confidence != null ? `${r.confidence}%` : '—'}</td>
        <td>${escapeHtml(r.setup || r.signal || '')}</td>
        <td class="${clsDir(r.priceChangePct)}">${fmtPct(r.priceChangePct)}</td>
        <td class="${clsDir(r.oiChangePct)}">${fmtPct(r.oiChangePct)}</td>
        <td>${r.relativeVolume != null ? `${fmt(r.relativeVolume)}×` : '—'}</td>
        <td>${escapeHtml(r.vwapRelation || (r.vwap != null ? fmt(r.vwap) : '—'))}</td>
        <td>${escapeHtml(r.sector || '')}</td>
      </tr>
    `).join('');
    $('#smart-table tbody').querySelectorAll('tr[data-symbol]').forEach((tr) => {
      tr.addEventListener('click', () => openSmartDetail(tr.dataset.symbol));
    });
  }

  async function openSmartDetail(symbol) {
    const env = await api(`/api/fno/smart-money/${encodeURIComponent(symbol)}`);
    const d = env.data;
    if (!d) return;
    state.smartDetailSymbol = symbol;
    const panel = $('#smart-detail');
    const body = $('#smart-detail-body');
    $('#smart-detail-title').textContent = `${d.symbol} — Smart Money Proxy`;
    const comps = d.components || {};
    const q = d.quote || {};
    const list = (arr, cls) => (arr || []).map((f) => `<li class="${cls}">${escapeHtml(f.text || f)}</li>`).join('') || '<li>—</li>';
    const compBlock = (id, title) => {
      const c = comps[id];
      if (!c) return '';
      const avail = c.available ? '' : ' <em class="muted">(unavailable — confidence reduced)</em>';
      return `<div class="analysis-block">
        <h3 class="section-label">${escapeHtml(title)}${avail}</h3>
        <p><span class="${clsDir(c.score)}">${c.score >= 0 ? '+' : ''}${c.score}</span> / ${c.max}</p>
        <ul>${(c.reasons || []).map((r) => `<li>${escapeHtml(r)}</li>`).join('') || '<li>—</li>'}</ul>
      </div>`;
    };
    const tfLabels = d.timeframes?.labels || {};
    const tfChips = Object.entries(tfLabels).map(([k, v]) => {
      const cls = /Bullish/i.test(v) ? 'up' : /Bearish/i.test(v) ? 'down' : '';
      return `<span class="tf-chip ${cls}"><strong>${escapeHtml(k)}</strong> ${escapeHtml(v)}</span>`;
    }).join('');

    body.innerHTML = `
      <p class="disclaimer-inline">${escapeHtml(d.disclaimer || '')}</p>
      <div class="smart-detail-scoreline">
        <div><span class="k">Score</span><span class="v ${clsDir(d.score)}">${d.score >= 0 ? '+' : ''}${d.score}</span></div>
        <div><span class="k">Confidence</span><span class="v">${d.confidence}%</span></div>
        <div><span class="k">Signal</span><span class="v">${escapeHtml(d.signal || '')}</span></div>
        <div><span class="k">Setup</span><span class="v">${escapeHtml(d.setup || '')}</span></div>
        <div><span class="k">Quality</span><span class="v">${escapeHtml(d.quality || '')}</span></div>
      </div>
      ${d.conflicting ? '<p class="conflict-banner">CONFLICTING SIGNALS — confidence reduced</p>' : ''}
      <h3 class="section-label">WHY?</h3>
      <pre class="smart-why">${escapeHtml(d.explanation || (d.why || []).join('\n'))}</pre>

      <h3 class="section-label">Quote snapshot</h3>
      <div class="metrics-row">
        <div class="metric"><div class="k">LTP</div><div class="v">${fmt(q.ltp)}</div></div>
        <div class="metric"><div class="k">Price%</div><div class="v ${clsDir(q.priceChangePct)}">${fmtPct(q.priceChangePct)}</div></div>
        <div class="metric"><div class="k">OI%</div><div class="v ${clsDir(q.oiChangePct)}">${fmtPct(q.oiChangePct)}</div></div>
        <div class="metric"><div class="k">RVol</div><div class="v">${q.relativeVolume != null ? `${fmt(q.relativeVolume)}×` : '—'}</div></div>
        <div class="metric"><div class="k">VWAP</div><div class="v">${escapeHtml(q.vwapRelation || (q.vwap != null ? fmt(q.vwap) : '—'))}</div></div>
        <div class="metric"><div class="k">Sector</div><div class="v">${escapeHtml(q.sector || '—')}</div></div>
      </div>

      ${compBlock('priceOi', 'Price / OI analysis')}
      ${compBlock('volume', 'Volume analysis')}
      ${compBlock('vwap', 'VWAP analysis')}
      ${compBlock('options', 'Options analysis')}
      ${compBlock('sector', 'Sector analysis')}
      ${compBlock('fii', 'FII / institutional (index-level)')}
      ${compBlock('momentum', 'Momentum / persistence')}

      <h3 class="section-label">Multi-timeframe</h3>
      <p><strong>${escapeHtml(d.timeframes?.overall || 'NEUTRAL')}</strong></p>
      <div class="tf-row">${tfChips || '<span class="muted">Timeframe history limited</span>'}</div>

      <div class="factor-grid">
        <div><h3 class="section-label">Bullish factors</h3><ul>${list(d.bullishFactors, 'up')}</ul></div>
        <div><h3 class="section-label">Bearish factors</h3><ul>${list(d.bearishFactors, 'down')}</ul></div>
        <div><h3 class="section-label">Conflicting factors</h3><ul>${list(d.conflictingFactors, 'warn')}</ul></div>
      </div>

      <h3 class="section-label">Score history</h3>
      <div class="smart-tabs" id="smart-hist-tabs" role="tablist">
        ${['1D', '5D', '10D', '1M'].map((r) => `<button type="button" data-hist="${r}" class="${r === '5D' ? 'active' : ''}">${r}</button>`).join('')}
      </div>
      <p class="muted" id="smart-hist-trend">Trend: ${escapeHtml(d.history?.trend || '—')}</p>
      <div class="table-wrap">
        <table id="smart-hist-table" class="dense-table">
          <thead><tr><th>Time</th><th>Score</th><th>Conf%</th><th>Price%</th><th>OI%</th><th>RVol</th></tr></thead>
          <tbody></tbody>
        </table>
      </div>
      <div id="smart-hist-spark" class="smart-spark" aria-hidden="true"></div>

      <h3 class="section-label">Final interpretation</h3>
      <p>${escapeHtml(d.interpretation || '')}</p>
      <p class="muted">Positioning proxy only — not a BUY/SELL recommendation and not proof of institutional intent.</p>
    `;

    paintSmartHistory(d.history);
    const histTabs = $('#smart-hist-tabs');
    histTabs?.querySelectorAll('[data-hist]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        histTabs.querySelectorAll('[data-hist]').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        const hist = await api(`/api/fno/smart-money/${encodeURIComponent(symbol)}/history?range=${btn.dataset.hist}`);
        paintSmartHistory(hist.data || hist);
      });
    });

    panel.classList.remove('hidden');
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function paintSmartHistory(history) {
    const h = history || { points: [], trend: '—' };
    const trendEl = $('#smart-hist-trend');
    if (trendEl) trendEl.textContent = `Trend: ${h.trend || '—'} · ${h.points?.length || 0} point(s)${!(h.points?.length) ? ' — accumulates as market data refreshes' : ''}`;
    const tbody = $('#smart-hist-table tbody');
    if (!tbody) return;
    const pts = [...(h.points || [])].reverse().slice(0, 40);
    tbody.innerHTML = pts.length
      ? pts.map((p) => {
        const t = p.at ? new Date(p.at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '—';
        return `<tr>
          <td>${escapeHtml(t)}</td>
          <td class="${clsDir(p.score)}">${p.score >= 0 ? '+' : ''}${p.score}</td>
          <td>${p.confidence != null ? `${p.confidence}%` : '—'}</td>
          <td class="${clsDir(p.priceChangePct)}">${fmtPct(p.priceChangePct)}</td>
          <td class="${clsDir(p.oiChangePct)}">${fmtPct(p.oiChangePct)}</td>
          <td>${p.relativeVolume != null ? `${fmt(p.relativeVolume)}×` : '—'}</td>
        </tr>`;
      }).join('')
      : '<tr><td colspan="6">No stored proxy scores yet for this range</td></tr>';

    const spark = $('#smart-hist-spark');
    if (spark) {
      const series = (h.points || []).map((p) => Number(p.score)).filter((n) => Number.isFinite(n));
      if (series.length >= 2) {
        const min = Math.min(...series, -100);
        const max = Math.max(...series, 100);
        const span = Math.max(1, max - min);
        spark.innerHTML = series.map((s) => {
          const hgt = Math.round(((s - min) / span) * 100);
          return `<i style="height:${Math.max(4, hgt)}%" class="${s >= 0 ? 'up' : 'down'}" title="${s}"></i>`;
        }).join('');
      } else {
        spark.innerHTML = '';
      }
    }
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
        <td class="${clsDir(a.smartMoneyScore)}">${a.smartMoneyScore != null ? `${a.smartMoneyScore >= 0 ? '+' : ''}${a.smartMoneyScore}` : '—'}</td>
        <td>${a.smartMoneyConfidence != null ? `${a.smartMoneyConfidence}%` : '—'}</td>
      </tr>
    `).join('') || '<tr><td colspan="6">No alerts fired</td></tr>';
  }

  async function renderWatch() {
    const env = await api('/api/fno/watchlist');
    $('#watch-table tbody').innerHTML = (env.data || []).map((r) => {
      const sm = r.smartMoney || {};
      const smScore = sm.score ?? r.smartMoneyScore ?? null;
      const smConf = sm.confidence ?? r.smartMoneyConfidence ?? null;
      return `
      <tr class="smart-row" data-symbol="${escapeHtml(r.symbol)}">
        <td>${escapeHtml(r.symbol)}</td>
        <td>${fmt(r.ltp)}</td>
        <td class="${clsDir(r.priceChangePct)}">${fmtPct(r.priceChangePct)}</td>
        <td class="${clsDir(r.oiChangePct)}">${fmtPct(r.oiChangePct)}</td>
        <td>${fmt(r.volume, 0)}</td>
        <td>${escapeHtml((r.buildup || '').replace(/_/g, ' '))}</td>
        <td class="${clsDir(smScore)}">${smScore != null ? `${smScore >= 0 ? '+' : ''}${smScore}` : '—'}</td>
        <td>${smConf != null ? `${smConf}%` : '—'}</td>
        <td><button class="btn watch-del" data-sym="${escapeHtml(r.symbol)}">✕</button></td>
      </tr>`;
    }).join('');
    $$('#watch-table tbody tr[data-symbol]').forEach((tr) => {
      tr.addEventListener('click', async () => {
        state.view = 'smart';
        $$('.view').forEach((v) => v.classList.toggle('active', v.dataset.view === 'smart'));
        $$('.bottom-nav [data-nav]').forEach((b) => b.classList.toggle('active', b.dataset.nav === 'smart'));
        await renderSmart();
        await openSmartDetail(tr.dataset.symbol);
      });
    });
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
