// backend/connectionStatus.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createConnectionStatus } = require('./connectionStatus');

test('starts disconnected with no error', () => {
  const status = createConnectionStatus();
  assert.equal(status.isConnected(), false);
  assert.equal(status.getLastError(), null);
});

test('setConnected(true) marks connected and clears any prior error', () => {
  const status = createConnectionStatus();
  status.setError('Access Token is expired');
  status.setConnected(true);
  assert.equal(status.isConnected(), true);
  assert.equal(status.getLastError(), null);
});

test('setConnected(false) marks disconnected but keeps the last error visible', () => {
  const status = createConnectionStatus();
  status.setConnected(true);
  status.setError('Access Token is expired');
  status.setConnected(false);
  assert.equal(status.isConnected(), false);
  assert.equal(status.getLastError(), 'Access Token is expired');
});

test('setError accepts an Error object and stores its message', () => {
  const status = createConnectionStatus();
  status.setError(new Error('WebSocket closed'));
  assert.equal(status.getLastError(), 'WebSocket closed');
});

test('setError(null) clears the error', () => {
  const status = createConnectionStatus();
  status.setError('something');
  status.setError(null);
  assert.equal(status.getLastError(), null);
});
