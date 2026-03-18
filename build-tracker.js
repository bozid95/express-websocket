const fs = require('fs');

// ════════════════════════════════════════════════════
// Part 1: Add Google Sheets Append to v17.0 workflow
// ════════════════════════════════════════════════════
let wf = JSON.parse(fs.readFileSync('n8n-workflow-hybrid-v17.0.json', 'utf8'));

const gsheetLogNode = {
  id: 'gsheet_log_1',
  name: 'Log to Google Sheet',
  type: 'n8n-nodes-base.googleSheets',
  typeVersion: 4.5,
  position: [800, 400],
  credentials: { googleSheetsOAuth2Api: { id: '', name: 'Google Sheets account' } },
  parameters: {
    operation: 'append',
    documentId: { __rl: true, mode: 'list', value: '' },
    sheetName: { __rl: true, mode: 'list', value: '' },
    columns: {
      mappingMode: 'defineBelow',
      value: {
        ID: "={{ $json.symbol + '_' + Date.now() }}",
        Symbol: '={{ $json.symbol }}',
        Signal: '={{ $json.signal }}',
        Type: '={{ $json.signalType }}',
        Entry: '={{ $json.price }}',
        TP1: '={{ $json.tp1 }}',
        TP2: '={{ $json.tp2 }}',
        TP3: '={{ $json.tp3 }}',
        SL: '={{ $json.sl }}',
        Score: '={{ $json.score }}',
        Status: 'ACTIVE',
        'Profit%': '',
        HitTime: '',
        SentAt: "={{ $now.setZone('Asia/Jakarta').toISO() }}",
        Duration: ''
      }
    },
    options: {}
  }
};

wf.nodes.push(gsheetLogNode);

// Connect: Telegram Alert -> Log to Google Sheet
if (!wf.connections['Telegram Alert']) wf.connections['Telegram Alert'] = { main: [[]] };
wf.connections['Telegram Alert'].main[0].push({
  node: 'Log to Google Sheet', type: 'main', index: 0
});

fs.writeFileSync('n8n-workflow-hybrid-v17.0.json', JSON.stringify(wf, null, 2));
console.log('Part 1: Google Sheets Append node added to v17.0');

