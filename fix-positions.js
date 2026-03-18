const fs = require('fs');
let data = JSON.parse(fs.readFileSync('n8n-workflow-hybrid-v16.1-Scanner.json', 'utf8'));

// Clean, professional layout for n8n canvas
// Row 1 (Y=400): Webhook path (top)
// Row 2 (Y=700): Cron Scanner path (bottom)
// Both merge at Split In Batches, then flow right together

const positions = {
  // === TOP ROW: Webhook Path ===
  'Webhook Trigger':                [-2400, 400],
  'Standardize Webhook':            [-2000, 400],

  // === BOTTOM ROW: Cron Scanner Path ===
  'Schedule Trigger (30m)':         [-2400, 700],
  'Get 24h Tickers':                [-2100, 700],
  'Filter Top Volatile':            [-1800, 700],

  // === MERGE POINT ===
  'Split In Batches (Rate Limit)':  [-1500, 550],

  // === DATA FETCHING (sequential) ===
  'Get Klines 1h':                  [-1200, 550],
  'Get Klines 4h':                  [-900, 550],
  'Get Klines 1D':                  [-600, 550],

  // === FUTURES DATA (parallel, stacked vertically) ===
  'Get Funding Rate':               [-300, 350],
  'Get OI History':                  [-300, 500],
  'Get Long Short Ratio':           [-300, 650],
  'Get Taker Volume':               [-300, 800],

  // === ANALYSIS ENGINE ===
  'Pro Analisa TA v16.0':           [100, 550],

  // === DECISION ===
  'Is Hot?':                        [350, 550],

  // === OUTPUT NODES ===
  'Telegram Alert':                 [600, 400],
  'Ntfy Alert':                     [600, 600],
  'Log Skip':                       [600, 800],
};

data.nodes.forEach(n => {
  if (positions[n.name]) {
    n.position = positions[n.name];
  }
});

fs.writeFileSync('n8n-workflow-hybrid-v16.1-Scanner.json', JSON.stringify(data, null, 2));
console.log('Node positions fixed! Layout is now clean and professional.');
