import { isStaticDemo, staticDemo } from './staticDemo';
import { getLiveApiOrigin, hasLiveApiOrigin, liveFetch, setLiveApiOrigin } from './liveApi';

const API_BASE = import.meta.env.VITE_API_BASE ?? '';

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const origin = getLiveApiOrigin();
  const url = origin ? `${origin}${path}` : `${API_BASE}${path}`;
  const res = await fetch(url, {
    credentials: origin ? 'include' : 'same-origin',
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as any)?.error ?? (json as any)?.message ?? `Request failed (${res.status})`);
  return json as T;
}

function useStaticFor(feature: 'analytics' | 'dhan'): boolean {
  if (feature === 'dhan' && hasLiveApiOrigin()) return false;
  return isStaticDemo();
}

async function getDhanViaLiveBridge(): Promise<{ configured: boolean; clientIdMasked: string | null }> {
  // Prefer CAS-shaped alias on PowerBull Worker; fall back to F&O credentials envelope.
  try {
    const r = await liveFetch('/api/settings/dhan');
    const json = await r.json().catch(() => ({}));
    if (r.ok) {
      return {
        configured: Boolean((json as any).configured ?? (json as any).hasDhan),
        clientIdMasked: (json as any).clientIdMasked ?? (json as any).clientIdMasked ?? null,
      };
    }
  } catch {
    /* try fno path */
  }
  const r = await liveFetch('/api/fno/credentials/dhan');
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((json as any)?.error ?? `Request failed (${r.status})`);
  const data = (json as any).data || json;
  return {
    configured: Boolean(data.hasDhan ?? data.configured),
    clientIdMasked: data.clientIdMasked ?? data.clientIdMasked ?? null,
  };
}

async function saveDhanViaLiveBridge(clientId: string, accessToken: string) {
  try {
    const r = await liveFetch('/api/settings/dhan', {
      method: 'PUT',
      body: JSON.stringify({ clientId, accessToken }),
    });
    const json = await r.json().catch(() => ({}));
    if (r.ok) return json;
  } catch {
    /* try fno path */
  }
  const r = await liveFetch('/api/fno/credentials/dhan', {
    method: 'PUT',
    body: JSON.stringify({ clientId, accessToken, persistEnv: false }),
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((json as any)?.error ?? (json as any)?.message ?? `Request failed (${r.status})`);
  return json;
}

async function clearDhanViaLiveBridge() {
  try {
    const r = await liveFetch('/api/settings/dhan', { method: 'DELETE' });
    if (r.ok) return r.json().catch(() => ({ configured: false }));
  } catch {
    /* try fno path */
  }
  const r = await liveFetch('/api/fno/credentials/dhan', { method: 'DELETE' });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((json as any)?.error ?? `Request failed (${r.status})`);
  return json;
}

export const api = {
  getLiveApiOrigin,
  setLiveApiOrigin,
  hasLiveApiOrigin,

  health: () => (useStaticFor('analytics') ? Promise.resolve(staticDemo.health()) : req('/api/health')),

  instruments: () =>
    useStaticFor('analytics')
      ? Promise.resolve(staticDemo.instruments())
      : req<{ instruments: any[] }>('/api/instruments'),

  casModes: () =>
    useStaticFor('analytics')
      ? Promise.resolve(staticDemo.casModes())
      : req<{ modes: any[]; defaultMode?: string }>('/api/cas/modes'),

  expiries: (id: string) =>
    useStaticFor('analytics')
      ? Promise.resolve(staticDemo.expiries(id))
      : req<{ expiries: string[] }>(`/api/instruments/${id}/expiries`),

  analytics: (id: string, q: { expiry?: string; casMode?: string; wings?: number }) => {
    if (useStaticFor('analytics')) return Promise.resolve(staticDemo.analytics(id, q));
    const params = new URLSearchParams();
    if (q.expiry) params.set('expiry', q.expiry);
    if (q.casMode) params.set('casMode', q.casMode);
    if (q.wings) params.set('wings', String(q.wings));
    const qs = params.toString();
    return req<any>(`/api/analytics/${id}${qs ? `?${qs}` : ''}`);
  },

  getDhanSettings: () =>
    useStaticFor('dhan')
      ? Promise.resolve(staticDemo.getDhanSettings())
      : getDhanViaLiveBridge(),

  saveDhanSettings: (clientId: string, accessToken: string) =>
    useStaticFor('dhan')
      ? staticDemo.saveDhanSettings()
      : saveDhanViaLiveBridge(clientId, accessToken),

  clearDhanSettings: () =>
    useStaticFor('dhan')
      ? staticDemo.clearDhanSettings()
      : clearDhanViaLiveBridge(),

  getFuturesSettings: () =>
    useStaticFor('analytics')
      ? Promise.resolve(staticDemo.getFuturesSettings())
      : req<{ mappings: Array<{ instrumentId: string; securityId: string | null }> }>(
          '/api/settings/futures',
        ),

  saveFuturesSettings: (ids: Record<string, string>) =>
    useStaticFor('analytics')
      ? staticDemo.saveFuturesSettings()
      : req('/api/settings/futures', {
          method: 'PUT',
          body: JSON.stringify({ ids }),
        }),

  casHistory: () =>
    useStaticFor('analytics')
      ? Promise.resolve(staticDemo.casHistory())
      : req<{ rows: any[]; notice: string }>('/api/cas/history'),

  backtests: () =>
    useStaticFor('analytics')
      ? Promise.resolve(staticDemo.backtests())
      : req<{ runs: any[]; notice: string }>('/api/backtests'),
};
