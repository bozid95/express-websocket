const fs = require('fs');

const n8nWorkflow = JSON.parse(fs.readFileSync('n8n-workflow-hybrid-v15.4.json', 'utf8'));
const codeNode = n8nWorkflow.nodes.find(n => n.name.includes('Pro Analisa'));
let jsCode = codeNode.parameters.jsCode;
// We will eval the jsCode inside a function
const runAnalysis = new Function('$', '$getWorkflowStaticData', 'webhookData', `
    try {
        ${jsCode.replace(/return \[\{json:\{([\s\S]*?)\}\}\];/g, 'return {$1};')}
    } catch (e) {
        return { isHot: false, symbol: webhookData.symbol, rejectReason: "Execution Error: " + e.message };
    }
`);

// MOCK DATA GENERATOR
function createMockKlines(count, isUptrend) {
    let klines = [];
    let basePrice = 50.0;
    for(let i=0; i<count; i++) {
        let o = basePrice;
        let c = o + (isUptrend ? Math.random() : -Math.random());
        let h = Math.max(o, c) + Math.random();
        let l = Math.min(o, c) - Math.random();
        let v = 10000 + Math.random()*5000;
        let qv = v * c;
        klines.push([
            1234567890000, o.toString(), h.toString(), l.toString(), c.toString(), v.toString(), 1234567990000, qv.toString(), 100, "0", "0", "0"
        ]);
        basePrice = c;
    }
    // Make last candle a MASSIVE pump to trigger threshold
    if(isUptrend) {
        klines[count-1][1] = basePrice.toString(); // open
        klines[count-1][4] = (basePrice * 1.05).toString(); // close +5%
        klines[count-1][2] = (basePrice * 1.055).toString(); // high
        klines[count-1][5] = (parseFloat(klines[count-1][5]) * 4).toString(); // 4x volume spike
    }
    return klines;
}

const symbol = "MOCKUSDT"
const pctChange = 5.0; // 5% pump
const klines1h = createMockKlines(550, true);
const klines4h = createMockKlines(250, true);
const klines1d = createMockKlines(500, true);
const fr = [{ fundingRate: "-0.0015" }]; // Negative funding = squeeze
const oi = [{ sumOpenInterest: "50000000" }, { sumOpenInterest: "55000000" }, { sumOpenInterest: "56000000" }, { sumOpenInterest: "58000000" }, { sumOpenInterest: "60000000" }]; 
const lsRatio = [{ longShortRatio: "1.2" }]; // Balanced
const taker = [{ buyVol: "5000", sellVol: "2000" }]; // buyers aggressive

const webhookData = {
    symbol: symbol,
    priceChangePercent: pctChange.toString(),
    direction: "PUMP",
    threshold: "2.0",
    quoteVolume: "55000000",
    triggeredAt: new Date().toISOString()
};

const $ = (nodeId) => {
    return {
        first: () => {
            let data = null;
            if (nodeId === 'Webhook Trigger') return { json: { body: webhookData } };
            if (nodeId === 'Get Klines 1h') data = klines1h;
            if (nodeId === 'Get Klines 4h') data = klines4h;
            if (nodeId === 'Get Klines 1D') data = klines1d;
            if (nodeId === 'Get Funding Rate') data = fr;
            if (nodeId === 'Get OI History') data = oi;
            if (nodeId === 'Get Long Short Ratio') data = lsRatio;
            if (nodeId === 'Get Taker Volume') data = taker;
            return { json: data };
        }
    };
};

const $getWorkflowStaticData = () => ({ signalCache: {} });

const result = runAnalysis($, $getWorkflowStaticData, webhookData);

console.log(`Test Result for ${symbol} (+${pctChange}%):`);
console.log(`✅ isHot: ${result.isHot}`);
if (result.isHot) {
    console.log(`   Signal: ${result.signal} (Score: ${result.score})`);
    console.log(`   Reasons: ${result.reasons}`);
} else {
    console.log(`❌ Reject Reason: ${result.rejectReason}`);
}
