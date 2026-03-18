const fs = require('fs');
const https = require('https');
const http = require('http');

// --- 1. Load config from .env ---
const envDict = {};
try {
    const envFile = fs.readFileSync('.env', 'utf8');
    envFile.split('\\n').forEach(line => {
        const parts = line.split('=');
        if (parts.length >= 2) {
            envDict[parts[0].trim()] = parts.slice(1).join('=').trim();
        }
    });
} catch (e) {
    console.log("Could not read .env file, using defaults.");
}
const WEBHOOK_URL = envDict['N8N_WEBHOOK_URL'] || 'http://localhost:5678/webhook/binance-trigger';
const BASE_THRESHOLD = parseFloat(envDict['PRICE_CHANGE_THRESHOLD']) || 3.0;

// Scanner looks for slightly larger structural moves
const SCANNER_THRESHOLD = Math.max(4.0, BASE_THRESHOLD); 
const SCAN_INTERVAL_MINUTES = 30;

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

function postWebhook(url, payload) {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const options = {
            hostname: u.hostname,
            port: u.port || (u.protocol === 'https:' ? 443 : 80),
            path: u.pathname + u.search,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Pro-Scanner-Daemon/1.0',
            },
            rejectUnauthorized: false
        };
        const reqMod = u.protocol === 'https:' ? https : http;
        const req = reqMod.request(options, (res) => {
            res.on('data', () => {});
            res.on('end', () => resolve(res.statusCode));
        });
        req.on('error', (e) => reject(e));
        req.write(JSON.stringify(payload));
        req.end();
    });
}

// Prepare V16 Logic
let jsCode = "";
try {
    const n8nWorkflow = JSON.parse(fs.readFileSync('n8n-workflow-hybrid-v16.0.json', 'utf8'));
    const codeNode = n8nWorkflow.nodes.find(n => n.name.includes('Pro Analisa'));
    jsCode = codeNode.parameters.jsCode;
} catch(e) {
    console.error("FATAL: Could not read n8n-workflow-hybrid-v16.0.json");
    process.exit(1);
}

const runAnalysis = new Function('$', '$getWorkflowStaticData', 'webhookData', \`
    try {
        \${jsCode}
    } catch (e) {
        return [{ json: { isHot: false, symbol: 'ERROR', rejectReason: "Execution Error: " + e.message } }];
    }
\`);

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
    
    // Custom payload with identifier so user knows it's from the scanner
    const webhookData = {
        symbol: symbol,
        priceChangePercent: wsPctChange.toString(),
        direction: direction,
        threshold: threshold.toString(),
        quoteVolume: ticker.quoteVolume,
        triggeredAt: new Date().toISOString(),
        source: 'HOURLY_SCANNER' // Custom tag
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
    return { ...resultArr[0].json, webhookData };
}

async function runScan() {
    console.log(\`\\n[\${new Date().toISOString()}] Starting Routine Market Scan...\`);
    let tickers = await fetchRest('https://fapi.binance.com/fapi/v1/ticker/24hr');
    if (!tickers) {
        console.log("❌ Failed to fetch tickers from Binance.");
        return;
    }

    let candidates = tickers.filter(t => 
        t.symbol.endsWith('USDT') && 
        parseFloat(t.quoteVolume) > 1000000 && 
        Math.abs(parseFloat(t.priceChangePercent)) >= SCANNER_THRESHOLD
    );

    candidates.sort((a,b) => Math.abs(parseFloat(b.priceChangePercent)) - Math.abs(parseFloat(a.priceChangePercent)));
    let scanList = candidates.slice(0, 30); // Top 30 to avoid rate limits
    console.log(\`Found \${candidates.length} coins > \${SCANNER_THRESHOLD}%. Analyzing top \${scanList.length}...\`);

    let sentSignals = 0;

    for (const t of scanList) {
        let res = await analyzeCoin(t, SCANNER_THRESHOLD);
        if (res.isHot) {
            console.log(\`✅ [\${t.symbol}] HOT SIGNAL! Sending to n8n Webhook...\`);
            try {
                // Shoot the payload to n8n so Telegram notification gets created!
                let status = await postWebhook(WEBHOOK_URL, res.webhookData);
                console.log(\`   ↳ Webhook Response Status: \${status}\`);
                sentSignals++;
            } catch(e) {
                console.log(\`   ↳ ERROR sending Webhook: \${e.message}\`);
            }
        }
        await new Promise(r => setTimeout(r, 200)); // anti rate limit
    }
    console.log(\`[\${new Date().toISOString()}] Scan completed. Sent \${sentSignals} signals to N8N.\`);
}

// 1. Run immediately on startup
runScan();

// 2. Schedule for every X minutes
setInterval(runScan, SCAN_INTERVAL_MINUTES * 60 * 1000);
console.log(\`\\n🚀 PRO SCANNER DAEMON STARTED\`);
console.log(\`- Target Webhook : \${WEBHOOK_URL}\`);
console.log(\`- Scan Interval  : Every \${SCAN_INTERVAL_MINUTES} minutes\`);
console.log(\`- Min Volatility : > \${SCANNER_THRESHOLD}%\\n\`);
