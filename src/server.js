'use strict';
const express = require('express');
const config  = require('./config');
const { getState } = require('./binanceWs');
const { getStats }  = require('./filter');

const app    = express();
const bootAt = Date.now();

app.use(express.json());

// ── GET /health ───────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  const { connected } = getState();
  res.status(connected ? 200 : 503).json({
    status: connected ? 'ok' : 'degraded',
    uptime: formatUptime(Date.now() - bootAt),
    wsConnected: connected,
    timestamp: new Date().toISOString(),
  });
});

// ── GET /status ───────────────────────────────────────────────────────────────
app.get('/status', (req, res) => {
  const ws      = getState();
  const filter  = getStats();

  // Build per-coin list sorted by lastAt desc
  const coins = Object.entries(filter.perCoin)
    .map(([symbol, data]) => ({ symbol, ...data }))
    .sort((a, b) => (b.lastAt || '').localeCompare(a.lastAt || ''));

  res.json({
    websocket: {
      connected:        ws.connected,
      pairsMonitored:   ws.pairsMonitored,
      totalMessages:    ws.totalMessages,
      startedAt:        ws.startedAt,
      reconnectAttempts: ws.reconnectAttempts,
    },
    filter: {
      currentThreshold:   config.PRICE_CHANGE_THRESHOLD,
      volumeMultiplier:   config.VOLUME_SPIKE_MULTIPLIER,
      cooldownMs:         config.COOLDOWN_MS,
      totalChecked:       filter.totalChecked,
      totalPassed:        filter.totalPassed,
      totalBlocked:       filter.totalBlocked,
    },
    triggeredCoins: coins,
    uptime: formatUptime(Date.now() - bootAt),
    timestamp: new Date().toISOString(),
  });
});

// ── POST /config/threshold ────────────────────────────────────────────────────
app.post('/config/threshold', (req, res) => {
  const { threshold } = req.body;
  if (threshold === undefined || threshold === null) {
    return res.status(400).json({ error: 'Missing "threshold" field in request body.' });
  }
  try {
    config.setThreshold(threshold);
    console.log(`[Config] ✏️  Threshold updated to ${config.PRICE_CHANGE_THRESHOLD}%`);
    res.json({
      message: `Threshold updated to ${config.PRICE_CHANGE_THRESHOLD}%`,
      threshold: config.PRICE_CHANGE_THRESHOLD,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── POST /config/cooldown ─────────────────────────────────────────────────────
app.post('/config/cooldown', (req, res) => {
  const { cooldownMs } = req.body;
  const val = parseInt(cooldownMs, 10);
  if (isNaN(val) || val < 0) {
    return res.status(400).json({ error: '"cooldownMs" must be a non-negative integer.' });
  }
  config.COOLDOWN_MS = val;
  console.log(`[Config] ✏️  Cooldown updated to ${val}ms`);
  res.json({ message: `Cooldown updated to ${val}ms`, cooldownMs: val });
});

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    error: 'Not found',
    availableEndpoints: [
      'GET  /health',
      'GET  /status',
      'POST /config/threshold',
      'POST /config/cooldown',
    ],
  });
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatUptime(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}h ${m}m ${sec}s`;
}

module.exports = { app };
