// backend/dhanFeed.js
const WebSocket = require('ws');
const { EventEmitter } = require('node:events');

const QUOTE_PACKET_CODE = 4;
const REQUEST_CODE_QUOTE = 17;

function decodeQuotePacket(buffer) {
  if (buffer.length < 50 || buffer.readUInt8(0) !== QUOTE_PACKET_CODE) return [];
  const securityId = buffer.readInt32LE(4);
  const ltp = buffer.readFloatLE(8);
  const ltq = buffer.readUInt16LE(12);
  const ltt = buffer.readUInt32LE(14);
  return [{ symbol: String(securityId), ltp, ltq, timestamp: ltt * 1000 }];
}

function createDhanFeed({
  clientId,
  accessToken,
  decodeMessage = decodeQuotePacket,
  WebSocketImpl = WebSocket,
  scheduler = (fn, ms) => setTimeout(fn, ms),
  baseUrl = 'wss://api-feed.dhan.co',
}) {
  const emitter = new EventEmitter();
  let ws = null;
  let reconnectDelay = 1000;
  let stopped = false;
  const MAX_DELAY_MS = 30000;

  async function connect(instruments) {
    stopped = false;
    const url = `${baseUrl}?version=2&token=${accessToken}&clientId=${clientId}&authType=2`;
    ws = new WebSocketImpl(url);

    ws.on('open', () => {
      reconnectDelay = 1000;
      ws.send(JSON.stringify({
        RequestCode: REQUEST_CODE_QUOTE,
        InstrumentCount: instruments.length,
        InstrumentList: instruments.map((i) => ({ ExchangeSegment: i.exchangeSegment, SecurityId: i.securityId })),
      }));
      emitter.emit('connected');
    });

    ws.on('message', (data) => {
      const ticks = decodeMessage(data);
      for (const tick of ticks) emitter.emit('tick', tick);
    });

    ws.on('close', () => {
      emitter.emit('disconnected');
      if (!stopped) scheduleReconnect(instruments);
    });

    ws.on('error', (err) => emitter.emit('error', err));
  }

  function scheduleReconnect(instruments) {
    scheduler(() => connect(instruments).catch((err) => emitter.emit('error', err)), reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_DELAY_MS);
  }

  function close() {
    stopped = true;
    if (ws) ws.close();
  }

  return { connect, close, on: emitter.on.bind(emitter) };
}

module.exports = { createDhanFeed, decodeQuotePacket };