// ════════════════════════════════════════════════════
// Part 2: Create Signal Tracker Workflow
// ════════════════════════════════════════════════════
const tracker = {
  name: 'Signal Performance Tracker v1.0',
  nodes: [
    // Trigger: every 2 minutes
    {
      id: 'trk_cron', name: 'Check Every 2min',
      type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.1,
      position: [200, 400],
      parameters: { rule: { interval: [{ field: 'minutes', minutesInterval: 2 }] } }
    },
    // Read active signals from Google Sheets
    {
      id: 'trk_read', name: 'Read Active Signals',
      type: 'n8n-nodes-base.googleSheets', typeVersion: 4.5,
      position: [450, 400],
      credentials: { googleSheetsOAuth2Api: { id: '', name: 'Google Sheets account' } },
      parameters: {
        operation: 'read',
        documentId: { __rl: true, mode: 'list', value: '' },
        sheetName: { __rl: true, mode: 'list', value: '' },
        filters: { conditions: [{ field: 'Status', condition: 'equal', value: 'ACTIVE' }] },
        options: {}
      }
    },
    // Get current prices from Binance
    {
      id: 'trk_prices', name: 'Get Current Prices',
      type: 'n8n-nodes-base.httpRequest', typeVersion: 4.1,
      position: [700, 400],
      parameters: {
        url: 'https://fapi.binance.com/fapi/v1/ticker/price',
        options: {}
      }
    },
    // Compare prices vs TP/SL
    {
      id: 'trk_check', name: 'Check TP SL Hits',
      type: 'n8n-nodes-base.code', typeVersion: 2,
      position: [950, 400],
      parameters: {
        jsCode: `// Check TP/SL hits for active signals
const signals = $('Read Active Signals').all();
const pricesRaw = $('Get Current Prices').first().json;
const prices = Array.isArray(pricesRaw) ? pricesRaw : [pricesRaw];
const priceMap = {};
prices.forEach(p => { priceMap[p.symbol] = parseFloat(p.price); });

const results = [];
const now = new Date().toISOString();

for (const item of signals) {
  const s = item.json;
  const currentPrice = priceMap[s.Symbol];
  if (!currentPrice || s.Status !== 'ACTIVE') continue;

  const entry = parseFloat(s.Entry);
  const tp1 = parseFloat(s.TP1);
  const tp2 = parseFloat(s.TP2);
  const tp3 = parseFloat(s.TP3);
  const sl = parseFloat(s.SL);
  const isBuy = s.Signal === 'STRONG BUY';
  
  let status = 'ACTIVE';
  let profitPct = 0;
  let hitTarget = '';

  if (isBuy) {
    profitPct = ((currentPrice - entry) / entry * 100);
    if (currentPrice <= sl) { status = 'SL_HIT'; hitTarget = 'SL'; }
    else if (currentPrice >= tp3) { status = 'TP3_HIT'; hitTarget = 'TP3'; }
    else if (currentPrice >= tp2) { status = 'TP2_HIT'; hitTarget = 'TP2'; }
    else if (currentPrice >= tp1) { status = 'TP1_HIT'; hitTarget = 'TP1'; }
  } else {
    profitPct = ((entry - currentPrice) / entry * 100);
    if (currentPrice >= sl) { status = 'SL_HIT'; hitTarget = 'SL'; }
    else if (currentPrice <= tp3) { status = 'TP3_HIT'; hitTarget = 'TP3'; }
    else if (currentPrice <= tp2) { status = 'TP2_HIT'; hitTarget = 'TP2'; }
    else if (currentPrice <= tp1) { status = 'TP1_HIT'; hitTarget = 'TP1'; }
  }

  // Check expiry (24 hours)
  if (s.SentAt && status === 'ACTIVE') {
    const ageHrs = (Date.now() - new Date(s.SentAt).getTime()) / 3600000;
    if (ageHrs > 24) { status = 'EXPIRED'; hitTarget = 'EXPIRED'; }
  }

  // Calculate duration
  let duration = '';
  if (s.SentAt && status !== 'ACTIVE') {
    const mins = Math.round((Date.now() - new Date(s.SentAt).getTime()) / 60000);
    duration = mins >= 60 ? Math.floor(mins/60) + 'h ' + (mins%60) + 'm' : mins + 'm';
  }

  if (status !== 'ACTIVE') {
    results.push({
      json: {
        ...s,
        Status: status,
        'Profit%': profitPct.toFixed(2) + '%',
        HitTime: now,
        Duration: duration,
        hitTarget: hitTarget,
        currentPrice: currentPrice.toFixed(4),
        changed: true
      }
    });
  }
}

if (results.length === 0) {
  return [{ json: { changed: false, message: 'No TP/SL hits' } }];
}
return results;`
      }
    },
    // Filter: only process if something changed
    {
      id: 'trk_filter', name: 'Has Hits?',
      type: 'n8n-nodes-base.if', typeVersion: 2,
      position: [1200, 400],
      parameters: {
        conditions: {
          boolean: [{ value1: '={{ $json.changed }}', value2: true }]
        }
      }
    },
    // Update Google Sheet row
    {
      id: 'trk_update', name: 'Update Sheet Status',
      type: 'n8n-nodes-base.googleSheets', typeVersion: 4.5,
      position: [1500, 300],
      credentials: { googleSheetsOAuth2Api: { id: '', name: 'Google Sheets account' } },
      parameters: {
        operation: 'update',
        documentId: { __rl: true, mode: 'list', value: '' },
        sheetName: { __rl: true, mode: 'list', value: '' },
        columns: {
          mappingMode: 'defineBelow',
          value: {
            ID: '={{ $json.ID }}',
            Status: '={{ $json.Status }}',
            'Profit%': "={{ $json['Profit%'] }}",
            HitTime: '={{ $json.HitTime }}',
            Duration: '={{ $json.Duration }}'
          }
        },
        options: { cellFormat: 'USER_ENTERED' }
      }
    },
    // Telegram notification for TP/SL hit
    {
      id: 'trk_tele', name: 'Telegram TP SL Alert',
      type: 'n8n-nodes-base.telegram', typeVersion: 1.2,
      position: [1500, 500],
      credentials: { telegramApi: { id: 'aNtvHk0oDffDwsLX', name: 'Telegram account' } },
      parameters: {
        chatId: '@cryptospikehunter',
        text: "={{ $json.hitTarget === 'SL' ? '❌ SL HIT' : '✅ ' + $json.hitTarget + ' HIT' }} — {{ $json.Symbol }}\n\nEntry: {{ $json.Entry }} → {{ $json.currentPrice }} ({{ $json['Profit%'] }})\nType: {{ $json.Type }} | Score: {{ $json.Score }}\nDuration: {{ $json.Duration }}\nStatus: {{ $json.Status === 'SL_HIT' ? 'LOSS' : 'WIN' }}\n\n{{ $json.hitTarget === 'TP1' ? 'Action: Move SL to Break-Even' : $json.hitTarget === 'TP2' ? 'Action: Close 50%, trail to TP3' : $json.hitTarget === 'TP3' ? 'Action: CLOSE ALL — Full Target Reached!' : 'Review your position' }}",
        additionalFields: { parse_mode: 'HTML' }
      }
    },
    // ═══ DAILY REPORT ═══
    {
      id: 'trk_daily_cron', name: 'Daily Report Trigger',
      type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.1,
      position: [200, 700],
      parameters: { rule: { interval: [{ field: 'cronExpression', expression: '0 17 * * *' }] } }
    },
    {
      id: 'trk_daily_read', name: 'Read All Signals',
      type: 'n8n-nodes-base.googleSheets', typeVersion: 4.5,
      position: [450, 700],
      credentials: { googleSheetsOAuth2Api: { id: '', name: 'Google Sheets account' } },
      parameters: {
        operation: 'read',
        documentId: { __rl: true, mode: 'list', value: '' },
        sheetName: { __rl: true, mode: 'list', value: '' },
        options: {}
      }
    },
    {
      id: 'trk_daily_calc', name: 'Calculate Stats',
      type: 'n8n-nodes-base.code', typeVersion: 2,
      position: [700, 700],
      parameters: {
        jsCode: `const rows = $('Read All Signals').all();
const today = new Date();
today.setHours(0,0,0,0);

// Filter today's signals
const todaySignals = rows.filter(r => {
  if (!r.json.SentAt) return false;
  const sent = new Date(r.json.SentAt);
  sent.setHours(0,0,0,0);
  return sent.getTime() === today.getTime();
});

const total = todaySignals.length;
const wins = todaySignals.filter(r => r.json.Status && r.json.Status.includes('TP')).length;
const losses = todaySignals.filter(r => r.json.Status === 'SL_HIT').length;
const expired = todaySignals.filter(r => r.json.Status === 'EXPIRED').length;
const active = todaySignals.filter(r => r.json.Status === 'ACTIVE').length;
const winRate = total > 0 ? ((wins / (wins + losses || 1)) * 100).toFixed(0) : 0;

// Best and worst
let best = { symbol: '-', pct: 0 };
let worst = { symbol: '-', pct: 0 };
todaySignals.forEach(r => {
  const pct = parseFloat(r.json['Profit%']) || 0;
  if (pct > best.pct) { best = { symbol: r.json.Symbol, pct }; }
  if (pct < worst.pct) { worst = { symbol: r.json.Symbol, pct }; }
});

const dateStr = today.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

return [{json:{
  report: '📊 Daily Report — ' + dateStr + '\\n\\n' +
    'Signals: ' + total + '\\n' +
    '✅ Win (TP hit): ' + wins + ' (' + winRate + '%)\\n' +
    '❌ Loss (SL hit): ' + losses + '\\n' +
    '⏳ Expired: ' + expired + '\\n' +
    '🔄 Still Active: ' + active + '\\n\\n' +
    'Best: ' + best.symbol + ' +' + best.pct.toFixed(2) + '%\\n' +
    'Worst: ' + worst.symbol + ' ' + worst.pct.toFixed(2) + '%\\n' +
    'Win Rate: ' + winRate + '%'
}}];`
      }
    },
    {
      id: 'trk_daily_tele', name: 'Telegram Daily Report',
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
    'Check Every 2min': { main: [[ { node: 'Read Active Signals', type: 'main', index: 0 } ]] },
    'Read Active Signals': { main: [[ { node: 'Get Current Prices', type: 'main', index: 0 } ]] },
    'Get Current Prices': { main: [[ { node: 'Check TP SL Hits', type: 'main', index: 0 } ]] },
    'Check TP SL Hits': { main: [[ { node: 'Has Hits?', type: 'main', index: 0 } ]] },
    'Has Hits?': { main: [
      [ { node: 'Update Sheet Status', type: 'main', index: 0 }, { node: 'Telegram TP SL Alert', type: 'main', index: 0 } ],
      []
    ]},
    'Daily Report Trigger': { main: [[ { node: 'Read All Signals', type: 'main', index: 0 } ]] },
    'Read All Signals': { main: [[ { node: 'Calculate Stats', type: 'main', index: 0 } ]] },
    'Calculate Stats': { main: [[ { node: 'Telegram Daily Report', type: 'main', index: 0 } ]] }
  },
  settings: { executionOrder: 'v1' },
  pinData: {},
  versionId: '',
  triggerCount: 2
};

fs.writeFileSync('n8n-signal-tracker.json', JSON.stringify(tracker, null, 2));
console.log('Part 2: Signal Tracker workflow created');
console.log('Files:');
console.log('  - n8n-workflow-hybrid-v17.0.json (updated with Google Sheets log)');
console.log('  - n8n-signal-tracker.json (new tracker workflow)');
