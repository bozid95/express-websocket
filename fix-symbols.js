const fs = require('fs');
let d = JSON.parse(fs.readFileSync('n8n-workflow-hybrid-v16.1-Scanner.json','utf8'));

const batchRef = "={{ $('Split In Batches (Rate Limit)').first().json.symbol }}";

// Fix all API nodes that need the symbol from the batch node
const nodesToFix = ['Get Klines 4h', 'Get Klines 1D', 'Get Funding Rate', 'Get OI History', 'Get Long Short Ratio', 'Get Taker Volume'];

d.nodes.forEach(n => {
    if (nodesToFix.includes(n.name) && n.parameters && n.parameters.queryParameters) {
        n.parameters.queryParameters.parameters.forEach(p => {
            if (p.name === 'symbol') {
                p.value = batchRef;
                console.log('Fixed:', n.name);
            }
        });
    }
});

// Fix Pro Analisa to read webhookData from Split In Batches
let proNode = d.nodes.find(n => n.name.includes('Pro Analisa'));
let code = proNode.parameters.jsCode;
let oldRef = "const webhookData = $input.first().json;";
let newRef = "const webhookData = $('Split In Batches (Rate Limit)').first().json;";
code = code.replace(oldRef, newRef);
proNode.parameters.jsCode = code;
console.log('Fixed: Pro Analisa TA -> reads from Split In Batches');

fs.writeFileSync('n8n-workflow-hybrid-v16.1-Scanner.json', JSON.stringify(d, null, 2));
console.log('\nDone! All symbol references now point to Split In Batches node.');
