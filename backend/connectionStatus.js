// backend/connectionStatus.js
function createConnectionStatus() {
  let connected = false;
  let lastError = null;

  return {
    setConnected(value) {
      connected = value;
      if (value) lastError = null;
    },
    setError(err) {
      if (err === null || err === undefined) {
        lastError = null;
      } else {
        lastError = err instanceof Error ? err.message : String(err);
      }
    },
    isConnected() {
      return connected;
    },
    getLastError() {
      return lastError;
    },
  };
}

module.exports = { createConnectionStatus };
