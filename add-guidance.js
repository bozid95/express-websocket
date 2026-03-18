const fs = require('fs');
const data = JSON.parse(fs.readFileSync('n8n-workflow-hybrid-v16.0.json', 'utf8'));

// ═══ 1. ADD ENTRY GUIDANCE FIELDS TO jsCode OUTPUT ═══
const codeNode = data.nodes.find(n => n.name.includes('Pro Analisa'));
let code = codeNode.parameters.jsCode;

// Add computed guidance fields before the final return statement
const guidanceCode = `
// ═══ PRO ENTRY GUIDANCE ═══
var entryValidity = 'SKIP';
var entryEmoji = '';
var entryAction = '';
var positionSize = '';
var tradeManagement = '';
var holdDuration = '';

if (isStrongSignal && signalType === 'PRIME_SWING') {
  if (score >= 80) {
    entryValidity = 'SANGAT VALID';
    entryEmoji = '\\ud83d\\udfe2\\ud83d\\udfe2\\ud83d\\udfe2';
    entryAction = 'ENTRY SEKARANG - Setup Premium. Langsung pasang order.';
    positionSize = '2-3% dari modal (High Conviction)';
    holdDuration = '4 Jam - 2 Hari';
  } else if (score >= 68) {
    entryValidity = 'VALID';
    entryEmoji = '\\ud83d\\udfe2\\ud83d\\udfe2';
    entryAction = 'ENTRY SEKARANG - Setup bagus. Pasang order segera.';
    positionSize = '1-2% dari modal (Normal)';
    holdDuration = '4 Jam - 1 Hari';
  } else {
    entryValidity = 'CUKUP VALID';
    entryEmoji = '\\ud83d\\udfe2';
    entryAction = 'ENTRY HATI-HATI - Setup lumayan. Tunggu konfirmasi 5 menit.';
    positionSize = '0.5-1% dari modal (Conservative)';
    holdDuration = '2 - 8 Jam';
  }
  tradeManagement = 'TP1 hit \\u2192 Geser SL ke Entry (Break-Even). TP2 hit \\u2192 Close 50%, trail sisanya ke TP3.';
} else if (isStrongSignal && signalType === 'INTRADAY_SCALP') {
  if (score >= 70) {
    entryValidity = 'VALID (SCALP)';
    entryEmoji = '\\u26a1\\u26a1';
    entryAction = 'SCALP ENTRY - Momentum kuat. Pasang order + SL ketat.';
    positionSize = '1-1.5% dari modal (Scalp Size)';
    holdDuration = '15 Menit - 2 Jam';
  } else if (score >= 55) {
    entryValidity = 'CUKUP VALID (SCALP)';
    entryEmoji = '\\u26a1';
    entryAction = 'SCALP HATI-HATI - Momentum sedang. Tunggu candle close 5m hijau.';
    positionSize = '0.5-1% dari modal (Small Scalp)';
    holdDuration = '15 Menit - 1 Jam';
  } else {
    entryValidity = 'RENDAH (SCALP)';
    entryEmoji = '\\u26a0\\ufe0f';
    entryAction = 'OPSIONAL - Skor rendah. Skip jika ragu, atau masuk minimal.';
    positionSize = '0.25-0.5% dari modal (Micro)';
    holdDuration = '5 - 30 Menit';
  }
  tradeManagement = 'TP1 hit \\u2192 CLOSE 100% (jangan serakah). Atau geser SL ke BE dan target TP2.';
}
`;

// Insert guidance code before the final return statement
code = code.replace(
  'return [{json:{',
  guidanceCode + '\nreturn [{json:{'
);

// Add the new fields to the output JSON
code = code.replace(
  "  version:'v16.0',",
  `  entryValidity:entryValidity,
  entryEmoji:entryEmoji,
  entryAction:entryAction,
  positionSize:positionSize,
  tradeManagement:tradeManagement,
  holdDuration:holdDuration,
  version:'v16.0',`
);

codeNode.parameters.jsCode = code;

