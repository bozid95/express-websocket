'use strict';
require('dotenv').config();

// ── Top 100 Binance Futures pairs (by volume/popularity) ──────────────────────
const TOP_100_PAIRS = [
  'BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT','ADAUSDT','DOGEUSDT',
  'AVAXUSDT','LINKUSDT','DOTUSDT','MATICUSDT','LTCUSDT','BCHUSDT','ATOMUSDT',
  'ETCUSDT','XLMUSDT','NEARUSDT','ALGOUSDT','VETUSDT','FTMUSDT','MANAUSDT',
  'SANDUSDT','AXSUSDT','GALLUSDT','APEUSDT','SHIBUSDT','TRXUSDT','FILUSDT',
  'ICPUSDT','AAVEUSDT','UNIUSDT','EGLDUSDT','FLOWUSDT','THETAUSDT','KSMUSDT',
  'XTZUSDT','MKRUSDT','RUNEUSDT','CAKEUSDT','NEOUSDT','WAVESUSDT','KLAYUSDT',
  'ZILUSDT','HNTUSDT','CHZUSDT','ENJUSDT','BATUSDT','ZECUSDT','DASHUSDT',
  'COMPUSDT','YFIUSDT','SNXUSDT','SUSHIUSDT','CRVUSDT','BALUSDT','RENUSDT',
  'UMAUSDT','BANDUSDTBAND','STORJUSDT','OCEANUSDT','ANKRUSDT','IOTAUSDT',
  'ONTUSDT','QTUMUSDT','ZENUSDT','LRCUSDT','SKLUSDT','CELRUSDT','COTIUSDT',
  'STXUSDT','RVNUSDT','HOTUSDT','SCUSDT','DGBUSDT','DENTUSDT','REEFUSDT',
  'TFUELUSDT','XVGUSDT','MDTUSDT','WOOUSDT','GMTUSDT','GALUSDT','LDOUSDT',
  'OPUSDT','ARBUSDT','INJUSDT','SUIUSDT','SEIUSDT','TIAUSDT','ORDIUSDT',
  'WIFUSDT','BONKUSDT','JUPUSDT','STRKUSDT','PIXELUSDT','AEVOUSDT','BOMEUSDT',
  'WUSDT','ENAUSDT',
].filter((v, i, a) => a.indexOf(v) === i); // deduplicate

function getPairs() {
  const mode = (process.env.PAIRS_MODE || 'top100').toLowerCase();
  if (mode === 'custom') {
    const raw = process.env.CUSTOM_PAIRS || '';
    const list = raw.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    if (list.length === 0) {
      console.warn('[Config] PAIRS_MODE=custom but CUSTOM_PAIRS is empty. Falling back to top100.');
      return TOP_100_PAIRS;
    }
    return list;
  }
  return TOP_100_PAIRS;
}

const config = {
  PORT: parseInt(process.env.PORT || '3000', 10),
  N8N_WEBHOOK_URL: process.env.N8N_WEBHOOK_URL || '',
  PRICE_CHANGE_THRESHOLD: parseFloat(process.env.PRICE_CHANGE_THRESHOLD || '3.0'),
  VOLUME_SPIKE_MULTIPLIER: parseFloat(process.env.VOLUME_SPIKE_MULTIPLIER || '0'),
  COOLDOWN_MS: parseInt(process.env.COOLDOWN_MS || '300000', 10),
  PAIRS: getPairs(),
};

// Allow runtime override (used by /config/threshold endpoint)
config.setThreshold = (val) => {
  const n = parseFloat(val);
  if (isNaN(n) || n <= 0) throw new Error('Threshold must be a positive number');
  config.PRICE_CHANGE_THRESHOLD = n;
};

module.exports = config;
