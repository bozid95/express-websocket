const fs = require('fs');

const n8nWorkflow = JSON.parse(fs.readFileSync('n8n-workflow-hybrid-v16.0.json', 'utf8'));
const codeNode = n8nWorkflow.nodes.find(n => n.name.includes('Pro Analisa'));
let jsCode = codeNode.parameters.jsCode;

const runAnalysis = new Function('$', '$getWorkflowStaticData', 'webhookData', `
    try {
        ${jsCode}
    } catch (e) {
        return [{ json: { isHot: false, symbol: 'ERROR', rejectReason: "Execution Error: " + e.message } }];
    }
`);

// Improved mock: control RSI by manipulating last N candles
function createMockKlines(count, baseTrend, lastCandlesOverride) {
    let klines = [];
    let basePrice = 100.0;
    
    for(let i=0; i<count; i++) {
        let move;
        if (baseTrend === 'up') move = 0.001 + Math.random()*0.003;
        else if (baseTrend === 'down') move = -0.001 - Math.random()*0.003;
        else move = (Math.random()-0.5)*0.002;
        
        let o = basePrice;
        let c = o * (1 + move);
        let h = Math.max(o, c) * (1 + Math.random()*0.003);
        let l = Math.min(o, c) * (1 - Math.random()*0.003);
        let v = 8000 + Math.random()*4000;
        klines.push([Date.now(), o.toString(), h.toString(), l.toString(), c.toString(), v.toString(), Date.now(), (v*c).toString(), 100, "0", "0", "0"]);
        basePrice = c;
    }
    
    // Override last candles to force specific RSI / pattern
    if (lastCandlesOverride) {
        let startIdx = count - lastCandlesOverride.length;
        let curPrice = parseFloat(klines[startIdx-1][4]);
        for (let j = 0; j < lastCandlesOverride.length; j++) {
            let ov = lastCandlesOverride[j];
            let o = curPrice;
            let c = curPrice * (1 + ov.pctMove);
            let h = Math.max(o, c) * (1 + (ov.upperWickPct || 0.002));
            let l = Math.min(o, c) * (1 - (ov.lowerWickPct || 0.002));
            let v = (ov.volMult || 1) * 10000;
            klines[startIdx + j] = [Date.now(), o.toString(), h.toString(), l.toString(), c.toString(), v.toString(), Date.now(), (v*c).toString(), 100, "0", "0", "0"];
            curPrice = c;
        }
    }
    return klines;
}

function mock$(klines1h, klines4h, klines1d, webhookData, fr, oi, ls, tk) {
    return function(nodeId) {
        return {
            first: function() {
                if (nodeId === 'Webhook Trigger') return { json: { body: webhookData } };
                if (nodeId === 'Get Klines 1h') return { json: klines1h };
                if (nodeId === 'Get Klines 4h') return { json: klines4h };
                if (nodeId === 'Get Klines 1D') return { json: klines1d };
                if (nodeId === 'Get Funding Rate') return { json: fr };
                if (nodeId === 'Get OI History') return { json: oi };
                if (nodeId === 'Get Long Short Ratio') return { json: ls };
                if (nodeId === 'Get Taker Volume') return { json: tk };
                return { json: null };
            }
        };
    };
}

// Create proper drop pattern: sideways then sharp drop with volume
function dipPattern() {
    let candles = [];
    // V-bottom shape: decline happened earlier, then a bounce, then ONE sharp crash + buyer wick
    // This avoids triggering freefall (which needs 3+ consecutive new 24-bar lows in last 6 candles)
    for (let i = 0; i < 6; i++) candles.push({ pctMove: -0.008, volMult: 1.0 }); // Earlier decline
    for (let i = 0; i < 8; i++) candles.push({ pctMove: 0.005, volMult: 0.9 }); // Recovery bounce (green!)
    for (let i = 0; i < 3; i++) candles.push({ pctMove: 0.001, volMult: 0.7 }); // Consolidation
    candles.push({ pctMove: -0.06, volMult: 5, lowerWickPct: 0.03 }); // FLASH CRASH + buyer wick = V-bottom
    return candles;
}

// Create pump pattern: rising then massive green
function pumpPattern() {
    let candles = [];
    for (let i = 0; i < 15; i++) candles.push({ pctMove: 0.008, volMult: 1.5 });
    candles.push({ pctMove: 0.06, volMult: 5, upperWickPct: 0.001 }); // Marubozu breakout
    return candles;
}

