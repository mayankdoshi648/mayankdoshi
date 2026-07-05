const { WebSocketServer } = require('ws');

function createLiveSocketServer(httpServer, path = '/live') {
  const wss = new WebSocketServer({ server: httpServer, path });

  function broadcast(event) {
    const payload = JSON.stringify(event);
    for (const client of wss.clients) {
      if (client.readyState === client.OPEN) client.send(payload);
    }
  }

  return { wss, broadcast };
}

module.exports = { createLiveSocketServer };
