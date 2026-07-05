// backend/dhanFeed.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createDhanFeed, decodeQuotePacket } = require('./dhanFeed');

class FakeWebSocket extends EventEmitter {
  constructor(url) {
    super();
    this.url = url;
    this.sent = [];
    FakeWebSocket.instances.push(this);
  }
  send(data) { this.sent.push(data); }
  close() { this.emit('close'); }
}
FakeWebSocket.instances = [];

function buildQuotePacket({ securityId, ltp, ltq, ltt }) {
  const buf = Buffer.alloc(50);
  buf.writeUInt8(4, 0);
  buf.writeUInt16LE(50, 1);
  buf.writeUInt8(1, 3);
  buf.writeInt32LE(securityId, 4);
  buf.writeFloatLE(ltp, 8);
  buf.writeUInt16LE(ltq, 12);
  buf.writeUInt32LE(ltt, 14);
  return buf;
}

test('decodeQuotePacket parses a real Quote packet layout', () => {
  const buf = buildQuotePacket({ securityId: 2885, ltp: 1234.5, ltq: 10, ltt: 1735500000 });
  const ticks = decodeQuotePacket(buf);
  assert.equal(ticks.length, 1);
  assert.equal(ticks[0].symbol, '2885');
  assert.ok(Math.abs(ticks[0].ltp - 1234.5) < 0.01);
  assert.equal(ticks[0].ltq, 10);
  assert.equal(ticks[0].timestamp, 1735500000000);
});

test('decodeQuotePacket ignores non-Quote packet types', () => {
  const buf = Buffer.alloc(50);
  buf.writeUInt8(2, 0); // Ticker packet, not Quote
  assert.deepEqual(decodeQuotePacket(buf), []);
});

test('connect() builds the v2 query-param URL and sends a Quote subscribe message on open', async () => {
  FakeWebSocket.instances = [];
  const feed = createDhanFeed({
    clientId: '1100011000',
    accessToken: 'test-token',
    decodeMessage: () => [],
    WebSocketImpl: FakeWebSocket,
    baseUrl: 'wss://fake-feed.example',
  });

  await feed.connect([{ exchangeSegment: 'NSE_EQ', securityId: '2885' }]);
  const ws = FakeWebSocket.instances[0];
  ws.emit('open');

  assert.equal(ws.url, 'wss://fake-feed.example?version=2&token=test-token&clientId=1100011000&authType=2');
  assert.equal(ws.sent.length, 1);
  const sub = JSON.parse(ws.sent[0]);
  assert.equal(sub.RequestCode, 17);
  assert.equal(sub.InstrumentCount, 1);
  assert.deepEqual(sub.InstrumentList, [{ ExchangeSegment: 'NSE_EQ', SecurityId: '2885' }]);
});

test('message events are decoded and emitted as tick events', async () => {
  FakeWebSocket.instances = [];
  const fakeTicks = [{ symbol: '2885', ltp: 100, ltq: 5, timestamp: 123 }];
  const feed = createDhanFeed({
    clientId: '1100011000',
    accessToken: 'test-token',
    decodeMessage: () => fakeTicks,
    WebSocketImpl: FakeWebSocket,
    baseUrl: 'wss://fake-feed.example',
  });

  const received = [];
  feed.on('tick', (t) => received.push(t));

  await feed.connect([{ exchangeSegment: 'NSE_EQ', securityId: '2885' }]);
  const ws = FakeWebSocket.instances[0];
  ws.emit('open');
  ws.emit('message', Buffer.from('irrelevant-because-decoder-is-faked'));

  assert.deepEqual(received, fakeTicks);
});

test('on close, schedules a reconnect with increasing backoff', async () => {
  FakeWebSocket.instances = [];
  const scheduled = [];
  const scheduler = (fn, ms) => scheduled.push({ fn, ms });

  const feed = createDhanFeed({
    clientId: '1100011000',
    accessToken: 'test-token',
    decodeMessage: () => [],
    WebSocketImpl: FakeWebSocket,
    baseUrl: 'wss://fake-feed.example',
    scheduler,
  });

  await feed.connect([{ exchangeSegment: 'NSE_EQ', securityId: '2885' }]);
  FakeWebSocket.instances[0].emit('close');
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].ms, 1000);

  await scheduled[0].fn();
  FakeWebSocket.instances[1].emit('close');
  assert.equal(scheduled.length, 2);
  assert.equal(scheduled[1].ms, 2000);
});

test('close() stops the reconnect loop instead of scheduling another reconnect', async () => {
  FakeWebSocket.instances = [];
  const scheduled = [];
  const scheduler = (fn, ms) => scheduled.push({ fn, ms });

  const feed = createDhanFeed({
    clientId: '1100011000',
    accessToken: 'test-token',
    decodeMessage: () => [],
    WebSocketImpl: FakeWebSocket,
    baseUrl: 'wss://fake-feed.example',
    scheduler,
  });

  await feed.connect([{ exchangeSegment: 'NSE_EQ', securityId: '2885' }]);
  feed.close();
  FakeWebSocket.instances[0].emit('close');

  assert.equal(scheduled.length, 0);
});
