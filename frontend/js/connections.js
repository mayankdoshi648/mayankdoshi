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

  function paintDialog(snapshot) {
    const body = $('#conn-dialog-body');
    if (!body || !snapshot) return;
    const dhan = snapshot.sources?.dhan || {};
    const nse = snapshot.sources?.nse || {};
    const ws = snapshot.sources?.websocket || {};
    body.innerHTML = `
      <div class="conn-row"><span>Overall</span><strong>${escapeHtml(snapshot.overall)}</strong></div>
      <div class="conn-row"><span>Market</span><strong>${snapshot.marketOpen ? 'OPEN' : 'CLOSED'}</strong></div>
      <div class="conn-row"><span>Dhan</span><strong>${escapeHtml((dhan.status || (snapshot.authenticated ? 'connected' : 'disconnected')).toUpperCase())}</strong></div>
      <div class="conn-row"><span>NSE</span><strong>${escapeHtml((nse.status || 'unknown').toUpperCase())}</strong></div>
      <div class="conn-row"><span>Equity WebSocket</span><strong>${ws.connected ? 'CONNECTED' : 'DISCONNECTED'}</strong></div>
      <div class="conn-row"><span>Last Dhan update</span><strong>${escapeHtml(fmtTime(dhan.lastSuccessAt))}</strong></div>
      <div class="conn-row"><span>Last NSE update</span><strong>${escapeHtml(fmtTime(nse.lastSuccessAt))}</strong></div>
      <p class="tiny muted">Auth mode: ${escapeHtml(snapshot.authMode || '—')}. Tokens are never shown here.</p>
      ${dhan.lastError ? `<p class="tiny err-text">${escapeHtml(dhan.lastError)}</p>` : ''}
      ${nse.lastError ? `<p class="tiny err-text">${escapeHtml(nse.lastError)}</p>` : ''}
    `;
  }

  async function refreshConnections() {
    try {
      const resp = await fetch('/api/data-connections');
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const snapshot = await resp.json();
      paintPill(snapshot);
      paintDialog(snapshot);
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
      const [conn, status, dhan] = await Promise.all([
        fetch('/api/data-connections').then((r) => r.json()),
        fetch('/api/status').then((r) => r.json()),
        fetch('/api/fno/credentials/dhan').then((r) => r.json()).catch(() => null),
      ]);
      body.textContent = JSON.stringify({
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
