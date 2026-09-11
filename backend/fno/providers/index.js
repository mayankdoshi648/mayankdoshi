'use strict';

const { FoDataProvider, BaseProvider } = require('./base');
const { DhanProvider, UNDERLYINGS } = require('./dhanProvider');
const { NseProvider, NsePublicProvider } = require('./nseProvider');
const { MockProvider } = require('./mockProvider');
const { dataEnvelope } = require('../normalize');

/**
 * Hybrid: NSE for public indices / FII-DII, Dhan for option chain & futures.
 * Falls back to labeled mock when a Dhan chain call fails.
 */
class HybridProvider extends FoDataProvider {
  /**
   * @param {object} options
   * @param {NseProvider} options.nse
   * @param {DhanProvider} options.dhan
   * @param {MockProvider} options.mock
   */
  constructor({ nse, dhan, mock }) {
    super();
    this.name = 'hybrid';
    this.nse = nse;
    this.dhan = dhan;
    this.mock = mock;
  }

  async getIndexQuotes(symbols) {
    try {
      return await this.nse.getIndexQuotes(symbols);
    } catch (err) {
      const fallback = await this.mock.getIndexQuotes(symbols);
      return dataEnvelope(fallback.data, {
        ...fallback.meta,
        isMock: true,
        warning: `NSE indices failed; using mock (${err.message})`,
        error: err.message,
      });
    }
  }

  async getOptionExpiries(underlying) {
    try {
      return await this.dhan.getOptionExpiries(underlying);
    } catch (err) {
      const fallback = await this.mock.getOptionExpiries(underlying);
      return dataEnvelope(fallback.data, {
        ...fallback.meta,
        isMock: true,
        warning: `Dhan expiries failed; using mock (${err.message})`,
        error: err.message,
      });
    }
  }

  async getOptionChain(underlying, expiry) {
    try {
      return await this.dhan.getOptionChain(underlying, expiry);
    } catch (err) {
      const fallback = await this.mock.getOptionChain(underlying, expiry);
      return dataEnvelope(fallback.data, {
        ...fallback.meta,
        isMock: true,
        warning: `Dhan option chain failed; using mock (${err.message})`,
        error: err.message,
      });
    }
  }

  async getFuturesQuotes(symbols) {
    try {
      // Without a security-id map, Dhan returns empty — use labeled mock for scanners.
      if (!symbols || !symbols.length) {
        const fallback = await this.mock.getFuturesQuotes(symbols);
        return dataEnvelope(fallback.data, {
          ...fallback.meta,
          isMock: true,
          warning: 'Dhan futures security-id map not provided; using mock',
        });
      }
      return await this.dhan.getFuturesQuotes(symbols);
    } catch (err) {
      const fallback = await this.mock.getFuturesQuotes(symbols);
      return dataEnvelope(fallback.data, {
        ...fallback.meta,
        isMock: true,
        warning: `Dhan futures failed; using mock (${err.message})`,
        error: err.message,
      });
    }
  }

  async getFoUniverse() {
    return this.mock.getFoUniverse();
  }

  async getFiiDii() {
    return this.nse.getFiiDii();
  }

  async getSectorReturns() {
    return this.mock.getSectorReturns();
  }
}

function hasDhanCreds(config = {}) {
  if (config.accessToken && (config.clientId || config.dhanClientId)) return true;
  return Boolean(config.clientId && config.pin && config.totpSecret);
}

/**
 * Factory: Dhan creds present → hybrid (NSE public + Dhan chain); else Mock.
 * Hybrid option-chain failures fall back to mock with isMock:true + warning.
 *
 * @param {object} [options]
 * @param {object} [options.config]
 * @param {boolean} [options.preferMock]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {string} [options.accessToken]
 * @param {string} [options.clientId]
 * @returns {FoDataProvider}
 */
function createProvider({ config = {}, preferMock = false, fetchImpl, accessToken, clientId } = {}) {
  const mock = new MockProvider();
  if (preferMock) return mock;

  const cfg = {
    ...config,
    accessToken: accessToken || config.accessToken,
    clientId: clientId || config.clientId || config.dhanClientId,
  };

  if (!hasDhanCreds(cfg)) {
    return mock;
  }

  const nse = new NseProvider({ fetchImpl });
  const dhan = new DhanProvider({
    config: cfg.pin && cfg.totpSecret ? cfg : null,
    accessToken: cfg.accessToken,
    clientId: cfg.clientId,
    fetchImpl,
  });

  return new HybridProvider({ nse, dhan, mock });
}

module.exports = {
  createProvider,
  HybridProvider,
  hasDhanCreds,
  FoDataProvider,
  BaseProvider,
  DhanProvider,
  NseProvider,
  NsePublicProvider,
  MockProvider,
  UNDERLYINGS,
};
