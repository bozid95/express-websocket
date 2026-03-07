'use strict';
const config = require('./config');
const { triggerN8n } = require('./n8nTrigger');

// ── Per-coin cooldown tracker ──────────────────────────────────────────────────
// Map<symbol, lastTriggerTimestamp>
const cooldownMap = new Map();

// ── Stats (exposed to /status) ────────────────────────────────────────────────
const stats = {
  totalChecked: 0,
  totalPassed: 0,
  totalBlocked: 0,
  perCoin: {},   // symbol → { triggered, lastAt, lastPercent }
};

/**
 * Called for every 24hrTicker event from Binance.
 * Applies filter rules and forwards to n8n if criteria met.
 *
 * Ticker fields we use:
 *   s  = symbol          (e.g. "BTCUSDT")
 *   P  = priceChangePercent (e.g. "4.23" or "-2.10")
 *   c  = lastPrice
 *   h  = highPrice
 *   l  = lowPrice
 *   v  = baseVolume
 *   q  = quoteVolume
 */
function applyFilter(ticker) {
  const symbol       = ticker.s;
  const pctChange    = parseFloat(ticker.P);
  const lastPrice    = parseFloat(ticker.c);
  const highPrice    = parseFloat(ticker.h);
  const lowPrice     = parseFloat(ticker.l);
  const baseVolume   = parseFloat(ticker.v);
  const quoteVolume  = parseFloat(ticker.q);

  stats.totalChecked++;

  // ── Rule 1: Price change threshold ────────────────────────────────────────
  if (Math.abs(pctChange) < config.PRICE_CHANGE_THRESHOLD) {
    return; // Filtered out
  }

  // ── Rule 2: Volume spike (if enabled) ─────────────────────────────────────
  if (config.VOLUME_SPIKE_MULTIPLIER > 0) {
    const baseline = getBaselineVolume(symbol);
    if (baseline !== null && quoteVolume < baseline * config.VOLUME_SPIKE_MULTIPLIER) {
      stats.totalBlocked++;
      return; // Volume didn't spike enough
    }
    // Update rolling baseline
    updateBaselineVolume(symbol, quoteVolume);
  }

  // ── Rule 3: Cooldown per coin ─────────────────────────────────────────────
  const lastTriggered = cooldownMap.get(symbol);
  const now = Date.now();
  if (lastTriggered && now - lastTriggered < config.COOLDOWN_MS) {
    return; // Still in cooldown
  }

  // ── PASSED all filters → trigger n8n ─────────────────────────────────────
  stats.totalPassed++;
  cooldownMap.set(symbol, now);

  if (!stats.perCoin[symbol]) {
    stats.perCoin[symbol] = { triggered: 0, lastAt: null, lastPercent: null };
  }
  stats.perCoin[symbol].triggered++;
  stats.perCoin[symbol].lastAt = new Date().toISOString();
  stats.perCoin[symbol].lastPercent = pctChange;

  const direction = pctChange >= 0 ? '🚀' : '📉';
  console.log(`[FILTER] ${direction} ${symbol} passed: ${pctChange >= 0 ? '+' : ''}${pctChange.toFixed(2)}% | Sending to n8n...`);

  triggerN8n({
    symbol,
    priceChangePercent: pctChange.toFixed(4),
    lastPrice: lastPrice.toFixed(8),
    highPrice: highPrice.toFixed(8),
    lowPrice: lowPrice.toFixed(8),
    volume: baseVolume.toFixed(4),
    quoteVolume: quoteVolume.toFixed(2),
    direction: pctChange >= 0 ? 'UP' : 'DOWN',
    triggeredAt: new Date().toISOString(),
  });
}

// ── Volume baseline (simple rolling average for spike detection) ───────────────
const volumeHistory = new Map(); // symbol → [..last 10 values]
function getBaselineVolume(symbol) {
  const history = volumeHistory.get(symbol);
  if (!history || history.length < 3) return null;
  return history.reduce((a, b) => a + b, 0) / history.length;
}
function updateBaselineVolume(symbol, val) {
  if (!volumeHistory.has(symbol)) volumeHistory.set(symbol, []);
  const h = volumeHistory.get(symbol);
  h.push(val);
  if (h.length > 10) h.shift(); // Keep last 10
}

function getStats() {
  return { ...stats };
}

module.exports = { applyFilter, getStats };
