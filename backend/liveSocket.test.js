// backend/liveSocket.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const WebSocket = require('ws');
const { createLiveSocketServer } = require('./liveSocket');

test('broadcast delivers JSON events to connected clients', async () => {
  const httpServer = http.createServer();
  const { broadcast } = createLiveSocketServer(httpServer, '/live');
  await new Promise((resolve) => httpServer.listen(0, resolve));
  const port = httpServer.address().port;

  const client = new WebSocket(`ws://localhost:${port}/live`);
  await new Promise((resolve, reject) => {
    client.on('open', resolve);
    client.on('error', reject);
  });

  const received = new Promise((resolve) => {
    client.on('message', (data) => resolve(JSON.parse(data.toString())));
  });

  broadcast({ type: 'signal', symbol: 'TCS', side: 'BUY' });
  const event = await received;
  assert.equal(event.type, 'signal');
  assert.equal(event.symbol, 'TCS');

  client.close();
  await new Promise((resolve) => httpServer.close(resolve));
});