// ═══ 2. UPDATE TELEGRAM TEMPLATE ═══
const tgNode = data.nodes.find(n => n.name.includes('Telegram'));
if (tgNode) {
  tgNode.parameters.text = `={{ $json.signal === 'STRONG BUY' ? '🟢' : '🔴' }} *{{ $json.symbol }} — {{ $json.signal }}*
{{ $json.signalType }}

{{ $json.entryEmoji }} *VALIDITAS: {{ $json.entryValidity }}*
📋 *{{ $json.entryAction }}*

🎯 *Entry:* \`{{ $json.price }}\`
📊 *WS Trigger:* {{ $json.wsDirection }} {{ $json.wsChange }}
🧠 *Strategy:* {{ $json.strategy }}

*💎 Target Profit:*
├ 🥇 *TP1:* \`{{ $json.tp1 }}\` ({{ $json.estTP1 }}) — RR {{ $json.estRR1 }}
├ 🥈 *TP2:* \`{{ $json.tp2 }}\` ({{ $json.estTP2 }}) — RR {{ $json.estRR2 }}
├ 🥉 *TP3:* \`{{ $json.tp3 }}\` ({{ $json.estTP3 }}) — RR {{ $json.estRR3 }}
├ 🛡️ *SL:* \`{{ $json.sl }}\` ({{ $json.estRisk }})
└ 📐 ATR: {{ $json.atr }} ({{ $json.atrPct }})

*📌 Panduan Pro Trader:*
├ 💰 *Lot Size:* {{ $json.positionSize }}
├ ⏱ *Hold:* {{ $json.holdDuration }}
└ 📖 *Manajemen:* {{ $json.tradeManagement }}

*📡 Market Intelligence:*
├ 📅 Daily: {{ $json.dailyTrend }} | Weekly: {{ $json.weeklyBias }}
├ 4H: {{ $json.trend4h }} | 1H: {{ $json.trend1h }}
├ Structure: {{ $json.marketStructure }}
├ RSI: {{ $json.rsi1h }} | MACD: {{ $json.macdCross }}
├ Vol: {{ $json.volRatio }}
└ {{ $json.macroTrend }}

*⚡ Futures Intelligence:*
├ Funding: {{ $json.fundingRate }}
├ Open Interest: {{ $json.openInterest }}
├ L/S Ratio: {{ $json.longShortRatio }}
└ Taker: {{ $json.takerVolume }}

*Support & Resistance:*
├ 🔺 Res: \`{{ $json.resistance }}\` ({{ $json.distResistance }})
└ 🔻 Sup: \`{{ $json.support }}\` ({{ $json.distSupport }})

💡 _{{ $json.reasons }}_

🤖 _v16.0 Dual-Layer Engine | {{ $json.signalType }}_
🔗 [Binance](https://www.binance.com/en/futures/{{ $json.symbol }}) | [TV](https://www.tradingview.com/chart/?symbol=BINANCE:{{ $json.symbol }}.P)
{{ $json.volumeWarning ? "\\n⚠️ " + $json.volumeWarning : "" }}
⏰ {{ $now.setZone('Asia/Jakarta').format('dd MMM HH:mm') }} WIB`;
}

// ═══ 3. UPDATE NTFY TEMPLATE (if exists) ═══
const ntfyNode = data.nodes.find(n => n.name.toLowerCase().includes('ntfy'));
if (ntfyNode && ntfyNode.parameters.sendBody) {
  // Update ntfy message body
  const bodyParams = ntfyNode.parameters.bodyParameters?.parameters || [];
  const msgParam = bodyParams.find(p => p.name === 'message');
  if (msgParam) {
    msgParam.value = `={{ $json.signalType }} {{ $json.symbol }} {{ $json.signal }}
Validity: {{ $json.entryValidity }}
{{ $json.entryAction }}

Entry: {{ $json.price }}
TP1: {{ $json.tp1 }} ({{ $json.estTP1 }})
TP2: {{ $json.tp2 }} ({{ $json.estTP2 }})
SL: {{ $json.sl }} ({{ $json.estRisk }})

Lot: {{ $json.positionSize }}
Hold: {{ $json.holdDuration }}
Management: {{ $json.tradeManagement }}

Score: {{ $json.score }}/100 | {{ $json.reasons }}`;
  }
}

fs.writeFileSync('n8n-workflow-hybrid-v16.0.json', JSON.stringify(data, null, 2));
console.log('Updated v16.0 with Pro Entry Guidance');
console.log('jsCode length:', codeNode.parameters.jsCode.length);