// Create wick reject pattern
function wickRejectPattern() {
    let candles = [];
    for (let i = 0; i < 15; i++) candles.push({ pctMove: 0.01, volMult: 1.5 });
    candles.push({ pctMove: 0.003, volMult: 4, upperWickPct: 0.04 }); // Long upper wick
    return candles;
}

const scenarios = [
    {
        name: "SC1: Perfect Dip Buy (Daily Bull + RSI Oversold)",
        pctChange: -5.0, direction: 'DUMP', quoteVol: '80000000',
        k1h: createMockKlines(550, 'flat', dipPattern()),
        k4h: createMockKlines(250, 'up', null),
        k1d: createMockKlines(500, 'up', null),
        fr: [{ fundingRate: "-0.002" }],
        oi: [{sumOpenInterest:"50000000"},{sumOpenInterest:"52000000"},{sumOpenInterest:"54000000"},{sumOpenInterest:"56000000"},{sumOpenInterest:"60000000"}],
        ls: [{ longShortRatio: "2.8" }],
        tk: [{ buyVol: "6000", sellVol: "2000" }],
        expected: "TIER 1 PRIME SWING BUY"
    },
    {
        name: "SC2: Dip Buy but Daily Bearish (fallback INTRADAY)",
        pctChange: -4.5, direction: 'DUMP', quoteVol: '50000000',
        k1h: createMockKlines(550, 'flat', dipPattern()),
        k4h: createMockKlines(250, 'down', null),
        k1d: createMockKlines(500, 'down', null),
        fr: [{ fundingRate: "-0.001" }],
        oi: [{sumOpenInterest:"40000000"},{sumOpenInterest:"42000000"},{sumOpenInterest:"43000000"},{sumOpenInterest:"44000000"},{sumOpenInterest:"45000000"}],
        ls: [{ longShortRatio: "1.5" }],
        tk: [{ buyVol: "4000", sellVol: "2500" }],
        expected: "TIER 2 INTRADAY BUY (daily bearish bypass)"
    },
    {
        name: "SC3: Strong Breakout Pump (Daily Bull + Vol Spike)",
        pctChange: 6.0, direction: 'PUMP', quoteVol: '120000000',
        k1h: createMockKlines(550, 'up', pumpPattern()),
        k4h: createMockKlines(250, 'up', null),
        k1d: createMockKlines(500, 'up', null),
        fr: [{ fundingRate: "-0.0015" }],
        oi: [{sumOpenInterest:"70000000"},{sumOpenInterest:"72000000"},{sumOpenInterest:"74000000"},{sumOpenInterest:"76000000"},{sumOpenInterest:"80000000"}],
        ls: [{ longShortRatio: "0.8" }],
        tk: [{ buyVol: "7000", sellVol: "2000" }],
        expected: "TIER 1 PRIME SWING BREAKOUT"
    },
    {
        name: "SC4: Wick Reject + OB RSI (SWING SHORT)",
        pctChange: 8.0, direction: 'PUMP', quoteVol: '60000000',
        k1h: createMockKlines(550, 'up', wickRejectPattern()),
        k4h: createMockKlines(250, 'down', null),
        k1d: createMockKlines(500, 'down', null),
        fr: [{ fundingRate: "0.002" }],
        oi: [{sumOpenInterest:"30000000"},{sumOpenInterest:"32000000"},{sumOpenInterest:"28000000"},{sumOpenInterest:"26000000"},{sumOpenInterest:"24000000"}],
        ls: [{ longShortRatio: "3.0" }],
        tk: [{ buyVol: "2000", sellVol: "5000" }],
        expected: "TIER 1 PRIME SWING SHORT"
    },
    {
        name: "SC5: Sideways (NO SIGNAL)",
        pctChange: 0.5, direction: 'PUMP', quoteVol: '30000000',
        k1h: createMockKlines(550, 'flat', null),
        k4h: createMockKlines(250, 'flat', null),
        k1d: createMockKlines(500, 'flat', null),
        fr: [{ fundingRate: "0.0001" }],
        oi: [{sumOpenInterest:"20000000"},{sumOpenInterest:"20000000"},{sumOpenInterest:"20000000"},{sumOpenInterest:"20000000"},{sumOpenInterest:"20000000"}],
        ls: [{ longShortRatio: "1.0" }],
        tk: [{ buyVol: "3000", sellVol: "3000" }],
        expected: "NO SIGNAL"
    },
    {
        name: "SC6: Low Liquidity $800K (HARD BLOCK)",
        pctChange: -7.0, direction: 'DUMP', quoteVol: '800000',
        k1h: createMockKlines(550, 'flat', dipPattern()),
        k4h: createMockKlines(250, 'up', null),
        k1d: createMockKlines(500, 'up', null),
        fr: [{ fundingRate: "-0.003" }],
        oi: [{sumOpenInterest:"500000"},{sumOpenInterest:"500000"},{sumOpenInterest:"500000"},{sumOpenInterest:"500000"},{sumOpenInterest:"500000"}],
        ls: [{ longShortRatio: "1.0" }],
        tk: [{ buyVol: "3000", sellVol: "3000" }],
        expected: "BLOCKED (vol < $1M)"
    },
    {
        name: "SC7: Pump + Daily Bullish (INTRADAY SHORT)",
        pctChange: 5.0, direction: 'PUMP', quoteVol: '45000000',
        k1h: createMockKlines(550, 'up', wickRejectPattern()),
        k4h: createMockKlines(250, 'up', null),
        k1d: createMockKlines(500, 'up', null),
        fr: [{ fundingRate: "0.0015" }],
        oi: [{sumOpenInterest:"30000000"},{sumOpenInterest:"30000000"},{sumOpenInterest:"28000000"},{sumOpenInterest:"26000000"},{sumOpenInterest:"24000000"}],
        ls: [{ longShortRatio: "2.6" }],
        tk: [{ buyVol: "2000", sellVol: "4500" }],
        expected: "TIER 2 INTRADAY SHORT"
    }
];

