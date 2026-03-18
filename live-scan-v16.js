const fs = require('fs');
const https = require('https');

function fetchRest(url) {
    return new Promise((resolve, reject) => {
        https.get(url, { rejectUnauthorized: false }, (res) => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
                try { resolve(JSON.parse(data)); } catch (e) { resolve(null); }
            });
        }).on('error', err => reject(err));
    });
}

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

async function analyzeCoin(ticker, threshold) {
    const symbol = ticker.symbol;
    const wsPctChange = parseFloat(ticker.priceChangePercent);
    const direction = wsPctChange > 0 ? 'PUMP' : 'DUMP';
    
    const webhookData = {
        symbol: symbol,
        priceChangePercent: wsPctChange.toString(),
        direction: direction,
        threshold: threshold.toString(),
        quoteVolume: ticker.quoteVolume,
        triggeredAt: new Date().toISOString()
    };

    const p1h = fetchRest('https://fapi.binance.com/fapi/v1/klines?symbol=' + symbol + '&interval=1h&limit=550');
    const p4h = fetchRest('https://fapi.binance.com/fapi/v1/klines?symbol=' + symbol + '&interval=4h&limit=250');
    const p1d = fetchRest('https://fapi.binance.com/fapi/v1/klines?symbol=' + symbol + '&interval=1d&limit=500');
    const pFR = fetchRest('https://fapi.binance.com/futures/data/fundingRateHist?symbol=' + symbol + '&limit=10');
    const pOI = fetchRest('https://fapi.binance.com/futures/data/openInterestHist?symbol=' + symbol + '&period=1h&limit=10');
    const pLS = fetchRest('https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=' + symbol + '&period=1h&limit=10');
    const pTK = fetchRest('https://fapi.binance.com/futures/data/takerlongshortRatio?symbol=' + symbol + '&period=1h&limit=10');

    const [k1h, k4h, k1d, fr, oi, ls, tk] = await Promise.all([p1h, p4h, p1d, pFR, pOI, pLS, pTK]);
    if (!k1h || k1h.length < 20) return { symbol, isHot: false, reason: 'Failed to fetch API data' };

    const $fn = mock$(k1h, k4h, k1d, webhookData, fr, oi, ls, tk);
    const $getWorkflowStaticData = () => ({ signalCache: {} });

    const resultArr = runAnalysis($fn, $getWorkflowStaticData, webhookData);
    return resultArr[0].json;
}

async function main() {
    const THRESHOLD = 3.0; // Simulated .env threshold
    console.log("=====================================================================");
    console.log("  LIVE MARKET V16.0 SIMULATOR (Catch coins > " + THRESHOLD + "% volatility)");
    console.log("=====================================================================\n");

    console.log("[1] Fetching live 24h tickers from Binance...");
    let tickers = await fetchRest('https://fapi.binance.com/fapi/v1/ticker/24hr');
    
    if (!tickers) {
        console.log("❌ Failed to fetch tickers from Binance.");
        return;
    }

    let candidates = tickers.filter(t => 
        t.symbol.endsWith('USDT') && 
        parseFloat(t.quoteVolume) > 1000000 && 
        Math.abs(parseFloat(t.priceChangePercent)) >= THRESHOLD
    );

    candidates.sort((a,b) => Math.abs(parseFloat(b.priceChangePercent)) - Math.abs(parseFloat(a.priceChangePercent)));
    console.log("[2] Found " + candidates.length + " coins moving >= " + THRESHOLD + "% in the last 24h.\n");
    
    if (candidates.length === 0) {
        console.log("⚠️ Market is completely DEAD right now (No coins > 3% movement). This is why no signals are sent!");
        return;
    }

    let scanList = candidates.slice(0, 50); // Scan top 50
    console.log("[3] Running v16.0 Dual-Layer analysis on TOP " + scanList.length + " volatile coins...\n");

    let hotCount = 0, skipCount = 0;
    for (const t of scanList) {
        let pct = parseFloat(t.priceChangePercent).toFixed(2).padStart(6);
        console.log("Analyzing " + t.symbol.padEnd(10) + " (" + pct + "%) ... ");
        let res = await analyzeCoin(t, THRESHOLD);
        
        if (res.isHot) {
            console.log("\n  ✅ HOT SIGNAL! (" + res.signalType + " | Score: " + res.score + ")\n  ↳ " + res.reasons + "\n");
            hotCount++;
        } else {
            console.log("❌ SKIP: " + (res.rejectReason || res.reason || 'Unknown'));
            skipCount++;
        }
        await new Promise(r => setTimeout(r, 100)); // Rate limit pause
    }

    console.log("\n=====================================================================");
    console.log("  SCAN COMPLETE: " + hotCount + " VALID SIGNALS | " + skipCount + " BLOCKED BY SAFETY FILTERS");
    console.log("=====================================================================");
}
main();
