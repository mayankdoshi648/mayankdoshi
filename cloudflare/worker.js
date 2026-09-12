'use strict';

/**
 * Cloudflare Worker entry (Worker + static assets).
 * Serves /api/* via the F&O handler; everything else via ASSETS binding.
 */

const { handleRequest } = require('./handler');

async function fetch(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === '/api' || path.startsWith('/api/')) {
    return handleRequest(request, env || {}, ctx);
  }

  if (env && env.ASSETS) {
    return env.ASSETS.fetch(request);
  }

  return new Response('Not found', {
    status: 404,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}

module.exports = { fetch, default: { fetch } };
