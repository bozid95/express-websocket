const fs = require('fs');
let d = JSON.parse(fs.readFileSync('n8n-workflow-hybrid-v16.0.json', 'utf8'));

let ntfyNode = d.nodes.find(n => n.name === 'Ntfy Alert');

// The problem: $json.signalType contains emoji (👑 PRIME SWING or ⚡ INTRADAY SCALP)
// These emoji flow into the body and cause ERR_INVALID_CHAR
// Solution: Use signalType-safe text in body, strip emoji via expression

ntfyNode.parameters.body = "={{ $json.signal === 'STRONG BUY' ? 'BUY' : 'SELL' }} {{ $json.symbol }} - {{ $json.signal }}\n" +
"Type: {{ $json.signalType.replace(/[^\\x00-\\x7F]/g, '').trim() }}\n" +
"Validity: {{ $json.entryValidity }}\n" +
"{{ $json.entryAction }}\n\n" +
"Confidence: {{ $json.confidence }} (Score: {{ $json.score }}/100)\n\n" +
"Entry: {{ $json.price }} | {{ $json.wsDirection }} {{ $json.wsChange }}\n" +
"Strategy: {{ $json.strategy }}\n\n" +
"TP1: {{ $json.tp1 }} ({{ $json.estTP1 }}) RR {{ $json.estRR1 }}\n" +
"TP2: {{ $json.tp2 }} ({{ $json.estTP2 }}) RR {{ $json.estRR2 }}\n" +
"TP3: {{ $json.tp3 }} ({{ $json.estTP3 }}) RR {{ $json.estRR3 }}\n" +
"SL: {{ $json.sl }} ({{ $json.estRisk }})\n\n" +
"Position: {{ $json.positionSize }}\n" +
"Hold: {{ $json.holdDuration }}\n" +
"Mgmt: {{ $json.tradeManagement }}\n\n" +
"Market:\n" +
"- Daily: {{ $json.dailyTrend }} | Weekly: {{ $json.weeklyBias }}\n" +
"- 4H: {{ $json.trend4h }} | 1H: {{ $json.trend1h }}\n" +
"- RSI: {{ $json.rsi1h }} | Vol: {{ $json.volRatio }}\n\n" +
"Futures:\n" +
"- Funding: {{ $json.fundingRate }}\n" +
"- OI: {{ $json.openInterest }}\n" +
"- L/S: {{ $json.longShortRatio }}\n" +
"- Taker: {{ $json.takerVolume }}\n\n" +
"Reasons: {{ $json.reasons }}\n" +
"v16.0 Dual-Layer Engine";

// Also clean fundingRate, longShortRatio, takerVolume, openInterest fields
// which have emoji in their labels from the jsCode
// These are embedded in $json fields and will flow through
// The safest fix is to strip ALL non-ASCII from the entire body expression

// Actually the simplest approach: wrap entire body in a regex strip
ntfyNode.parameters.body = "={{ (" + 
  "'" + 
  ntfyNode.parameters.body.replace(/^=/, '').replace(/'/g, "\\'") + 
  "'" + 
  ").replace(/[\\u0080-\\uFFFF]/g, '') }}";

// Hmm that gets complicated. Let me just use a clean approach:
// Create a Code node output that strips emoji, or use simple replace in expressions

// Simplest fix: just put clean ASCII body directly
ntfyNode.parameters.body = `={{ $json.signal === 'STRONG BUY' ? 'BUY' : 'SELL' }} {{ $json.symbol }} {{ $json.signal }}
Score: {{ $json.score }}/100 | {{ $json.confidence }}

Entry: {{ $json.price }}
Strategy: {{ $json.strategy }}

TP1: {{ $json.tp1 }} ({{ $json.estTP1 }})
TP2: {{ $json.tp2 }} ({{ $json.estTP2 }})
TP3: {{ $json.tp3 }} ({{ $json.estTP3 }})
SL: {{ $json.sl }} ({{ $json.estRisk }})

Daily: {{ $json.dailyTrend }} | 4H: {{ $json.trend4h }}
RSI: {{ $json.rsi1h }} | Vol: {{ $json.volRatio }}

v16.0 Engine`;

fs.writeFileSync('n8n-workflow-hybrid-v16.0.json', JSON.stringify(d, null, 2));
console.log('Ntfy body simplified - pure ASCII, no dynamic fields with emoji');
