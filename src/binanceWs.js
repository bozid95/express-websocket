'use strict';
const config = require('./config');
const { applyFilter } = require('./filter');

const WebSocket = require('ws');

// ── State ─────────────────────────────────────────────────────────────────────
const state = {
  connected: false,
  reconnectAttempts: 0,
  startedAt: new Date().toISOString(),
  totalMessages: 0,
  ws: null,
};

// ── Build multi-stream URL ─────────────────────────────────────────────────────
function buildStreamUrl(pairs) {
  // Each pair subscribes to the 24hr ticker stream
  const streams = pairs.map(p => `${p.toLowerCase()}@ticker`).join('/');
  return `wss://fstream.binance.com/stream?streams=${streams}`;
}

// ── Connect ───────────────────────────────────────────────────────────────────
function connect() {
  const url = buildStreamUrl(config.PAIRS);
  console.log(`[WS] Connecting to Binance Futures (${config.PAIRS.length} pairs)...`);

  const ws = new WebSocket(url);
  state.ws = ws;

  ws.on('open', () => {
    state.connected = true;
    state.reconnectAttempts = 0;
    console.log(`[WS] ✅ Connected to Binance Futures WebSocket`);
  });

  ws.on('message', (raw) => {
    try {
      state.totalMessages++;
      const parsed = JSON.parse(raw);
      // Multi-stream format: { stream: "btcusdt@ticker", data: { ... } }
      const data = parsed.data || parsed;
      if (data && data.e === '24hrTicker') {
        applyFilter(data);
      }
    } catch (err) {
      // Ignore malformed messages silently
    }
  });

  ws.on('close', (code, reason) => {
    state.connected = false;
    state.ws = null;
    const delay = getReconnectDelay();
    console.warn(`[WS] ⚠️  Disconnected (code=${code}). Reconnecting in ${delay / 1000}s...`);
    setTimeout(connect, delay);
  });

  ws.on('error', (err) => {
    console.error(`[WS] ❌ Error: ${err.message}`);
    // 'close' event fires after 'error', reconnect handled there
  });
}

// ── Exponential backoff (max 60s) ─────────────────────────────────────────────
function getReconnectDelay() {
  state.reconnectAttempts++;
  const delay = Math.min(1000 * Math.pow(2, state.reconnectAttempts - 1), 60000);
  return delay;
}

// ── Public API ────────────────────────────────────────────────────────────────
function getState() {
  return {
    connected: state.connected,
    reconnectAttempts: state.reconnectAttempts,
    startedAt: state.startedAt,
    totalMessages: state.totalMessages,
    pairsMonitored: config.PAIRS.length,
  };
}

module.exports = { connect, getState };