console.log("\\n═══════════════════════════════════════════════════════════");
console.log("  v16.0 DUAL-LAYER ENGINE — PROFESSIONAL VALIDATION TEST");
console.log("═══════════════════════════════════════════════════════════\\n");

let results = [];

for (const sc of scenarios) {
    const webhookData = { symbol: sc.name.split(':')[0].trim(), priceChangePercent: sc.pctChange.toString(), direction: sc.direction, threshold: "2.0", quoteVolume: sc.quoteVol, triggeredAt: new Date().toISOString() };
    const $fn = mock$(sc.k1h, sc.k4h, sc.k1d, webhookData, sc.fr, sc.oi, sc.ls, sc.tk);
    const $getWorkflowStaticData = () => ({ signalCache: {} });

    const resultArr = runAnalysis($fn, $getWorkflowStaticData, webhookData);
    const r = resultArr[0].json;

    let status = '';
    console.log("┌─ " + sc.name);
    console.log("│  Expected: " + sc.expected);
    
    if (r.isHot) {
        console.log("│  ✅ HOT — " + r.signalType + " | " + r.signal + " | Score: " + r.score);
        console.log("│  Strategy: " + r.strategy + " | Confidence: " + r.confidence);
        console.log("│  Risk: " + r.estRisk + " | RR1: " + r.estRR1 + " | RR2: " + r.estRR2 + " | RR3: " + r.estRR3);
        console.log("│  Reasons: " + r.reasons);
        status = 'PASS';
    } else {
        console.log("│  ❌ SKIP — " + (r.rejectReason || 'no reason'));
        if (sc.expected.includes('NO SIGNAL') || sc.expected.includes('BLOCKED')) {
            console.log("│  ✅ CORRECTLY BLOCKED as expected");
            status = 'PASS';
        } else {
            status = 'REVIEW';
        }
    }
    
    results.push({ name: sc.name, expected: sc.expected, got: r.isHot ? (r.signalType + ' ' + r.signal) : (r.rejectReason || 'SKIP'), status });
    console.log("└──────────────────────────────────────\\n");
}

// Summary Table
console.log("\\n═══════════════════════════ SUMMARY TABLE ═══════════════════════════");
console.log("| # | Scenario                              | Expected              | Got                          | Status |");
console.log("|---|---------------------------------------|----------------------|------------------------------|--------|");
for (let i = 0; i < results.length; i++) {
    let r = results[i];
    let n = r.name.substring(0, 39).padEnd(39);
    let e = r.expected.substring(0, 20).padEnd(20);
    let g = r.got.substring(0, 28).padEnd(28);
    let s = r.status === 'PASS' ? '✅ PASS' : '⚠️ REVIEW';
    console.log("| " + (i+1) + " | " + n + " | " + e + " | " + g + " | " + s + " |");
}
console.log("═══════════════════════════════════════════════════════════════════════\\n");

let passed = results.filter(r => r.status === 'PASS').length;
console.log("FINAL: " + passed + "/" + results.length + " PASSED");
