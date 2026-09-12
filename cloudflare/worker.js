'use strict';

/**
 * Cloudflare Worker entry (Worker + static assets).
 * /api/* → F&O handler; everything else → ASSETS (SPA fallback to index.html).
 */

const { handleRequest } = require('./handler');

/** Named workerFetch (not fetch) so bundling cannot confuse this with globalThis.fetch. */
async function workerFetch(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === '/api' || path.startsWith('/api/')) {
    return handleRequest(request, env || {}, ctx);
  }

  if (!env || !env.ASSETS) {
    return new Response('ASSETS binding missing', {
      status: 500,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  const assetResponse = await env.ASSETS.fetch(request);
  if (assetResponse.status !== 404) return assetResponse;

  // SPA / client-router fallback (no run_worker_first / not_found_handling needed)
  const accept = request.headers.get('accept') || '';
  const looksLikePage = !path.includes('.') || accept.includes('text/html');
  if (looksLikePage) {
    return env.ASSETS.fetch(new URL('/index.html', url.origin));
  }
  return assetResponse;
}

module.exports = { fetch: workerFetch, default: { fetch: workerFetch } };
