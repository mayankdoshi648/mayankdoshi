'use strict';

const { handleRequest } = require('./handler');

/**
 * Cloudflare Pages Functions entry (bundled into functions/api/[[path]].js).
 * @param {{ request: Request, env: object, waitUntil?: Function }} context
 */
async function onRequest(context) {
  return handleRequest(context.request, context.env || {}, context);
}

module.exports = { onRequest };
