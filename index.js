'use strict';
const { app }    = require('./src/server');
const { connect } = require('./src/binanceWs');
const config     = require('./src/config');

const PORT = config.PORT;

// ── Banner ────────────────────────────────────────────────────────────────────
console.log('');
console.log('╔══════════════════════════════════════════════════════╗');
console.log('║     Binance WebSocket → n8n Bridge  v1.0             ║');
console.log('╚══════════════════════════════════════════════════════╝');
console.log(`  Pairs monitored   : ${config.PAIRS.length}`);
console.log(`  Threshold         : ±${config.PRICE_CHANGE_THRESHOLD}%`);
console.log(`  Cooldown          : ${config.COOLDOWN_MS / 1000}s per coin`);
console.log(`  Volume check      : ${config.VOLUME_SPIKE_MULTIPLIER > 0 ? `${config.VOLUME_SPIKE_MULTIPLIER}x spike` : 'disabled'}`);
console.log(`  n8n webhook       : ${config.N8N_WEBHOOK_URL || '⚠️  NOT SET'}`);
console.log('');

// ── Start Express ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[Server] 🚀 Running on http://localhost:${PORT}`);
  console.log(`[Server]    Endpoints: GET /health  |  GET /status  |  POST /config/threshold`);
  console.log('');
});

// ── Start Binance WebSocket ───────────────────────────────────────────────────
connect();

// ── Graceful shutdown ─────────────────────────────────────────────────────────
process.on('SIGINT', () => {
  console.log('\n[Server] 🛑 Shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n[Server] 🛑 SIGTERM received, shutting down...');
  process.exit(0);
});

process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught exception:', err);
  process.exit(1);
});
