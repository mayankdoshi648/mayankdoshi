'use strict';

/** Minimal path stub for Cloudflare Workers bundles. */
module.exports = {
  join(...parts) { return parts.filter(Boolean).join('/'); },
  dirname(p) { const i = String(p).lastIndexOf('/'); return i <= 0 ? '.' : p.slice(0, i); },
};
