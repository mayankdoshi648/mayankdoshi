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
      if (name === 'heatmap') await renderHeatmap();
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

  function updateMarketSession() {
    const el = $('#market-session');
    if (!el) return;
    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(now);
    const map = Object.fromEntries(parts.filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]));
    const mins = Number(map.hour) * 60 + Number(map.minute);
    const weekday = map.weekday;
    const isWeekend = weekday === 'Sat' || weekday === 'Sun';
    const open = !isWeekend && mins >= 9 * 60 + 15 && mins <= 15 * 60 + 30;
    el.textContent = open ? 'MARKET OPEN ●' : 'MARKET CLOSED ○';
    el.className = `market-session ${open ? 'open' : 'closed'}`;
  }

  function whyMark(ok) {
    return ok ? '<span class="why-ok">✓</span>' : '<span class="why-na">·</span>';
  }

  function signalListHtml(rows, limit = 5) {
    return (rows || []).slice(0, limit).map((r) => `
      <button type="button" class="signal-row" data-symbol="${escapeHtml(r.symbol)}">
        <span class="sym">${escapeHtml(r.symbol)}</span>
        <span class="sc ${clsDir(r.score)}">${r.score >= 0 ? '+' : ''}${r.score ?? '—'}</span>
        <span class="cf">${r.confidence != null ? `${r.confidence}%` : ''}</span>
      </button>
    `).join('') || '<div class="muted">No signals</div>';
  }

  function bindSymbolButtons(root) {
    root?.querySelectorAll('[data-symbol]').forEach((btn) => {
      btn.addEventListener('click', () => openSmartDetail(btn.dataset.symbol));
    });
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
    updateMarketSession();
    const [env, sm, sectors, alerts] = await Promise.all([
      api('/api/fno/overview'),
      api('/api/fno/smart-money?limit=8'),
      api('/api/fno/sectors').catch(() => ({ data: [] })),
      api('/api/fno/alerts').catch(() => ({ data: { alerts: [] } })),
    ]);

    const regime = env.data?.regime || {};
    const label = $('#regime-label');
    label.textContent = (regime.label || '—').replace(/_/g, ' ');
    label.className = `regime-label ${regime.label || ''}`;
    $('#regime-score').textContent = regime.score != null ? `${regime.score >= 0 ? '+' : ''}${regime.score}` : '—';
    $('#regime-conf').textContent = regime.confidence != null
      ? `${regime.confidence <= 1 ? Math.round(regime.confidence * 100) : Math.round(regime.confidence)}%`
      : '—';
    $('#regime-factors').innerHTML = (regime.factors || []).map((f) => {
      const ok = !/missing|unavailable|null|unknown/i.test(String(f.evidence || ''));
      return `<div class="factor check"><span class="n">${escapeHtml(f.name)}</span>${whyMark(ok)}<span class="e">${escapeHtml(f.evidence)}</span></div>`;
    }).join('') || '<div class="muted">No factors available</div>';

    const snap = env.data?.optionSnapshot;
    const opt = $('#overview-opt');
    if (!snap) {
      opt.innerHTML = '<div class="muted">Option snapshot unavailable</div>';
      $('#overview-interp').innerHTML = '';
    } else {
      opt.innerHTML = [
        ['PCR', fmt(snap.pcr)],
        ['Max Pain', fmt(snap.maxPain, 0)],
        ['ATM IV', snap.atm?.iv != null ? `${fmt(snap.atm.iv)}%` : '—'],
        ['Support', snap.interpretation?.putSupport || snap.atm?.strike || '—'],
        ['Resistance', snap.interpretation?.callResistance || '—'],
        ['Exp Move', snap.expectedMove ? `±${fmt(snap.expectedMove.move, 0)}` : '—'],
      ].map(([k, v]) => `<div class="metric"><div class="k">${k}</div><div class="v">${escapeHtml(String(v))}</div></div>`).join('');
      const ev = snap.interpretation?.evidence || [];
      $('#overview-interp').innerHTML = `<strong>${escapeHtml(snap.interpretation?.summary || '')}</strong><ul>${ev.slice(0, 3).map((e) => `<li>${escapeHtml(e)}</li>`).join('')}</ul>`;
    }

    const indices = sm.data?.indices || [];
    $('#home-sm-indices').innerHTML = indices.map((ix) => `
      <button type="button" class="home-ix" data-symbol="${escapeHtml(ix.symbol)}">
        <span class="sym">${escapeHtml(ix.symbol)}</span>
        <span class="sc ${clsDir(ix.score)}">${ix.score >= 0 ? '+' : ''}${ix.score ?? '—'}</span>
        <span class="setup">${escapeHtml(ix.setup || ix.signal || '')}</span>
        <span class="cf">${ix.confidence != null ? `${ix.confidence}%` : ''}</span>
      </button>
    `).join('') || '<div class="muted">Index proxy unavailable</div>';
    bindSymbolButtons($('#home-sm-indices'));

    $('#home-top-longs').innerHTML = signalListHtml(sm.data?.rankings?.topLongs);
    $('#home-top-shorts').innerHTML = signalListHtml(sm.data?.rankings?.topShorts);
    bindSymbolButtons($('#home-top-longs'));
    bindSymbolButtons($('#home-top-shorts'));

    const chips = [
      ['LONG BUILDUP', 'LONG_BUILDUP'],
      ['SHORT BUILDUP', 'SHORT_BUILDUP'],
      ['SHORT COVERING', 'SHORT_COVERING'],
      ['LONG UNWINDING', 'LONG_UNWINDING'],
    ];
    $('#home-fo-chips').innerHTML = chips.map(([labelText, sig]) => `
      <button type="button" class="fo-chip" data-signal="${sig}">${labelText}</button>
    `).join('');
    $('#home-fo-chips').querySelectorAll('[data-signal]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.buildupSignal = btn.dataset.signal;
        showView('intel');
      });
    });

    $('#overview-sectors').innerHTML = (sectors.data || []).slice(0, 5).map((s) => `
      <button type="button" class="sector-rank-row" data-sector="${escapeHtml(s.sector)}">
        <span class="rk">${s.rank}</span>
        <span class="nm">${escapeHtml(s.sector)}</span>
        <span class="${clsDir(s.returnPct)}">${fmtPct(s.returnPct)}</span>
        <span class="sc">${s.score}</span>
      </button>
    `).join('') || '<div class="muted">No sector data</div>';
    $('#overview-sectors').querySelectorAll('[data-sector]').forEach((btn) => {
      btn.addEventListener('click', () => {
        showView('heatmap');
        state.pendingHeatSector = btn.dataset.sector;
      });
    });

    const feed = (alerts.data?.alerts || []).slice(0, 5);
    $('#home-alerts').innerHTML = feed.length
      ? feed.map((a) => `
        <button type="button" class="alert-row" data-symbol="${escapeHtml(a.symbol)}">
          <span class="sym">${escapeHtml(a.symbol)}</span>
          <span class="msg">${escapeHtml((a.reasons || []).slice(0, 2).join(' · '))}</span>
          <span class="sc ${clsDir(a.smartMoneyScore ?? a.score)}">${a.smartMoneyScore != null ? `${a.smartMoneyScore >= 0 ? '+' : ''}${a.smartMoneyScore}` : (a.score ?? '')}</span>
        </button>
      `).join('')
      : '<div class="muted">No alerts fired yet — run from Alerts</div>';
    bindSymbolButtons($('#home-alerts'));

    $$('[data-jump]').forEach((btn) => {
      btn.onclick = () => showView(btn.dataset.jump);
    });
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
        const sym = tr.querySelector('td')?.textContent?.trim();
        if (sym) openSmartDetail(sym);
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
      const panel = $('#smart-detail');
      panel?.classList.add('hidden');
      panel?.classList.remove('floating-drawer');
      const host = $('#smart-detail-host');
      if (panel && host && panel.parentElement === document.body) host.appendChild(panel);
    });
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
    const host = $('#smart-detail-host') || panel.parentElement;
    if (panel.parentElement !== document.body && state.view !== 'smart') {
      document.body.appendChild(panel);
      panel.classList.add('floating-drawer');
    } else if (state.view === 'smart' && host && panel.parentElement === document.body) {
      host.appendChild(panel);
      panel.classList.remove('floating-drawer');
    }
    $('#smart-detail-title').textContent = d.symbol;
    const comps = d.components || {};
    const q = d.quote || {};
    const list = (arr, empty) => (arr || []).length
      ? (arr || []).map((f) => `<li>✓ ${escapeHtml(f.text || f)}</li>`).join('')
      : `<li class="muted">${escapeHtml(empty)}</li>`;

    const whyRows = [
      ['Price', q.priceChangePct != null ? fmtPct(q.priceChangePct) : '—', comps.priceOi?.available && Math.abs(comps.priceOi.score) >= 2],
      ['OI', q.oiChangePct != null ? fmtPct(q.oiChangePct) : '—', comps.priceOi?.available && Math.abs(Number(comps.priceOi.detail?.oiChangePct || 0)) >= 0.5],
      ['Relative Volume', q.relativeVolume != null ? `${fmt(q.relativeVolume)}×` : '—', comps.volume?.available && comps.volume.detail?.bucket !== 'weak'],
      ['VWAP', q.vwapRelation || (comps.vwap?.detail?.distancePct != null ? (comps.vwap.detail.distancePct >= 0 ? 'Above' : 'Below') : '—'), comps.vwap?.available && Math.abs(comps.vwap.score) >= 1],
      ['Sector', (comps.sector?.reasons?.[0] || '—').replace(/^Sector:\s*/i, ''), comps.sector?.available && comps.sector.detail?.aligned],
      ['Options', comps.options?.available ? (comps.options.reasons?.[0] || 'Present') : 'Unavailable', comps.options?.available && Math.abs(comps.options.score) >= 1],
      ['FII', comps.fii?.available ? (comps.fii.reasons?.[0] || 'Present') : 'Unavailable / not applied', comps.fii?.available && Math.abs(comps.fii.score) >= 1],
    ];

    const tfLabels = d.timeframes?.labels || {};
    const tfList = Object.entries(tfLabels).map(([k, v]) => {
      const cls = /Bullish/i.test(v) ? 'up' : /Bearish/i.test(v) ? 'down' : '';
      const mark = /Bullish/i.test(v) ? '🟢' : /Bearish/i.test(v) ? '🔴' : '⚪';
      return `<div class="tf-line ${cls}"><span>${escapeHtml(k)}</span><span>${mark} ${escapeHtml(v)}</span></div>`;
    }).join('');

    body.innerHTML = `
      <p class="disclaimer-inline tiny">${escapeHtml(d.disclaimer || '')}</p>
      <div class="drill-hero">
        <div>
          <div class="drill-ltp">${fmt(q.ltp)}</div>
          <div class="drill-chg ${clsDir(q.priceChangePct)}">${fmtPct(q.priceChangePct)}</div>
        </div>
        <div class="drill-sm">
          <div class="k">Smart Money</div>
          <div class="v ${clsDir(d.score)}">${d.score >= 0 ? '+' : ''}${d.score}</div>
          <div class="cf">Confidence ${d.confidence}%</div>
        </div>
      </div>
      <div class="analysis-block setup-block">
        <div class="k">Primary setup</div>
        <div class="v ${clsDir(d.score)}">${escapeHtml(d.signal || '')} · ${escapeHtml(d.setup || '')}</div>
        <div class="muted">Quality ${escapeHtml(d.quality || '—')}</div>
      </div>
      ${d.conflicting ? '<p class="conflict-banner">CONFLICTING SIGNALS — confidence reduced</p>' : ''}
      <h3 class="section-label">WHY?</h3>
      <div class="why-table">
        ${whyRows.map(([name, val, ok]) => `
          <div class="why-row">
            <span class="n">${escapeHtml(name)}</span>
            <span class="val">${escapeHtml(String(val))}</span>
            ${whyMark(Boolean(ok))}
          </div>
        `).join('')}
      </div>
      <h3 class="section-label">Timeframe</h3>
      <div class="tf-list">${tfList || '<div class="muted">Multi-timeframe history limited — session proxy only</div>'}</div>
      <p><strong>MULTI-TIMEFRAME: ${escapeHtml(d.timeframes?.overall || 'NEUTRAL')}</strong></p>
      <div class="factor-grid">
        <div><h3 class="section-label">Bullish factors</h3><ul>${list(d.bullishFactors, 'None significant')}</ul></div>
        <div><h3 class="section-label">Bearish factors</h3><ul>${list(d.bearishFactors, 'None significant')}</ul></div>
        <div><h3 class="section-label">Conflicts</h3><ul>${list(d.conflictingFactors, 'None significant')}</ul></div>
      </div>
      <h3 class="section-label">Component breakdown</h3>
      <ul class="smart-comps">
        ${Object.entries(comps).map(([id, c]) => `
          <li><strong>${escapeHtml(id)}</strong>: <span class="${clsDir(c.score)}">${c.score}</span>/${c.max}
          ${c.available ? '' : ' <em>(unavailable)</em>'}
          — ${escapeHtml((c.reasons || []).slice(0, 1).join('; '))}</li>
        `).join('')}
      </ul>
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
      <p class="muted">Positioning proxy only — not a BUY/SELL recommendation.</p>
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

  async function renderHeatmap() {
    const [sectorsEnv, smEnv] = await Promise.all([
      api('/api/fno/sectors'),
      api('/api/fno/smart-money?limit=80'),
    ]);
    const rows = smEnv.data?.rows || [];
    const bySector = new Map();
    for (const r of rows) {
      const sector = r.sector || 'OTHER';
      if (!bySector.has(sector)) bySector.set(sector, []);
      bySector.get(sector).push(r);
    }

    const sectors = (sectorsEnv.data || []).map((s) => {
      const stocks = bySector.get(s.sector) || [];
      const avgSm = stocks.length
        ? Math.round(stocks.reduce((a, x) => a + (x.score || 0), 0) / stocks.length)
        : Math.round(((s.score || 50) - 50) * 2);
      return { ...s, smartScore: avgSm, stocks: stocks.sort((a, b) => (b.score || 0) - (a.score || 0)) };
    }).sort((a, b) => b.smartScore - a.smartScore);

    state.heatmapSectors = sectors;
    const maxAbs = Math.max(1, ...sectors.map((s) => Math.abs(s.smartScore)));
    $('#heatmap-list').innerHTML = `
      <div class="hm-axis">VERY BULLISH ↑</div>
      ${sectors.map((s) => {
        const width = Math.round((Math.abs(s.smartScore) / maxAbs) * 100);
        const dir = s.smartScore >= 0 ? 'bull' : 'bear';
        return `<button type="button" class="hm-row ${dir}" data-sector="${escapeHtml(s.sector)}">
          <span class="nm">${escapeHtml(s.sector)}</span>
          <span class="bar-wrap"><span class="bar" style="width:${width}%"></span></span>
          <span class="sc ${clsDir(s.smartScore)}">${s.smartScore >= 0 ? '+' : ''}${s.smartScore}</span>
        </button>`;
      }).join('')}
      <div class="hm-axis">↓ VERY BEARISH</div>
    `;

    $('#heatmap-list').querySelectorAll('[data-sector]').forEach((btn) => {
      btn.addEventListener('click', () => openHeatmapSector(btn.dataset.sector));
    });

    $('#heatmap-sector-close')?.addEventListener('click', () => {
      $('#heatmap-sector')?.classList.add('hidden');
    }, { once: true });

    if (state.pendingHeatSector) {
      const sec = state.pendingHeatSector;
      state.pendingHeatSector = null;
      openHeatmapSector(sec);
    }
  }

  function openHeatmapSector(sector) {
    const s = (state.heatmapSectors || []).find((x) => x.sector === sector);
    const panel = $('#heatmap-sector');
    if (!s || !panel) return;
    $('#heatmap-sector-title').textContent = sector;
    $('#heatmap-sector-score').textContent = `Sector Smart Money avg ${s.smartScore >= 0 ? '+' : ''}${s.smartScore} · strength score ${s.score}`;
    $('#heatmap-sector-stocks').innerHTML = signalListHtml(s.stocks, 20);
    bindSymbolButtons($('#heatmap-sector-stocks'));
    panel.classList.remove('hidden');
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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
      const extras = ['heatmap', 'oi', 'sectors', 'scanner', 'fii', 'alerts', 'watch', 'legacy'];
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
    updateMarketSession();
    setInterval(updateMarketSession, 30_000);
    wireNav();
    expandDesktopNav();
    await renderTicker();
    await showView('overview');
    setInterval(renderTicker, 60_000);
  }

  window.FnoTerminal = { showView, refresh: boot };
  document.addEventListener('DOMContentLoaded', boot);
})();
