'use strict';

/** No-op fs stub for Cloudflare Workers bundles. */
module.exports = {
  readFileSync() {
    const err = new Error('ENOENT: fs unavailable on Cloudflare');
    err.code = 'ENOENT';
    throw err;
  },
  writeFileSync() {},
  mkdirSync() {},
  existsSync() {
    return false;
  },
  promises: {
    readFile() {
      return Promise.reject(new Error('fs unavailable'));
    },
    writeFile() {
      return Promise.resolve();
    },
    mkdir() {
      return Promise.resolve();
    },
  },
};
