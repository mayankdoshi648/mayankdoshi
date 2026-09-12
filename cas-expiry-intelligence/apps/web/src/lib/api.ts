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
  health: () => req<{ ok: boolean; dhanConfigured: boolean }>('/api/health'),
  instruments: () => req<{ instruments: any[] }>('/api/instruments'),
  casModes: () => req<{ modes: any[]; defaultMode?: string }>('/api/cas/modes'),
  expiries: (id: string) => req<{ expiries: string[] }>(`/api/instruments/${id}/expiries`),
  analytics: (id: string, q: { expiry?: string; casMode?: string; wings?: number }) => {
    const params = new URLSearchParams();
    if (q.expiry) params.set('expiry', q.expiry);
    if (q.casMode) params.set('casMode', q.casMode);
    if (q.wings) params.set('wings', String(q.wings));
    const qs = params.toString();
    return req<any>(`/api/analytics/${id}${qs ? `?${qs}` : ''}`);
  },
  getDhanSettings: () =>
    req<{ configured: boolean; clientIdMasked: string | null }>('/api/settings/dhan'),
  saveDhanSettings: (clientId: string, accessToken: string) =>
    req('/api/settings/dhan', {
      method: 'PUT',
      body: JSON.stringify({ clientId, accessToken }),
    }),
  clearDhanSettings: () => req('/api/settings/dhan', { method: 'DELETE' }),
  casHistory: () => req<{ rows: any[]; notice: string }>('/api/cas/history'),
  backtests: () => req<{ runs: any[]; notice: string }>('/api/backtests'),
};
