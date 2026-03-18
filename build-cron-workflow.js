const fs = require('fs');
let data = JSON.parse(fs.readFileSync('n8n-workflow-hybrid-v16.0.json', 'utf8'));

// 1. Add new nodes
const scheduleNode = {
  id: 'cron_trigger_1',
  name: 'Schedule Trigger (30m)',
  type: 'n8n-nodes-base.scheduleTrigger',
  typeVersion: 1.1,
  position: [-2200, 1000],
  parameters: { rule: { interval: [{ field: 'minutes', minutesInterval: 30 }] } }
};

const getTickersNode = {
  id: 'get_tickers_1',
  name: 'Get 24h Tickers',
  type: 'n8n-nodes-base.httpRequest',
  typeVersion: 4.1,
  position: [-2000, 1000],
  parameters: { url: 'https://fapi.binance.com/fapi/v1/ticker/24hr', options: {} }
};

const filterTickersNode = {
  id: 'filter_tickers_1',
  name: 'Filter Top Volatile',
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [-1800, 1000],
  parameters: {
    jsCode: `const THRESHOLD = 3.5;
let tickers = $input.first().json;
if(typeof tickers === 'string') tickers = JSON.parse(tickers);

let candidates = tickers.filter(t => 
    t.symbol.endsWith('USDT') && 
    parseFloat(t.quoteVolume) > 1000000 && 
    Math.abs(parseFloat(t.priceChangePercent)) >= THRESHOLD
);
candidates.sort((a,b) => Math.abs(parseFloat(b.priceChangePercent)) - Math.abs(parseFloat(a.priceChangePercent)));
let scanList = candidates.slice(0, 30);

return scanList.map(t => {
    let pct = parseFloat(t.priceChangePercent);
    return {
        json: {
            symbol: t.symbol,
            priceChangePercent: t.priceChangePercent,
            direction: pct > 0 ? 'PUMP' : 'DUMP',
            threshold: THRESHOLD.toString(),
            quoteVolume: t.quoteVolume,
            triggeredAt: new Date().toISOString(),
            source: 'HOURLY_SCANNER'
        }
    };
});`
  }
};

const standardizeWebhookNode = {
  id: 'stand_webhook_1',
  name: 'Standardize Webhook',
  type: 'n8n-nodes-base.set',
  typeVersion: 2,
  position: [-1800, 800],
  parameters: {
      keepOnlySet: true,
      values: {
          string: [
              { name: 'symbol', value: '={{ $json.body.symbol }}' },
              { name: 'priceChangePercent', value: '={{ $json.body.priceChangePercent }}' },
              { name: 'direction', value: '={{ $json.body.direction }}' },
              { name: 'threshold', value: '={{ $json.body.threshold }}' },
              { name: 'quoteVolume', value: '={{ $json.body.quoteVolume }}' },
              { name: 'triggeredAt', value: '={{ $json.body.triggeredAt }}' },
              { name: 'source', value: 'WEBHOOK' }
          ]
      },
      options: {}
  }
};

const splitInBatches = {
  id: 'split_in_batches_1',
  name: 'Split In Batches (Rate Limit)',
  type: 'n8n-nodes-base.splitInBatches',
  typeVersion: 2,
  position: [-1600, 900],
  parameters: { batchSize: 5 }
};

data.nodes.push(scheduleNode, getTickersNode, filterTickersNode, standardizeWebhookNode, splitInBatches);

// 2. Fix Expressions in API Nodes
data.nodes.forEach(n => {
  if(n.type === 'n8n-nodes-base.httpRequest') {
      if(n.parameters && n.parameters.queryParameters && n.parameters.queryParameters.parameters) {
          n.parameters.queryParameters.parameters.forEach(p => {
              if(p.name === 'symbol' && typeof p.value === 'string') {
                  p.value = '={{ $json.symbol }}';
              }
          });
      }
  }
});

// 3. Update jsCode in Pro Analisa
let proNode = data.nodes.find(n => n.name.includes('Pro Analisa'));
let code = proNode.parameters.jsCode;
code = code.replace("const webhookData = $('Webhook Trigger').first().json.body;", "const webhookData = $input.first().json;");

let newFlag = "var signalTypeLabel = signalType==='PRIME_SWING' ? '👑 PRIME SWING' : signalType==='INTRADAY_SCALP' ? '⚡ INTRADAY SCALP' : 'NONE';\nif(webhookData.source === 'HOURLY_SCANNER') signalTypeLabel += ' [🕰️ SCANNER]';\n";
code = code.replace(/var signalTypeLabel = .*/g, newFlag);
proNode.parameters.jsCode = code;

// 4. Rewire Connections
data.connections['Webhook Trigger'] = { main: [[ { node: 'Standardize Webhook', type: 'main', index: 0 } ]] };
data.connections['Schedule Trigger (30m)'] = { main: [[ { node: 'Get 24h Tickers', type: 'main', index: 0 } ]] };
data.connections['Get 24h Tickers'] = { main: [[ { node: 'Filter Top Volatile', type: 'main', index: 0 } ]] };

data.connections['Standardize Webhook'] = { main: [[ { node: 'Split In Batches (Rate Limit)', type: 'main', index: 0 } ]] };
data.connections['Filter Top Volatile'] = { main: [[ { node: 'Split In Batches (Rate Limit)', type: 'main', index: 0 } ]] };

data.connections['Split In Batches (Rate Limit)'] = { main: [[ { node: 'Get Klines 1h', type: 'main', index: 0 } ]] };

// Connect Pro Analisa BACK to SplitInBatches to continue loop
if(data.connections['Is Hot?']) {
    // Add connection back to split in batches
    if (!data.connections['Is Hot?'].main[0]) data.connections['Is Hot?'].main[0] = [];
    if (!data.connections['Is Hot?'].main[1]) data.connections['Is Hot?'].main[1] = [];
    
    // We only want to log/alert, then loop. Actually in n8n, split in batches loops back around.
    // The safest way is to connect the leaf nodes back to Split In Batches.
    let leafNodes = ['Telegram Alert', 'Ntfy Alert', 'Log Skip'];
    leafNodes.forEach(ln => {
        if (!data.connections[ln]) data.connections[ln] = { main: [[]] };
        data.connections[ln].main[0].push({ node: 'Split In Batches (Rate Limit)', type: 'main', index: 0 });
    });
}

data.name = "Spike Hunter Pro v16.1 — Dual Architecture";
fs.writeFileSync('n8n-workflow-hybrid-v16.1-Scanner.json', JSON.stringify(data, null, 2));
console.log('Successfully built v16.1 Scanner Workflow!');
