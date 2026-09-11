'use strict';

/**
 * F&O data provider interface.
 *
 * Implementations must return DataEnvelope shapes from normalize.dataEnvelope
 * where applicable: { data, meta: { asOf, source, isMock, stale, error } }.
 *
 * @typedef {object} FoDataProvider
 * @property {(symbols?: string[]) => Promise<object>} getIndexQuotes
 * @property {(underlying: string) => Promise<object>} getOptionExpiries
 * @property {(underlying: string, expiry: string) => Promise<object>} getOptionChain
 * @property {(symbols?: string[]) => Promise<object>} getFuturesQuotes
 * @property {() => Promise<object>} getFoUniverse
 * @property {() => Promise<object>} getFiiDii
 */
class FoDataProvider {
  /** @param {string[]} [_symbols] */
  async getIndexQuotes(_symbols) {
    throw new Error('not implemented');
  }

  /** @param {string} [_underlying] */
  async getOptionExpiries(_underlying) {
    throw new Error('not implemented');
  }

  /** @param {string} [_underlying] @param {string} [_expiry] */
  async getOptionChain(_underlying, _expiry) {
    throw new Error('not implemented');
  }

  /** @param {string[]} [_symbols] */
  async getFuturesQuotes(_symbols) {
    throw new Error('not implemented');
  }

  async getFoUniverse() {
    throw new Error('not implemented');
  }

  async getFiiDii() {
    throw new Error('not implemented');
  }
}

/** @deprecated Alias — prefer FoDataProvider */
class BaseProvider extends FoDataProvider {}

module.exports = { FoDataProvider, BaseProvider };
