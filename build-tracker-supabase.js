const fs = require('fs');

// ════════════════════════════════════════════════════
// Part 1: Update v17.0 — Replace Google Sheets with Supabase INSERT
// ════════════════════════════════════════════════════
let wf = JSON.parse(fs.readFileSync('n8n-workflow-hybrid-v17.0.json', 'utf8'));

// Remove old Google Sheets node if exists
wf.nodes = wf.nodes.filter(n => n.name !== 'Log to Google Sheet');
delete wf.connections['Telegram Alert'];

// Add Supabase INSERT node
const supaInsertNode = {
  id: 'supa_insert_1',
  name: 'Save to Supabase',
  type: 'n8n-nodes-base.httpRequest',
  typeVersion: 4.1,
  position: [800, 400],
  parameters: {
    method: 'POST',
    url: "={{ $env.SUPABASE_URL + '/rest/v1/signals' }}",
    sendHeaders: true,
    headerParameters: {
      parameters: [
        { name: 'apikey', value: '={{ $env.SUPABASE_KEY }}' },
        { name: 'Authorization', value: '=Bearer {{ $env.SUPABASE_KEY }}' },
        { name: 'Content-Type', value: 'application/json' },
        { name: 'Prefer', value: 'return=minimal' }
      ]
    },
    sendBody: true,
    specifyBody: 'json',
    jsonBody: `={
  "id": "{{ $json.symbol }}_{{ Date.now() }}",
  "symbol": "{{ $json.symbol }}",
  "signal": "{{ $json.signal }}",
  "signal_type": "{{ $json.signalType }}",
  "entry_price": {{ $json.price }},
  "tp1": {{ $json.tp1 }},
  "tp2": {{ $json.tp2 }},
  "tp3": {{ $json.tp3 }},
  "sl": {{ $json.sl }},
  "score": {{ $json.score }},
  "confidence": "{{ $json.confidence }}",
  "strategy": "{{ $json.strategy }}",
  "reasons": "{{ $json.reasons }}",
  "status": "ACTIVE"
}`,
    options: {}
  }
};

wf.nodes.push(supaInsertNode);
wf.connections['Telegram Alert'] = { main: [[ { node: 'Save to Supabase', type: 'main', index: 0 } ]] };

fs.writeFileSync('n8n-workflow-hybrid-v17.0.json', JSON.stringify(wf, null, 2));
console.log('Part 1: v17.0 updated — Supabase INSERT after Telegram');

