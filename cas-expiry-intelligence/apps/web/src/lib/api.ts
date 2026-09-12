import { isStaticDemo, staticDemo } from './staticDemo';

const API_BASE = import.meta.env.VITE_API_BASE ?? '';

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as any)?.error ?? `Request failed (${res.status})`);
  return json as T;
}

export const api = {
  health: () => (isStaticDemo() ? Promise.resolve(staticDemo.health()) : req('/api/health')),

  instruments: () =>
    isStaticDemo()
      ? Promise.resolve(staticDemo.instruments())
      : req<{ instruments: any[] }>('/api/instruments'),

  casModes: () =>
    isStaticDemo()
      ? Promise.resolve(staticDemo.casModes())
      : req<{ modes: any[]; defaultMode?: string }>('/api/cas/modes'),

  expiries: (id: string) =>
    isStaticDemo()
      ? Promise.resolve(staticDemo.expiries(id))
      : req<{ expiries: string[] }>(`/api/instruments/${id}/expiries`),

  analytics: (id: string, q: { expiry?: string; casMode?: string; wings?: number }) => {
    if (isStaticDemo()) return Promise.resolve(staticDemo.analytics(id, q));
    const params = new URLSearchParams();
    if (q.expiry) params.set('expiry', q.expiry);
    if (q.casMode) params.set('casMode', q.casMode);
    if (q.wings) params.set('wings', String(q.wings));
    const qs = params.toString();
    return req<any>(`/api/analytics/${id}${qs ? `?${qs}` : ''}`);
  },

  getDhanSettings: () =>
    isStaticDemo()
      ? Promise.resolve(staticDemo.getDhanSettings())
      : req<{ configured: boolean; clientIdMasked: string | null }>('/api/settings/dhan'),

  saveDhanSettings: (clientId: string, accessToken: string) =>
    isStaticDemo()
      ? staticDemo.saveDhanSettings()
      : req('/api/settings/dhan', {
          method: 'PUT',
          body: JSON.stringify({ clientId, accessToken }),
        }),

  clearDhanSettings: () =>
    isStaticDemo()
      ? staticDemo.clearDhanSettings()
      : req('/api/settings/dhan', { method: 'DELETE' }),

  getFuturesSettings: () =>
    isStaticDemo()
      ? Promise.resolve(staticDemo.getFuturesSettings())
      : req<{ mappings: Array<{ instrumentId: string; securityId: string | null }> }>(
          '/api/settings/futures',
        ),

  saveFuturesSettings: (ids: Record<string, string>) =>
    isStaticDemo()
      ? staticDemo.saveFuturesSettings()
      : req('/api/settings/futures', {
          method: 'PUT',
          body: JSON.stringify({ ids }),
        }),

  casHistory: () =>
    isStaticDemo()
      ? Promise.resolve(staticDemo.casHistory())
      : req<{ rows: any[]; notice: string }>('/api/cas/history'),

  backtests: () =>
    isStaticDemo()
      ? Promise.resolve(staticDemo.backtests())
      : req<{ runs: any[]; notice: string }>('/api/backtests'),
};
