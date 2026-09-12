'use strict';

const { createOiCache } = require('../oiCache');
const { createDataSourceManager } = require('../dataSourceManager');
const {
  TTL,
  createMarketDataStore,
  getMarketDataStore,
} = require('./store');
const {
  classifyFreshness,
  ageSecondsFrom,
  attachFreshness,
  DEFAULT_THRESHOLDS,
} = require('./freshness');
const {
  validateMarketRow,
  filterValidRows,
  assertFieldParity,
} = require('./validate');
const { buildDataHealth } = require('./health');

function getSharedOiCache() {
  if (!globalThis.__powerbullOiCache) {
    globalThis.__powerbullOiCache = createOiCache();
  }
  return globalThis.__powerbullOiCache;
}

function getSharedDataSources() {
  if (!globalThis.__powerbullDataSources) {
    globalThis.__powerbullDataSources = createDataSourceManager();
  }
  return globalThis.__powerbullDataSources;
}

module.exports = {
  TTL,
  createMarketDataStore,
  getMarketDataStore,
  getSharedOiCache,
  getSharedDataSources,
  classifyFreshness,
  ageSecondsFrom,
  attachFreshness,
  DEFAULT_THRESHOLDS,
  validateMarketRow,
  filterValidRows,
  assertFieldParity,
  buildDataHealth,
};