// ════════════════════════════════════════════════════
// Part 2: Rebuild Signal Tracker with Supabase
// ════════════════════════════════════════════════════
const tracker = {
  name: 'Signal Performance Tracker v1.0 (Supabase)',
  nodes: [
    // ═══ PRICE CHECKER (every 2 min) ═══
    {
      id: 'trk_cron', name: 'Check Every 2min',
      type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.1,
      position: [200, 400],
      parameters: { rule: { interval: [{ field: 'minutes', minutesInterval: 2 }] } }
    },
    {
      id: 'trk_read', name: 'Get Active Signals',
      type: 'n8n-nodes-base.httpRequest', typeVersion: 4.1,
      position: [450, 400],
      parameters: {
        method: 'GET',
        url: "={{ $env.SUPABASE_URL + '/rest/v1/signals?status=eq.ACTIVE&select=*' }}",
        sendHeaders: true,
        headerParameters: {
          parameters: [
            { name: 'apikey', value: '={{ $env.SUPABASE_KEY }}' },
            { name: 'Authorization', value: '=Bearer {{ $env.SUPABASE_KEY }}' }
          ]
        },
        options: {}
      }
    },
    {
      id: 'trk_prices', name: 'Get Binance Prices',
      type: 'n8n-nodes-base.httpRequest', typeVersion: 4.1,
      position: [700, 400],
      parameters: { url: 'https://fapi.binance.com/fapi/v1/ticker/price', options: {} }
    },
    {
      id: 'trk_check', name: 'Check TP SL Hits',
      type: 'n8n-nodes-base.code', typeVersion: 2,
      position: [950, 400],
      parameters: {
        jsCode: `const signalsRaw = $('Get Active Signals').first().json;
const signals = Array.isArray(signalsRaw) ? signalsRaw : [signalsRaw];
const pricesRaw = $('Get Binance Prices').first().json;
const prices = Array.isArray(pricesRaw) ? pricesRaw : [pricesRaw];
const priceMap = {};
prices.forEach(p => { if(p.symbol) priceMap[p.symbol] = parseFloat(p.price); });

const results = [];
const now = new Date().toISOString();

for (const s of signals) {
  if (!s.symbol || s.status !== 'ACTIVE') continue;
  const cp = priceMap[s.symbol];
  if (!cp) continue;

  const entry = parseFloat(s.entry_price);
  const tp1 = parseFloat(s.tp1);
  const tp2 = parseFloat(s.tp2);
  const tp3 = parseFloat(s.tp3);
  const sl = parseFloat(s.sl);
  const isBuy = s.signal === 'STRONG BUY';

  let status = 'ACTIVE';
  let profitPct = isBuy ? ((cp - entry) / entry * 100) : ((entry - cp) / entry * 100);

  if (isBuy) {
    if (cp <= sl) status = 'SL_HIT';
    else if (cp >= tp3) status = 'TP3_HIT';
    else if (cp >= tp2) status = 'TP2_HIT';
    else if (cp >= tp1) status = 'TP1_HIT';
  } else {
    if (cp >= sl) status = 'SL_HIT';
    else if (cp <= tp3) status = 'TP3_HIT';
    else if (cp <= tp2) status = 'TP2_HIT';
    else if (cp <= tp1) status = 'TP1_HIT';
  }

  // Expire after 24h
  if (status === 'ACTIVE' && s.sent_at) {
    const ageH = (Date.now() - new Date(s.sent_at).getTime()) / 3600000;
    if (ageH > 24) status = 'EXPIRED';
  }

  if (status !== 'ACTIVE') {
    const mins = s.sent_at ? Math.round((Date.now() - new Date(s.sent_at).getTime()) / 60000) : 0;
    const dur = mins >= 60 ? Math.floor(mins/60)+'h '+mins%60+'m' : mins+'m';
    results.push({ json: {
      id: s.id, symbol: s.symbol, signal: s.signal, signal_type: s.signal_type,
      entry_price: s.entry_price, tp1: s.tp1, tp2: s.tp2, tp3: s.tp3, sl: s.sl,
      score: s.score, status, profit_pct: Math.round(profitPct*100)/100,
      hit_time: now, duration: dur, current_price: cp,
      hitTarget: status.replace('_HIT',''), changed: true
    }});
  }
}
if (results.length === 0) return [{ json: { changed: false } }];
return results;`
      }
    },
    {
      id: 'trk_filter', name: 'Has Hits?',
      type: 'n8n-nodes-base.if', typeVersion: 2,
      position: [1200, 400],
      parameters: { conditions: { boolean: [{ value1: '={{ $json.changed }}', value2: true }] } }
    },
    // Update Supabase
    {
      id: 'trk_update', name: 'Update Supabase',
      type: 'n8n-nodes-base.httpRequest', typeVersion: 4.1,
      position: [1500, 300],
      parameters: {
        method: 'PATCH',
        url: "={{ $env.SUPABASE_URL + '/rest/v1/signals?id=eq.' + $json.id }}",
        sendHeaders: true,
        headerParameters: {
          parameters: [
            { name: 'apikey', value: '={{ $env.SUPABASE_KEY }}' },
            { name: 'Authorization', value: '=Bearer {{ $env.SUPABASE_KEY }}' },
            { name: 'Content-Type', value: 'application/json' },
            { name: 'Prefer', value: 'return=minimal' }
          ]
        },
        sendBody: true,
        specifyBody: 'json',
        jsonBody: '={{ JSON.stringify({ status: $json.status, profit_pct: $json.profit_pct, hit_time: $json.hit_time, duration: $json.duration, current_price: $json.current_price }) }}',
        options: {}
      }
    },
    // Telegram TP/SL notification
    {
      id: 'trk_tele', name: 'Telegram TP SL Alert',
      type: 'n8n-nodes-base.telegram', typeVersion: 1.2,
      position: [1500, 500],
      credentials: { telegramApi: { id: 'aNtvHk0oDffDwsLX', name: 'Telegram account' } },
      parameters: {
        chatId: '@cryptospikehunter',
        text: "={{ $json.status === 'SL_HIT' ? '❌ SL HIT' : '✅ ' + $json.hitTarget + ' HIT' }} — {{ $json.symbol }}\n\nEntry: {{ $json.entry_price }} → {{ $json.current_price }} ({{ $json.profit_pct }}%)\nType: {{ $json.signal_type }} | Score: {{ $json.score }}\nDuration: {{ $json.duration }}\nResult: {{ $json.status === 'SL_HIT' ? 'LOSS ❌' : 'WIN ✅' }}\n\n{{ $json.hitTarget === 'TP1' ? '👉 Move SL to Break-Even' : $json.hitTarget === 'TP2' ? '👉 Close 50%, trail to TP3' : $json.hitTarget === 'TP3' ? '🏆 Full Target! CLOSE ALL' : '' }}",
        additionalFields: {}
      }
    },
    // ═══ DAILY REPORT (00:00 WIB = 17:00 UTC) ═══
    {
      id: 'trk_daily', name: 'Daily Report 00:00',
      type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.1,
      position: [200, 700],
      parameters: { rule: { interval: [{ field: 'cronExpression', expression: '0 17 * * *' }] } }
    },
    {
      id: 'trk_daily_read', name: 'Get Daily Stats',
      type: 'n8n-nodes-base.httpRequest', typeVersion: 4.1,
      position: [450, 700],
      parameters: {
        method: 'GET',
        url: "={{ $env.SUPABASE_URL + '/rest/v1/daily_stats?trade_date=eq.' + $now.setZone('Asia/Jakarta').toFormat('yyyy-MM-dd') + '&select=*' }}",
        sendHeaders: true,
        headerParameters: {
          parameters: [
            { name: 'apikey', value: '={{ $env.SUPABASE_KEY }}' },
            { name: 'Authorization', value: '=Bearer {{ $env.SUPABASE_KEY }}' }
          ]
        },
        options: {}
      }
    },
    {
      id: 'trk_daily_build', name: 'Build Report',
      type: 'n8n-nodes-base.code', typeVersion: 2,
      position: [700, 700],
      parameters: {
        jsCode: `const raw = $('Get Daily Stats').first().json;
const stats = Array.isArray(raw) ? raw[0] : raw;
if (!stats || !stats.trade_date) {
  return [{ json: { report: '📊 Daily Report\\n\\nNo signals today.' } }];
}
const r = '📊 Daily Report — ' + stats.trade_date + '\\n\\n' +
  'Total: ' + stats.total_signals + ' signals\\n' +
  '✅ Wins: ' + stats.wins + '\\n' +
  '❌ Losses: ' + stats.losses + '\\n' +
  '⏳ Expired: ' + stats.expired + '\\n' +
  '🔄 Active: ' + stats.active + '\\n\\n' +
  'Win Rate: ' + (stats.win_rate || 0) + '%\\n' +
  'Avg Profit: ' + (stats.avg_profit || 0) + '%\\n' +
  'Best: +' + (stats.best_trade || 0) + '%\\n' +
  'Worst: ' + (stats.worst_trade || 0) + '%';
return [{ json: { report: r } }];`
      }
    },
    {
      id: 'trk_daily_tele', name: 'Send Daily Report',
      type: 'n8n-nodes-base.telegram', typeVersion: 1.2,
      position: [950, 700],
      credentials: { telegramApi: { id: 'aNtvHk0oDffDwsLX', name: 'Telegram account' } },
      parameters: {
        chatId: '@cryptospikehunter',
        text: '={{ $json.report }}',
        additionalFields: {}
      }
    }
  ],
  connections: {
    'Check Every 2min': { main: [[ { node: 'Get Active Signals', type: 'main', index: 0 } ]] },
    'Get Active Signals': { main: [[ { node: 'Get Binance Prices', type: 'main', index: 0 } ]] },
    'Get Binance Prices': { main: [[ { node: 'Check TP SL Hits', type: 'main', index: 0 } ]] },
    'Check TP SL Hits': { main: [[ { node: 'Has Hits?', type: 'main', index: 0 } ]] },
    'Has Hits?': { main: [
      [ { node: 'Update Supabase', type: 'main', index: 0 }, { node: 'Telegram TP SL Alert', type: 'main', index: 0 } ],
      []
    ]},
    'Daily Report 00:00': { main: [[ { node: 'Get Daily Stats', type: 'main', index: 0 } ]] },
    'Get Daily Stats': { main: [[ { node: 'Build Report', type: 'main', index: 0 } ]] },
    'Build Report': { main: [[ { node: 'Send Daily Report', type: 'main', index: 0 } ]] }
  },
  settings: { executionOrder: 'v1' }, pinData: {}, versionId: '', triggerCount: 2
};

fs.writeFileSync('n8n-signal-tracker.json', JSON.stringify(tracker, null, 2));
console.log('Part 2: Signal Tracker rebuilt with Supabase');
console.log('\\nDone! Both files ready:');
console.log('  1. n8n-workflow-hybrid-v17.0.json (Supabase INSERT)');
console.log('  2. n8n-signal-tracker.json (Supabase READ/UPDATE)');
