const fs = require('fs');
let d = JSON.parse(fs.readFileSync('n8n-workflow-hybrid-v17.0.json', 'utf8'));

let n = d.nodes.find(n => n.name === 'Save to Supabase');

// Change from jsonBody (broken expressions) to bodyParameters (key-value pairs)
n.parameters.specifyBody = 'keypair';
delete n.parameters.jsonBody;
n.parameters.bodyParameters = {
  parameters: [
    { name: 'id',           value: "={{ $json.symbol + '_' + Date.now() }}" },
    { name: 'symbol',       value: '={{ $json.symbol }}' },
    { name: 'signal',       value: '={{ $json.signal }}' },
    { name: 'signal_type',  value: '={{ $json.signalType }}' },
    { name: 'entry_price',  value: '={{ $json.price }}' },
    { name: 'tp1',          value: '={{ $json.tp1 }}' },
    { name: 'tp2',          value: '={{ $json.tp2 }}' },
    { name: 'tp3',          value: '={{ $json.tp3 }}' },
    { name: 'sl',           value: '={{ $json.sl }}' },
    { name: 'score',        value: '={{ $json.score }}' },
    { name: 'confidence',   value: '={{ $json.confidence }}' },
    { name: 'strategy',     value: '={{ $json.strategy }}' },
    { name: 'reasons',      value: '={{ $json.reasons }}' },
    { name: 'status',       value: 'ACTIVE' }
  ]
};

fs.writeFileSync('n8n-workflow-hybrid-v17.0.json', JSON.stringify(d, null, 2));
console.log('Fixed! Save to Supabase now uses key-value body (not jsonBody)');
