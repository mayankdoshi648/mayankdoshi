import { DATA_CONFIG } from '@cas/shared';
import { getSetting } from '../db/client.js';
import { decryptSecret } from '../utils/crypto.js';
import { API_CONFIG } from '../config.js';

export class DhanNotConfiguredError extends Error {
  constructor() {
    super('Dhan credentials not configured');
    this.name = 'DhanNotConfiguredError';
  }
}

export class DhanApiError extends Error {
  status: number;
  body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = 'DhanApiError';
    this.status = status;
    this.body = body;
  }
}

type CacheEntry = { expiresAt: number; value: unknown };

const cache = new Map<string, CacheEntry>();
let lastOptionChainAt = 0;
let queue: Promise<unknown> = Promise.resolve();

function getCredentials(): { clientId: string; accessToken: string } {
  const clientIdEnc = getSetting('dhan.clientId');
  const tokenEnc = getSetting('dhan.accessToken');
  if (!clientIdEnc || !tokenEnc) throw new DhanNotConfiguredError();
  return {
    clientId: decryptSecret(clientIdEnc),
    accessToken: decryptSecret(tokenEnc),
  };
}

export function hasDhanCredentials(): boolean {
  return Boolean(getSetting('dhan.clientId') && getSetting('dhan.accessToken'));
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  opts?: { cacheTtlMs?: number; cacheKey?: string },
): Promise<T> {
  const cacheKey = opts?.cacheKey;
  if (cacheKey) {
    const hit = cache.get(cacheKey);
    if (hit && hit.expiresAt > Date.now()) return hit.value as T;
  }

  return enqueue(async () => {
    const { clientId, accessToken } = getCredentials();
    let attempt = 0;
    let lastErr: unknown;

    while (attempt < DATA_CONFIG.maxRetries) {
      attempt += 1;
      try {
        const res = await fetch(`${API_CONFIG.dhanBaseUrl}${path}`, {
          method,
          headers: {
            'Content-Type': 'application/json',
            'access-token': accessToken,
            'client-id': clientId,
          },
          body: body == null ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(DATA_CONFIG.requestTimeoutMs),
        });

        const text = await res.text();
        let json: unknown = null;
        try {
          json = text ? JSON.parse(text) : null;
        } catch {
          json = text;
        }

        if (!res.ok) {
          throw new DhanApiError(`Dhan API ${res.status}`, res.status, json);
        }

        if (cacheKey && opts?.cacheTtlMs) {
          cache.set(cacheKey, { value: json, expiresAt: Date.now() + opts.cacheTtlMs });
        }
        return json as T;
      } catch (err) {
        lastErr = err;
        if (attempt >= DATA_CONFIG.maxRetries) break;
        await sleep(DATA_CONFIG.retryBaseMs * 2 ** (attempt - 1));
      }
    }
    throw lastErr;
  });
}

/** Market quote — LTP / OHLC / depth style payloads depending on endpoint. */
export async function fetchMarketQuote(payload: Record<string, unknown>): Promise<unknown> {
  return request('POST', '/v2/marketfeed/quote', payload, {
    cacheTtlMs: DATA_CONFIG.quoteCacheTtlMs,
    cacheKey: `quote:${JSON.stringify(payload)}`,
  });
}

export async function fetchLtp(payload: Record<string, unknown>): Promise<unknown> {
  return request('POST', '/v2/marketfeed/ltp', payload, {
    cacheTtlMs: DATA_CONFIG.quoteCacheTtlMs,
    cacheKey: `ltp:${JSON.stringify(payload)}`,
  });
}

export async function fetchIntradayHistory(payload: Record<string, unknown>): Promise<unknown> {
  return request('POST', '/v2/charts/intraday', payload, {
    cacheTtlMs: DATA_CONFIG.historyCacheTtlMs,
    cacheKey: `intraday:${JSON.stringify(payload)}`,
  });
}

export async function fetchExpiryList(payload: {
  UnderlyingScrip: number;
  UnderlyingSeg: string;
}): Promise<unknown> {
  return request('POST', '/v2/optionchain/expirylist', payload, {
    cacheTtlMs: 60_000,
    cacheKey: `expiries:${payload.UnderlyingScrip}:${payload.UnderlyingSeg}`,
  });
}

export async function fetchOptionChain(payload: {
  UnderlyingScrip: number;
  UnderlyingSeg: string;
  Expiry: string;
}): Promise<unknown> {
  const wait = DATA_CONFIG.optionChainMinIntervalMs - (Date.now() - lastOptionChainAt);
  if (wait > 0) await sleep(wait);
  lastOptionChainAt = Date.now();
  return request('POST', '/v2/optionchain', payload, {
    cacheTtlMs: DATA_CONFIG.optionChainMinIntervalMs,
    cacheKey: `oc:${payload.UnderlyingScrip}:${payload.Expiry}`,
  });
}

/** Intentionally no order / trade / position-modify methods. */
export const TRADING_APIS_DISABLED = true as const;
