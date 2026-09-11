'use strict';

/**
 * Cloudflare Pages Functions API for PowerBull Pro.
 * Reuses FnoService + Hybrid providers (engines unchanged).
 *
 * Free-tier limits (intentional):
 * - No SQLite / DarvaX / signals persistence
 * - No persistent equity Dhan WebSocket (/live)
 * - No PIN/TOTP (Access Token + Client ID only)
 * - Watchlist/alerts are per-isolate memory (not durable)
 * - Equity Markets board uses demo quotes to stay within CPU limits
 * - REST + in-memory cache (no always-on WebSocket proxy)
 */

const { FnoService } = require('../backend/fno/service');
const { createDataSourceManager } = require('../backend/dataSourceManager');
const { isMarketOpen } = require('../backend/marketWindow');
const { createStockDashboard } = require('../backend/stockDashboard');
const {
  sealCredentials,
  openCredentials,
  readCookie,
  setCookieHeader,
  COOKIE,
} = require('./sessionCrypto');
const {
  resolveInstrument,
  listKinds,
} = require('../backend/fno/instrumentMapping');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Setup-Key',
  'Access-Control-Expose-Headers': 'X-PowerBull-Session',
};

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...CORS,
      ...extraHeaders,
    },
  });
}

function nodeUnavailable(feature) {
  return json({
    error: 'node_only',
    message: `${feature} requires the Node runtime (local npm start). Cloudflare free deployment serves F&O REST + credential session.`,
    feature,
    runtime: 'cloudflare',
  }, 501);
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function apiParts(url) {
  const pathname = url.pathname.replace(/\/+$/, '') || '/';
  const parts = pathname.split('/').filter(Boolean);
  if (parts[0] === 'api') parts.shift();
  return parts;
}

function hasToken(token) {
  return Boolean(token && String(token).trim().length >= 12);
}

function assertSetupAllowed(request, env, body) {
  const expected = env.ADMIN_SETUP_KEY || env.DHAN_SETUP_KEY || '';
  if (!expected) return;
  const got = request.headers.get('x-setup-key') || body?.setupKey || '';
  if (got !== expected) {
    const err = new Error('Setup key required to change Dhan credentials on this host');
    err.status = 403;
    throw err;
  }
}

function applyEnv(env, session) {
  process.env.POWERBULL_RUNTIME = 'cloudflare';
  process.env.POWERBULL_OI_MEMORY_ONLY = '1';
  process.env.NODE_ENV = process.env.NODE_ENV || 'production';
  process.env.DEMO_MODE = String(env.DEMO_MODE || 'false');
  process.env.FNO_FORCE_MOCK = env.FNO_FORCE_MOCK || process.env.FNO_FORCE_MOCK || '';
  process.env.DHAN_API_BASE = env.DHAN_API_BASE || 'https://api.dhan.co';

  const clientId = String(
    session?.clientId || env.DHAN_CLIENT_ID || process.env.DHAN_CLIENT_ID || '',
  ).trim();
  const accessToken = String(
    session?.accessToken || env.DHAN_ACCESS_TOKEN || process.env.DHAN_ACCESS_TOKEN || '',
  ).trim();

  if (clientId) process.env.DHAN_CLIENT_ID = clientId;
  else delete process.env.DHAN_CLIENT_ID;
  if (accessToken) process.env.DHAN_ACCESS_TOKEN = accessToken;
  else delete process.env.DHAN_ACCESS_TOKEN;

  // Never enable PIN/TOTP path on CF even if somehow present
  delete process.env.DHAN_PIN;
  delete process.env.DHAN_TOTP_SECRET;

  return {
    clientId,
    accessToken,
    pin: '',
    totpSecret: '',
    hasDhan: Boolean(clientId && hasToken(accessToken)),
    forceDemo: String(env.DEMO_MODE || 'false').toLowerCase() === 'true',
  };
}

function envelopeError(err, status = 500) {
  const msg = err.message || String(err);
  const code = err.status || (/required|missing|invalid/i.test(msg) ? 400 : status);
  return json({
    data: null,
    meta: {
      asOf: new Date().toISOString(),
      source: 'error',
      isMock: false,
      stale: false,
      error: msg,
    },
    error: msg,
  }, code);
}

async function handleRequest(request, env = {}, _ctx = null) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  const url = new URL(request.url);
  const parts = apiParts(url);
  const method = request.method.toUpperCase();
  const secret = env.SESSION_SECRET || env.DHAN_CLIENT_ID || 'powerbull-cf-dev-secret-change-me';

  const sealed = readCookie(request, COOKIE);
  const session = sealed ? await openCredentials(sealed, secret) : null;
  const config = applyEnv(env, session);
  const dataSources = createDataSourceManager();
  dataSources.setWebsocket({
    connected: false,
    error: 'Equity WebSocket is Node-only; F&O uses REST on Cloudflare',
  });

  const extra = {};

  try {
    if (parts[0] === 'health' && method === 'GET') {
      return json({
        ok: true,
        runtime: 'cloudflare-pages',
        service: 'powerbull-pro',
        fno: true,
        nodeFeatures: false,
        ts: new Date().toISOString(),
      });
    }

    if (parts[0] === 'live') return nodeUnavailable('Equity live WebSocket');
    if (parts[0] === 'signals' || parts[0] === 'darvax' || parts[0] === 'market' || parts[0] === 'candles') {
      return nodeUnavailable(parts[0]);
    }
    if (parts[0] === 'breadth' || parts[0] === 'overview' || parts[0] === 'orders') {
      return nodeUnavailable(parts[0]);
    }

    if (parts[0] === 'status' && method === 'GET') {
      const marketOpen = isMarketOpen();
      return json({
        marketOpen,
        feedConnected: false,
        lastError: null,
        darvaxAutoTrade: false,
        hasDhan: config.hasDhan,
        auth: {
          hasCredentials: config.hasDhan,
          authenticated: config.hasDhan,
          mode: config.hasDhan ? 'live' : 'demo',
          authMode: config.hasDhan ? 'access_token' : null,
          lastError: null,
        },
        dashboardMode: 'demo',
        runtime: 'cloudflare',
        connections: dataSources.snapshot({
          marketOpen,
          hasDhan: config.hasDhan,
          auth: { authenticated: config.hasDhan, authMode: 'access_token' },
        }),
      });
    }

    if (parts[0] === 'data-connections' && method === 'GET') {
      const marketOpen = isMarketOpen();
      const snap = dataSources.snapshot({
        marketOpen,
        hasDhan: config.hasDhan,
        auth: {
          authenticated: config.hasDhan,
          authMode: config.hasDhan ? 'access_token' : null,
        },
      });
      return json({
        ...snap,
        runtime: 'cloudflare-pages',
        limitations: {
          equityLiveWs: false,
          sqliteSignals: false,
          pinTotpLogin: false,
          marketsLive: false,
          note: 'F&O REST is live via Dhan/NSE. Equity WS, DarvaX, and live Markets board need Node.',
        },
      });
    }

    if (parts[0] === 'auth' && parts[1] === 'status' && method === 'GET') {
      return json({
        hasCredentials: config.hasDhan,
        authenticated: config.hasDhan,
        mode: config.hasDhan ? 'live' : 'demo',
        authMode: config.hasDhan ? 'access_token' : null,
        lastError: null,
        runtime: 'cloudflare',
      });
    }

    if (parts[0] === 'auth' && parts[1] === 'refresh' && method === 'POST') {
      return json({
        ok: false,
        error: 'Token refresh via PIN/TOTP is Node-only. Paste a fresh Access Token in More → Dhan API.',
        runtime: 'cloudflare',
      }, 501);
    }

    // Equity Markets — demo only on free CF (avoids CPU timeouts from 52w history pulls)
    if (parts[0] === 'dashboard') {
      const tokenManager = {
        async getAccessToken() {
          if (!config.hasDhan) throw new Error('No Dhan token');
          return { accessToken: config.accessToken };
        },
        getStatus() {
          return {
            hasCredentials: config.hasDhan,
            authenticated: config.hasDhan,
            mode: 'demo',
            authMode: config.hasDhan ? 'access_token' : null,
            lastError: null,
          };
        },
      };
      const dash = createStockDashboard({
        tokenManager,
        config,
        demoMode: true,
      });
      if (parts[1] === 'sectors' && method === 'GET') {
        const report = await dash.getDashboard({ universe: 'nifty50', limit: 100 });
        return json({ sectors: report.sectors || [] });
      }
      if (parts[1] === 'rankings' && method === 'GET') {
        return json({ rankings: ['gainers', 'losers', 'near52wHigh', 'near52wLow', 'volume', 'all'] });
      }
      if (method === 'GET') {
        const report = await dash.getDashboard({
          universe: url.searchParams.get('universe') || 'nifty50',
          sector: url.searchParams.get('sector') || 'all',
          ranking: url.searchParams.get('ranking') || 'all',
          limit: Number(url.searchParams.get('limit') || 100),
          force: url.searchParams.get('refresh') === '1',
        });
        return json({
          ...report,
          mode: 'demo',
          warning: 'Cloudflare free tier: Equity Markets uses demo quotes. F&O terminal uses live Dhan/NSE when connected.',
          runtime: 'cloudflare',
        });
      }
    }

    // F&O service (engines unchanged)
    const fno = new FnoService({ config, dataSources });

    if (parts[0] === 'fno') {
      const sub = parts.slice(1);

      if (sub[0] === 'credentials' && sub[1] === 'dhan') {
        if (method === 'GET' && !sub[2]) {
          return json({ data: fno.getDhanStatus() });
        }
        if (method === 'PUT' && !sub[2]) {
          const body = await readJson(request);
          assertSetupAllowed(request, env, body);
          const clientId = String(body.clientId || '').trim();
          const accessToken = String(body.accessToken || body.access_token || body.token || '').trim();
          if (!clientId || !hasToken(accessToken)) {
            return envelopeError(new Error('Cloudflare requires Client ID + Access Token (PIN/TOTP is Node-only)'), 400);
          }
          const status = fno.setDhanCredentials({
            clientId,
            accessToken,
            persistEnv: false,
            clearForceMock: body.clearForceMock !== false,
          });
          const sealedOut = await sealCredentials({ clientId, accessToken }, secret);
          extra['Set-Cookie'] = setCookieHeader(sealedOut);
          extra['X-PowerBull-Session'] = '1';
          return json({
            data: {
              ...status,
              persisted: false,
              message: 'Credentials stored in encrypted httpOnly cookie (not in URL or localStorage).',
            },
          }, 200, extra);
        }
        if (method === 'DELETE' && !sub[2]) {
          assertSetupAllowed(request, env, {});
          const status = fno.clearDhanCredentials();
          extra['Set-Cookie'] = setCookieHeader(null, { clear: true });
          return json({ data: status }, 200, extra);
        }
        if (method === 'POST' && sub[2] === 'test') {
          const body = await readJson(request);
          const result = await fno.testDhanCredentials(
            body.clientId || body.accessToken ? body : null,
          );
          return json({ data: result });
        }
      }

      if (sub[0] === 'instruments' && sub[1] === 'resolve' && method === 'GET') {
        const symbol = String(url.searchParams.get('symbol') || '').trim();
        const kind = String(url.searchParams.get('kind') || 'FUTURES').trim();
        if (!symbol) return envelopeError(new Error('symbol required'), 400);
        const resolved = await resolveInstrument(symbol, { kind, config });
        return json({
          ok: true,
          symbol: symbol.toUpperCase(),
          kind: kind.toUpperCase(),
          kinds: listKinds(),
          resolved,
        });
      }

      if (sub[0] === 'ticker' && method === 'GET') return json(await fno.getTicker());
      if (sub[0] === 'overview' && method === 'GET') return json(await fno.getMarketOverviewIntelligence());
      if (sub[0] === 'expiries' && method === 'GET') {
        return json(await fno.getExpiries(sub[1]));
      }
      if (sub[0] === 'option-chain' && method === 'GET') {
        return json(await fno.getOptionChain(sub[1], url.searchParams.get('expiry') || null));
      }
      if (sub[0] === 'scanner' && method === 'GET') {
        return json(await fno.getFoScanner({
          signal: url.searchParams.get('signal') || null,
          sector: url.searchParams.get('sector') || null,
          minAbsScore: Number(url.searchParams.get('minAbsScore') || 0),
        }));
      }
      if (sub[0] === 'buildups' && method === 'GET') return json(await fno.getBuildupBuckets());
      if (sub[0] === 'smart-money' && method === 'GET') {
        if (sub[1] && sub[2] === 'history') {
          const history = fno.getSmartMoneyHistory(sub[1], url.searchParams.get('range') || '5D');
          return json({ data: history, meta: { asOf: new Date().toISOString() } });
        }
        if (sub[1]) return json(await fno.getSmartMoneyDetail(sub[1]));
        return json(await fno.getSmartMoney(Number(url.searchParams.get('limit') || 25)));
      }
      if (sub[0] === 'opportunity' && method === 'GET') {
        if (sub[1]) return json(await fno.getOpportunityDetail(sub[1]));
        return json(await fno.getOpportunityBoard({
          filter: url.searchParams.get('filter') || null,
          sort: url.searchParams.get('sort') || 'opportunityScore',
          dir: url.searchParams.get('dir') || 'desc',
          limit: Number(url.searchParams.get('limit') || 80),
        }));
      }
      if (sub[0] === 'sectors' && method === 'GET') {
        if (sub[1]) return json(await fno.getSectorStocks(sub[1]));
        return json(await fno.getSectorAnalysis());
      }
      if (sub[0] === 'fii-dii' && method === 'GET') return json(await fno.getFiiDii());
      if (sub[0] === 'watchlist' && method === 'GET') return json(await fno.getWatchlistQuotes());
      if (sub[0] === 'watchlist' && method === 'POST') {
        const body = await readJson(request);
        return json({ symbols: fno.addWatchlist(body?.symbol) });
      }
      if (sub[0] === 'watchlist' && method === 'DELETE' && sub[1]) {
        return json({ symbols: fno.removeWatchlist(sub[1]) });
      }
      if (sub[0] === 'alerts' && sub[1] === 'rules' && method === 'GET') {
        return json({ rules: fno.getAlertRules() });
      }
      if (sub[0] === 'alerts' && sub[1] === 'rules' && method === 'PUT') {
        const body = await readJson(request);
        return json({ rules: fno.updateAlertRules(body || {}) });
      }
      if (sub[0] === 'alerts' && sub[1] === 'history' && method === 'GET') {
        return json({ alerts: fno.getAlertHistory() });
      }
      if (sub[0] === 'alerts' && method === 'GET') return json(await fno.evaluateAlerts());

      return json({ error: 'not_found', path: url.pathname, runtime: 'cloudflare' }, 404);
    }

    return json({ error: 'not_found', path: url.pathname, runtime: 'cloudflare' }, 404);
  } catch (err) {
    return envelopeError(err, err.status || 500);
  }
}

module.exports = { handleRequest, json, CORS };
