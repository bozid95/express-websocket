const fs = require('fs');
const data = JSON.parse(fs.readFileSync('n8n-workflow-hybrid-v16.0.json', 'utf8'));

// ═══ 1. UPDATE jsCode GUIDANCE LABELS TO ENGLISH ═══
const codeNode = data.nodes.find(n => n.name.includes('Pro Analisa'));
let code = codeNode.parameters.jsCode;

// PRIME SWING guidance — score >= 80
code = code.replace("entryValidity = 'SANGAT VALID'", "entryValidity = 'HIGHLY VALID'");
code = code.replace("entryAction = 'ENTRY SEKARANG - Setup Premium. Langsung pasang order.'", "entryAction = 'ENTER NOW - Premium Setup. Place order immediately.'");
code = code.replace("positionSize = '2-3% dari modal (High Conviction)'", "positionSize = '2-3% of capital (High Conviction)'");
code = code.replace("holdDuration = '4 Jam - 2 Hari'", "holdDuration = '4 Hours - 2 Days'");

// PRIME SWING — score >= 68
code = code.replace("entryAction = 'ENTRY SEKARANG - Setup bagus. Pasang order segera.'", "entryAction = 'ENTER NOW - Strong Setup. Place order promptly.'");
code = code.replace("positionSize = '1-2% dari modal (Normal)'", "positionSize = '1-2% of capital (Standard)'");
code = code.replace("holdDuration = '4 Jam - 1 Hari'", "holdDuration = '4 Hours - 1 Day'");

// PRIME SWING — score >= 58
code = code.replace("entryValidity = 'CUKUP VALID'", "entryValidity = 'MODERATELY VALID'");
code = code.replace("entryAction = 'ENTRY HATI-HATI - Setup lumayan. Tunggu konfirmasi 5 menit.'", "entryAction = 'CAUTIOUS ENTRY - Decent setup. Wait for 5min candle confirmation.'");
code = code.replace("positionSize = '0.5-1% dari modal (Conservative)'", "positionSize = '0.5-1% of capital (Conservative)'");
code = code.replace("holdDuration = '2 - 8 Jam'", "holdDuration = '2 - 8 Hours'");

// PRIME SWING — trade management
code = code.replace(
  "tradeManagement = 'TP1 hit \\u2192 Geser SL ke Entry (Break-Even). TP2 hit \\u2192 Close 50%, trail sisanya ke TP3.';",
  "tradeManagement = 'TP1 hit \\u2192 Move SL to Entry (Break-Even). TP2 hit \\u2192 Close 50%, trail rest to TP3.';"
);

// INTRADAY — score >= 70
code = code.replace("entryValidity = 'VALID (SCALP)'", "entryValidity = 'VALID (SCALP)'"); // already English
code = code.replace("entryAction = 'SCALP ENTRY - Momentum kuat. Pasang order + SL ketat.'", "entryAction = 'SCALP ENTRY - Strong momentum. Place order with tight SL.'");
code = code.replace("positionSize = '1-1.5% dari modal (Scalp Size)'", "positionSize = '1-1.5% of capital (Scalp Size)'");
code = code.replace("holdDuration = '15 Menit - 2 Jam'", "holdDuration = '15 Min - 2 Hours'");

// INTRADAY — score >= 55
code = code.replace("entryValidity = 'CUKUP VALID (SCALP)'", "entryValidity = 'MODERATE (SCALP)'");
code = code.replace("entryAction = 'SCALP HATI-HATI - Momentum sedang. Tunggu candle close 5m hijau.'", "entryAction = 'CAUTIOUS SCALP - Moderate momentum. Wait for green 5m candle close.'");
code = code.replace("positionSize = '0.5-1% dari modal (Small Scalp)'", "positionSize = '0.5-1% of capital (Small Scalp)'");
code = code.replace("holdDuration = '15 Menit - 1 Jam'", "holdDuration = '15 Min - 1 Hour'");

// INTRADAY — score >= 40
code = code.replace("entryValidity = 'RENDAH (SCALP)'", "entryValidity = 'LOW (SCALP)'");
code = code.replace("entryAction = 'OPSIONAL - Skor rendah. Skip jika ragu, atau masuk minimal.'", "entryAction = 'OPTIONAL - Low score. Skip if unsure, or enter minimal size.'");
code = code.replace("positionSize = '0.25-0.5% dari modal (Micro)'", "positionSize = '0.25-0.5% of capital (Micro)'");
code = code.replace("holdDuration = '5 - 30 Menit'", "holdDuration = '5 - 30 Min'");

// INTRADAY trade management
code = code.replace(
  "tradeManagement = 'TP1 hit \\u2192 CLOSE 100% (jangan serakah). Atau geser SL ke BE dan target TP2.';",
  "tradeManagement = 'TP1 hit \\u2192 CLOSE 100% (don\\'t be greedy). Or move SL to BE and target TP2.';"
);

codeNode.parameters.jsCode = code;

// ═══ 2. UPDATE TELEGRAM TEMPLATE TO FULL ENGLISH ═══
const tgNode = data.nodes.find(n => n.name.includes('Telegram'));
if (tgNode) {
  tgNode.parameters.text = `={{ $json.signal === 'STRONG BUY' ? '🟢' : '🔴' }} *{{ $json.symbol }} — {{ $json.signal }}*
{{ $json.signalType }}

{{ $json.entryEmoji }} *VALIDITY: {{ $json.entryValidity }}*
📋 *{{ $json.entryAction }}*

🎯 *Entry:* \`{{ $json.price }}\`
📊 *Trigger:* {{ $json.wsDirection }} {{ $json.wsChange }}
🧠 *Strategy:* {{ $json.strategy }}

*💎 Profit Targets:*
├ 🥇 *TP1:* \`{{ $json.tp1 }}\` ({{ $json.estTP1 }}) — RR {{ $json.estRR1 }}
├ 🥈 *TP2:* \`{{ $json.tp2 }}\` ({{ $json.estTP2 }}) — RR {{ $json.estRR2 }}
├ 🥉 *TP3:* \`{{ $json.tp3 }}\` ({{ $json.estTP3 }}) — RR {{ $json.estRR3 }}
├ 🛡️ *SL:* \`{{ $json.sl }}\` ({{ $json.estRisk }})
└ 📐 ATR: {{ $json.atr }} ({{ $json.atrPct }})

*📌 Pro Trader Guide:*
├ 💰 *Position Size:* {{ $json.positionSize }}
├ ⏱ *Hold Duration:* {{ $json.holdDuration }}
└ 📖 *Management:* {{ $json.tradeManagement }}

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

// ═══ 3. UPDATE NTFY NODE (if exists) ═══
const ntfyNode = data.nodes.find(n => n.name && n.name.toLowerCase().includes('ntfy'));
if (ntfyNode) {
  try {
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

Position: {{ $json.positionSize }}
Hold: {{ $json.holdDuration }}
Mgmt: {{ $json.tradeManagement }}

Score: {{ $json.score }}/100 | {{ $json.reasons }}`;
    }
  } catch(e) {}
}

fs.writeFileSync('n8n-workflow-hybrid-v16.0.json', JSON.stringify(data, null, 2));
console.log('All signal output updated to English!');
console.log('jsCode length:', codeNode.parameters.jsCode.length);
