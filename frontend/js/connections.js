/* frontend/js/connections.js — connection pill, data dialog, URL bootstrap (no token retention) */
(function () {
  const $ = (sel, el = document) => el.querySelector(sel);

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[ch]));
  }

  function fmtTime(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' });
    } catch {
      return '—';
    }
  }

  function pillClass(overall) {
    const s = String(overall || '');
    if (/ERROR/i.test(s)) return 'err';
    if (/PARTIAL/i.test(s)) return 'warn';
    if (/CONNECTED/i.test(s)) return 'ok';
    return '';
  }

  function paintPill(snapshot) {
    const pill = $('#conn-pill');
    if (!pill || !snapshot) return;
    const label = snapshot.marketOpen === false && /CONNECTED/i.test(snapshot.overall || '')
      ? `${snapshot.overall} · MARKET CLOSED`
      : (snapshot.overall || 'DATA …');
    pill.textContent = `● ${label}`;
    pill.classList.remove('ok', 'warn', 'err');
    const cls = pillClass(snapshot.overall);
    if (cls) pill.classList.add(cls);
  }

    function paintDialog(snapshot, health) {
    const body = $('#conn-dialog-body');
    if (!body || !snapshot) return;
    const dhan = snapshot.sources?.dhan || {};
    const nse = snapshot.sources?.nse || {};
    const ws = snapshot.sources?.websocket || {};
    const hDhan = health?.dhan || {};
    const hNse = health?.nse || {};
    const cache = health?.cache || {};
    const age = health?.lastSuccessfulUpdateAgeSeconds;
    const ageLabel = age == null ? '—' : (age < 60 ? `${age}s ago` : `${Math.round(age / 60)}m ago`);
    const dhanReqOk = hDhan.requests?.successful ?? 0;
    const dhanReqFail = hDhan.requests?.failed ?? 0;
    body.innerHTML = `
      <div class="conn-row"><span>Overall</span><strong>${escapeHtml(health?.overall || snapshot.overall)}</strong></div>
      <div class="conn-row"><span>Market</span><strong>${snapshot.marketOpen ? 'OPEN' : 'CLOSED'}</strong></div>
      <div class="conn-row"><span>Dhan API</span><strong>${escapeHtml(hDhan.status || (dhan.status || (snapshot.authenticated ? 'connected' : 'disconnected')).toUpperCase())}</strong></div>
      <div class="conn-row"><span>NSE</span><strong>${escapeHtml(hNse.status || (nse.status || 'unknown').toUpperCase())}</strong></div>
      <div class="conn-row"><span>Last successful update</span><strong>${escapeHtml(ageLabel)}</strong></div>
      <div class="conn-row"><span>Dhan requests</span><strong>${escapeHtml(`${dhanReqOk} ok / ${dhanReqFail} fail`)}</strong></div>
      <div class="conn-row"><span>Cache</span><strong>${escapeHtml(cache.label || '—')} · ${cache.hits ?? 0} hit / ${cache.misses ?? 0} miss</strong></div>
      <div class="conn-row"><span>Equity WebSocket</span><strong>${ws.connected ? 'CONNECTED' : 'DISCONNECTED'}</strong></div>
      <div class="conn-row"><span>Latest market data</span><strong>${escapeHtml(fmtTime(health?.lastSuccessfulUpdateAt || dhan.lastSuccessAt))}</strong></div>
      <p class="tiny muted">Auth mode: ${escapeHtml(snapshot.authMode || '—')}. Tokens are never shown here.</p>
      ${hDhan.lastError || dhan.lastError ? `<p class="tiny err-text">${escapeHtml(hDhan.lastError || dhan.lastError)}</p>` : ''}
      ${hNse.lastError || nse.lastError ? `<p class="tiny err-text">${escapeHtml(hNse.lastError || nse.lastError)}</p>` : ''}
    `;
  }

async function refreshConnections() {
    try {
      const resp = await fetch('/api/data-connections', { credentials: 'include' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const snapshot = await resp.json();
      let health = null;
      try {
        const hr = await fetch('/api/data-health', { credentials: 'include' });
        if (hr.ok) health = await hr.json();
      } catch (_) { /* optional */ }
      paintPill(health ? { ...snapshot, overall: health.overall || snapshot.overall } : snapshot);
      paintDialog(snapshot, health);
      const badge = $('#dhan-connected-badge');
      if (badge) {
        const on = Boolean(snapshot.authenticated || /DHAN/i.test(snapshot.overall || ''));
        badge.classList.toggle('hidden', !on);
      }
      return snapshot;
    } catch {
      paintPill({ overall: 'DATA ERROR', marketOpen: null });
      return null;
    }
  }

  async function bootstrapFromQuery() {
    const params = new URLSearchParams(window.location.search);
    const clientId = params.get('client_id') || params.get('clientId');
    const token = params.get('token') || params.get('access_token') || params.get('accessToken');
    if (!clientId && !token) return;

    // Always strip secrets from the visible URL immediately.
    const clean = `${window.location.pathname}${window.location.hash || ''}`;
    window.history.replaceState({}, document.title, clean || '/');

    if (!clientId || !token) return;
    try {
      await fetch('/api/fno/credentials/dhan', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId,
          accessToken: token,
          persistEnv: false,
        }),
      });
    } catch {
      /* ignore — user can connect via More → Dhan API */
    } finally {
      // Drop local references ASAP
      params.delete('token');
      params.delete('access_token');
      params.delete('accessToken');
    }
    await refreshConnections();
  }

  async function openDebug() {
    const dlg = $('#debug-dialog');
    const body = $('#debug-dialog-body');
    if (!dlg || !body) return;
    try {
      const [conn, status, dhan, health] = await Promise.all([
        fetch('/api/data-connections', { credentials: 'include' }).then((r) => r.json()),
        fetch('/api/status', { credentials: 'include' }).then((r) => r.json()),
        fetch('/api/fno/credentials/dhan', { credentials: 'include' }).then((r) => r.json()).catch(() => null),
        fetch('/api/data-health', { credentials: 'include' }).then((r) => r.json()).catch(() => null),
      ]);
      body.textContent = JSON.stringify({
        dataHealth: health,
        connections: conn,
        status: {
          marketOpen: status.marketOpen,
          feedConnected: status.feedConnected,
          hasDhan: status.hasDhan,
          dashboardMode: status.dashboardMode,
          auth: status.auth ? {
            hasCredentials: status.auth.hasCredentials,
            authenticated: status.auth.authenticated,
            mode: status.auth.mode,
            authMode: status.auth.authMode,
            expiryTime: status.auth.expiryTime,
            lastError: status.auth.lastError,
          } : null,
        },
        dhan: dhan?.data || dhan,
      }, null, 2);
    } catch (err) {
      body.textContent = String(err.message || err);
    }
    if (typeof dlg.showModal === 'function') dlg.showModal();
  }

  function wire() {
    $('#conn-pill')?.addEventListener('click', async () => {
      await refreshConnections();
      const dlg = $('#conn-dialog');
      if (dlg && typeof dlg.showModal === 'function') dlg.showModal();
    });
    $('#conn-open-debug')?.addEventListener('click', (ev) => {
      ev.preventDefault();
      openDebug();
    });
    bootstrapFromQuery().then(() => refreshConnections());
    setInterval(refreshConnections, 30_000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire);
  } else {
    wire();
  }
})();
