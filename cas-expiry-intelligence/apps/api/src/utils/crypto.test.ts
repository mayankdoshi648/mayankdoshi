import test from 'node:test';
import assert from 'node:assert/strict';
import { encryptSecret, decryptSecret } from '../utils/crypto.js';

test('credential encrypt/decrypt roundtrip', () => {
  const plain = 'dhan-access-token-example';
  const enc = encryptSecret(plain);
  assert.notEqual(enc, plain);
  assert.equal(decryptSecret(enc), plain);
});
