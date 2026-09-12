'use strict';

/**
 * Ensure process.env exists when bundling for Workers.
 * Pages Functions with nodejs_compat also provide process; this is a safety net.
 */
if (typeof globalThis.process === 'undefined') {
  globalThis.process = { env: {}, cwd: () => '/', platform: 'cloudflare' };
} else if (!globalThis.process.env) {
  globalThis.process.env = {};
}
