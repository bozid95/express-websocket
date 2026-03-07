'use strict';
const axios = require('axios');
const config = require('./config');

/**
 * Send an HTTP POST to the configured n8n webhook URL.
 * @param {Object} payload - Coin alert data
 */
async function triggerN8n(payload) {
  const url = config.N8N_WEBHOOK_URL;

  if (!url || url.includes('your-n8n-instance')) {
    console.warn(`[n8n] ⚠️  N8N_WEBHOOK_URL is not configured. Skipping trigger for ${payload.symbol}.`);
    console.warn(`[n8n]     Set N8N_WEBHOOK_URL in your .env file.`);
    return;
  }

  try {
    const res = await axios.post(url, payload, {
      timeout: 10000, // 10s timeout
      headers: { 'Content-Type': 'application/json' },
    });
    console.log(`[n8n] ✅ Triggered for ${payload.symbol} → HTTP ${res.status}`);
  } catch (err) {
    if (err.response) {
      console.error(`[n8n] ❌ HTTP ${err.response.status} for ${payload.symbol}: ${JSON.stringify(err.response.data)}`);
    } else if (err.request) {
      console.error(`[n8n] ❌ No response for ${payload.symbol} (timeout/network): ${err.message}`);
    } else {
      console.error(`[n8n] ❌ Request error for ${payload.symbol}: ${err.message}`);
    }
  }
}

module.exports = { triggerN8n };
