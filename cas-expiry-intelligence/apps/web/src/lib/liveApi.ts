/** Live API origin for static GitHub Pages / Vercel CAS builds. */

const STORAGE_KEY = 'POWERBULL_LIVE_API';

function normalizeOrigin(raw: string): string {
  const s = String(raw || '').trim().replace(/\/+$/, '');
  if (!s) return '';
  try {
    const u = new URL(s.includes('://') ? s : `https://${s}`);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return u.origin;
  } catch {
    return '';
  }
}

export function getLiveApiOrigin(): string {
  if (typeof window === 'undefined') return '';
  try {
    const q = new URLSearchParams(window.location.search).get('liveApi')
      || new URLSearchParams(window.location.search).get('api');
    if (q) {
      const n = normalizeOrigin(q);
      if (n) {
        localStorage.setItem(STORAGE_KEY, n);
        return n;
      }
    }
  } catch {
    /* ignore */
  }
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    const n = normalizeOrigin(stored || '');
    if (n) return n;
  } catch {
    /* ignore */
  }
  const fromWindow = (window as unknown as { POWERBULL_LIVE_API?: string }).POWERBULL_LIVE_API;
  return normalizeOrigin(fromWindow || '');
}

export function setLiveApiOrigin(raw: string): string {
  const n = normalizeOrigin(raw);
  try {
    if (n) localStorage.setItem(STORAGE_KEY, n);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  (window as unknown as { POWERBULL_LIVE_API?: string }).POWERBULL_LIVE_API = n;
  return n;
}

export function hasLiveApiOrigin(): boolean {
  return Boolean(getLiveApiOrigin());
}

export async function liveFetch(path: string, init?: RequestInit): Promise<Response> {
  const origin = getLiveApiOrigin();
  const url = origin && path.startsWith('/') ? `${origin}${path}` : path;
  return fetch(url, {
    credentials: 'include',
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
}
