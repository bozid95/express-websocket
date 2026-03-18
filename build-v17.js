const fs = require('fs');

// Read the base workflow
let wf = JSON.parse(fs.readFileSync('n8n-workflow-hybrid-v16.0.json', 'utf8'));

// ═══════════════════════════════════════════════════════════════
// v17.0 PROFESSIONAL HYBRID ENGINE
// Rule #1: Follow the trend (don't fight it)
// Rule #2: Counter-trend ONLY with hard reversal proof
// Rule #3: Send to Telegram ONLY if engine is confident
// ═══════════════════════════════════════════════════════════════

const V17_CODE = `// v17.0 PROFESSIONAL HYBRID ENGINE
// Primary: TREND-FOLLOWING (follow momentum)
// Secondary: COUNTER-TREND (only with reversal proof)
// Rule: Only notify if engine is CONFIDENT

const webhookData = $('Webhook Trigger').first().json.body;
const symbol = webhookData.symbol;
const wsPctChange = parseFloat(webhookData.priceChangePercent);
const wsDirection = webhookData.direction;
const dynamicThreshold = webhookData.threshold ? parseFloat(webhookData.threshold) : 2.0;
const nowTs = Date.now();

// ═══ FRESHNESS ═══
if (webhookData.triggeredAt) {
  const ageSec = Math.round((nowTs - new Date(webhookData.triggeredAt).getTime()) / 1000);
  if (ageSec > 180) return [{ json: { isHot: false, symbol, rejectReason: 'STALE: ' + ageSec + 's' } }];
}

// ═══ RATE LIMIT + DEDUP ═══
const state = $getWorkflowStaticData('global');
if (!state.signalCache) state.signalCache = {};
for (const key of Object.keys(state.signalCache)) {
  if (nowTs - state.signalCache[key].ts > 6 * 3600000) delete state.signalCache[key];
}
const dedupKey = symbol + '_' + wsDirection;
const lastEntry = state.signalCache[dedupKey];
if (lastEntry && (nowTs - lastEntry.ts < 900000)) {
  return [{ json: { isHot: false, symbol, rejectReason: 'RATE LIMIT 15min' } }];
}

// ═══ KLINES PARSING ═══
function parseKlines(nodeName) {
  try {
    let raw = $(nodeName).first().json;
    let data = Array.isArray(raw) ? raw : (typeof raw.data === 'string' ? JSON.parse(raw.data) : raw.data);
    if (!Array.isArray(data) || data.length < 20) return null;
    return {
      open: data.map(k => parseFloat(k[1])),
      high: data.map(k => parseFloat(k[2])),
      low: data.map(k => parseFloat(k[3])),
      close: data.map(k => parseFloat(k[4])),
      volume: data.map(k => parseFloat(k[5]))
    };
  } catch(e) { return null; }
}

const tf1h = parseKlines('Get Klines 1h');
const tf4h = parseKlines('Get Klines 4h');
const tf1d = parseKlines('Get Klines 1D');
if (!tf1h) return [{ json: { isHot: false, symbol, rejectReason: 'No 1H data' } }];

// ═══ VOLUME FILTER ═══
var quoteVol = parseFloat(webhookData.quoteVolume || 0);
if (quoteVol > 0 && quoteVol < 1000000) {
  return [{ json: { isHot: false, symbol, rejectReason: 'Vol ' + (quoteVol/1e6).toFixed(2) + 'M < $1M' } }];
}
var volTier = quoteVol < 5000000 ? 'LOW' : quoteVol < 20000000 ? 'MEDIUM' : 'HIGH';
var volPenalty = volTier === 'LOW' ? -10 : 0;
var volWarning = volTier === 'LOW' ? 'Low Liquidity ($' + (quoteVol/1e6).toFixed(1) + 'M)' : '';

// ═══ FUTURES DATA ═══
let fundingRate = 0, fundingTrend = 'NEUTRAL', fundingLabel = 'N/A';
try {
  const frArr = $('Get Funding Rate').first().json;
  const frData = Array.isArray(frArr) ? frArr : [frArr];
  if (frData.length > 0) {
    fundingRate = parseFloat(frData[frData.length-1].fundingRate || 0);
    const frPctVal = fundingRate * 100;
    if (frData.length >= 8) {
      const recent3 = frData.slice(-3).reduce((a,f) => a+parseFloat(f.fundingRate||0),0)/3;
      const older8 = frData.slice(-8,-3).reduce((a,f) => a+parseFloat(f.fundingRate||0),0)/5;
      if (recent3 < older8 - 0.0002) fundingTrend = 'FALLING';
      else if (recent3 > older8 + 0.0002) fundingTrend = 'RISING';
    }
    fundingLabel = (frPctVal>=0?'+':'') + frPctVal.toFixed(3) + '% (' + fundingTrend + ')';
    if (frPctVal < -0.1) fundingLabel = frPctVal.toFixed(3) + '% SHORT SQUEEZE';
    else if (frPctVal > 0.1) fundingLabel = '+' + frPctVal.toFixed(3) + '% LONG LURE';
  }
} catch(e) {}
const frPct = fundingRate * 100;

let oiTrend = 'NEUTRAL', oiLabel = 'N/A', oiChange = 0;
try {
  var oiArr = $('Get OI History').first().json;
  var oiData = Array.isArray(oiArr) ? oiArr : [oiArr];
  if (oiData.length >= 5) {
    var lastOI = parseFloat(oiData[oiData.length-1].sumOpenInterest || oiData[oiData.length-1].openInterest || 0);
    var prevOI = parseFloat(oiData[oiData.length-5].sumOpenInterest || oiData[oiData.length-5].openInterest || 0);
    oiChange = prevOI > 0 ? ((lastOI - prevOI) / prevOI * 100) : 0;
    oiTrend = oiChange > 3 ? 'RISING' : oiChange < -3 ? 'FALLING' : 'STABLE';
    var oiStr = lastOI > 1e9 ? (lastOI/1e9).toFixed(2)+'B' : lastOI > 1e6 ? (lastOI/1e6).toFixed(1)+'M' : lastOI.toFixed(0);
    oiLabel = oiStr + ' ' + (oiTrend === 'RISING' ? 'UP+' : oiTrend === 'FALLING' ? 'DN' : '=') + oiChange.toFixed(1) + '%';
  }
} catch(e) {}

let lsRatio = 1.0, lsLabel = 'N/A';
try {
  const lsArr = $('Get Long Short Ratio').first().json;
  const lsData = Array.isArray(lsArr) ? lsArr : [lsArr];
  if (lsData.length > 0) {
    lsRatio = parseFloat(lsData[lsData.length-1].longShortRatio || 1.0);
    lsLabel = lsRatio.toFixed(2);
    if (lsRatio > 2.5) lsLabel += ' CROWDED LONG';
    else if (lsRatio < 0.5) lsLabel += ' CROWDED SHORT';
    else lsLabel += ' Balanced';
  }
} catch(e) {}

let takerRatio = 1.0, takerLabel = 'N/A', takerBias = 'NEUTRAL';
try {
  const tkArr = $('Get Taker Volume').first().json;
  const tkData = Array.isArray(tkArr) ? tkArr : [tkArr];
  if (tkData.length > 0) {
    const last = tkData[tkData.length-1];
    const buyVol = parseFloat(last.buyVol || 0);
    const sellVol = parseFloat(last.sellVol || 0);
    takerRatio = sellVol > 0 ? buyVol / sellVol : 1;
    if (takerRatio > 1.3) { takerBias = 'BUY'; takerLabel = takerRatio.toFixed(2) + ' Buyers'; }
    else if (takerRatio < 0.7) { takerBias = 'SELL'; takerLabel = takerRatio.toFixed(2) + ' Sellers'; }
    else takerLabel = takerRatio.toFixed(2) + ' Balanced';
  }
} catch(e) {}

// ═══ INDICATORS ═══
function calcEMA(p,n){if(p.length<n)return p[p.length-1]||0;var k=2/(n+1),e=p.slice(0,n).reduce((a,b)=>a+b)/n;for(var i=n;i<p.length;i++)e=(p[i]-e)*k+e;return e;}
function calcEMAArr(p,n){var k=2/(n+1),e=p.slice(0,n).reduce((a,b)=>a+b)/n;var r=new Array(n-1).fill(null);r.push(e);for(var i=n;i<p.length;i++){e=(p[i]-e)*k+e;r.push(e);}return r;}
function calcRSI(p,n){n=n||14;if(p.length<n+1)return 50;var g=0,lo=0;for(var i=1;i<=n;i++){var d=p[i]-p[i-1];d>=0?g+=d:lo-=d;}var ag=g/n,al=lo/n;for(var i=n+1;i<p.length;i++){var d=p[i]-p[i-1];ag=((ag*(n-1))+(d>=0?d:0))/n;al=((al*(n-1))+(d<0?-d:0))/n;}return al===0?100:100-(100/(1+(ag/al)));}
function calcRSIArr(p,n){n=n||14;var r=[];for(var i=0;i<p.length;i++){if(i<n){r.push(null);continue;}r.push(calcRSI(p.slice(0,i+1),n));}return r;}
function calcMACD(p){var e12=calcEMAArr(p,12),e26=calcEMAArr(p,26),ml=[];for(var i=0;i<p.length;i++)if(e12[i]!==null&&e26[i]!==null)ml.push(e12[i]-e26[i]);if(ml.length<9)return{h:0,ph:0,cu:false,cd:false};var sl=calcEMAArr(ml,9);var lm=ml[ml.length-1],ls=sl[sl.length-1]||0,pm=ml[ml.length-2]||lm,ps=sl[sl.length-2]||ls;return{h:lm-ls,ph:pm-ps,cu:pm<=ps&&lm>ls,cd:pm>=ps&&lm<ls};}
function calcATR(h,l,c,n){n=n||14;if(h.length<n+1)return 0;var t=[h[0]-l[0]];for(var i=1;i<h.length;i++)t.push(Math.max(h[i]-l[i],Math.abs(h[i]-c[i-1]),Math.abs(l[i]-c[i-1])));var a=t.slice(0,n).reduce((x,y)=>x+y)/n;for(var i=n;i<t.length;i++)a=(a*(n-1)+t[i])/n;return a;}

function detectRSIDivergence(c,l,h,rsiArr,lookback) {
  lookback=lookback||40;var idx=c.length-1;if(idx<lookback||!rsiArr[idx])return{bullish:false,bearish:false};
  var startIdx=idx-lookback,bullDiv=false,bearDiv=false;
  for(var i=startIdx+2;i<idx-2;i++){if(!rsiArr[i])continue;
    var isSwL=l[i]<=l[i-1]&&l[i]<=l[i-2]&&l[i]<=l[i+1]&&l[i]<=l[i+2];
    if(isSwL&&(l[idx]<l[i]||Math.abs(l[idx]-l[i])/l[i]<0.005)){if(rsiArr[idx]>rsiArr[i]+3){bullDiv=true;break;}}
  }
  for(var i=startIdx+2;i<idx-2;i++){if(!rsiArr[i])continue;
    var isSwH=h[i]>=h[i-1]&&h[i]>=h[i-2]&&h[i]>=h[i+1]&&h[i]>=h[i+2];
    if(isSwH&&(h[idx]>h[i]||Math.abs(h[idx]-h[i])/h[i]<0.005)){if(rsiArr[idx]<rsiArr[i]-3){bearDiv=true;break;}}
  }
  return{bullish:bullDiv,bearish:bearDiv};
}

// ═══ 1H ANALYSIS ═══
var c=tf1h.close,h=tf1h.high,l=tf1h.low,o=tf1h.open,v=tf1h.volume;
var price=c[c.length-1],idx=c.length-1;
var _rsi=calcRSI(c),_rsiArr=calcRSIArr(c,14),_macd=calcMACD(c),_atr=calcATR(h,l,c);
var E21=calcEMA(c,21),E50=calcEMA(c,50),E200=calcEMA(c,200);
var avgVol=v.slice(-20).reduce((a,b)=>a+b)/20;
var volRatio=avgVol>0?v[v.length-1]/avgVol:1;
var body=Math.abs(c[idx]-o[idx]),range=h[idx]-l[idx];
var bodyRatio=range>0?body/range:0;
var upperWick=h[idx]-Math.max(c[idx],o[idx]);
var lowerWick=Math.min(c[idx],o[idx])-l[idx];
var isGreen=c[idx]>o[idx], isRed=!isGreen;
var atrPct=price>0?(_atr/price)*100:0;
var _rsiDiv=detectRSIDivergence(c,l,h,_rsiArr,40);

// Last 3 candles for reversal detection
var last3Green = 0, last3Red = 0;
for (var k = idx; k >= Math.max(0, idx-2); k--) {
  if (c[k] > o[k]) last3Green++; else last3Red++;
}

// Freefall detection
var ffCount=0;
for(var k=idx-5;k<=idx;k++){if(k>24){var ll=Math.min.apply(null,l.slice(k-24,k));if(l[k]<ll)ffCount++;}}

// Support/Resistance
var res1h=Math.max.apply(null,h.slice(-500));
var sup1h=Math.min.apply(null,l.slice(-500));

// ═══ MULTI-TIMEFRAME ═══
var trend4h='SIDEWAYS',rsi4h=50,bias4h='NEUTRAL';
if(tf4h){var c4=tf4h.close;var E21_4=calcEMA(c4,21),E50_4=calcEMA(c4,50);var p4=c4[c4.length-1];rsi4h=calcRSI(c4);
  if(p4>E21_4&&E21_4>E50_4){trend4h='UPTREND';bias4h='BULLISH';}
  else if(p4<E21_4&&E21_4<E50_4){trend4h='DOWNTREND';bias4h='BEARISH';}}

var dailyTrend='NEUTRAL',weeklyBias='NEUTRAL';
if(tf1d){var dc=tf1d.close;var dE21=calcEMA(dc,21),dE50=calcEMA(dc,50),dE200=calcEMA(dc,200);var dp=dc[dc.length-1];
  if(dp>dE21&&dE21>dE50)dailyTrend='BULLISH';
  else if(dp<dE21&&dE21<dE50)dailyTrend='BEARISH';
  else if(dp>dE21)dailyTrend='ABOVE_EMA';
  else dailyTrend='BELOW_EMA';
  weeklyBias=dp>dE200?'ABOVE MA200':'BELOW MA200';}

// ════════════════════════════════════════════════════════════
// v17.0 SIGNAL DECISION ENGINE
// ════════════════════════════════════════════════════════════
var signal='NEUTRAL',strategy='WAIT',confidence='LOW',score=0;
var reasons=[],signalType='NONE';
var absPct = Math.abs(wsPctChange);

if (absPct < dynamicThreshold) {
  return [{ json: { isHot: false, symbol, rejectReason: 'Change ' + wsPctChange.toFixed(1) + '% < threshold' } }];
}

// ═══ PUMP SCENARIO (price going UP) ═══
if (wsPctChange >= dynamicThreshold) {

  // === PRIORITY 1: MOMENTUM BUY (follow the pump) ===
  // Conditions: RSI healthy (50-75), trend aligned, volume OK
  var momentumBuyOk = _rsi >= 50 && _rsi <= 75 && volRatio >= 1.2 && isGreen
    && (bias4h === 'BULLISH' || dailyTrend === 'BULLISH' || dailyTrend === 'ABOVE_EMA')
    && ffCount < 2 && _macd.h > 0;

  if (momentumBuyOk) {
    score = 0;
    // Score it
    if (_rsi >= 55 && _rsi <= 68) { score += 20; reasons.push('RSI ' + _rsi.toFixed(0) + ' healthy momentum'); }
    else { score += 10; reasons.push('RSI ' + _rsi.toFixed(0)); }
    if (volRatio >= 3) { score += 20; reasons.push('Vol ' + volRatio.toFixed(1) + 'x massive'); }
    else if (volRatio >= 2) { score += 15; reasons.push('Vol ' + volRatio.toFixed(1) + 'x strong'); }
    else { score += 8; reasons.push('Vol ' + volRatio.toFixed(1) + 'x'); }
    if (bodyRatio > 0.6) { score += 12; reasons.push('Strong body'); }
    if (_macd.cu) { score += 15; reasons.push('MACD Bull Cross'); }
    else if (_macd.h > _macd.ph) { score += 8; reasons.push('MACD rising'); }
    if (bias4h === 'BULLISH') { score += 12; reasons.push('4H UPTREND'); }
    if (dailyTrend === 'BULLISH') { score += 10; reasons.push('Daily BULL'); }
    if (takerBias === 'BUY') { score += 10; reasons.push('Taker BUY'); }
    if (oiTrend === 'RISING') { score += 8; reasons.push('OI rising (new positions)'); }
    if (frPct < -0.05) { score += 10; reasons.push('FR negative (squeeze fuel)'); }
    if (_rsiDiv.bullish) { score += 12; reasons.push('RSI BULL DIV'); }
    if (price > E21 && E21 > E50) { score += 8; reasons.push('Above EMA21>50'); }
    score += volPenalty;

    if (score >= 55) {
      signalType = 'MOMENTUM';
      signal = 'STRONG BUY'; strategy = 'LONG (Momentum Follow)';
      confidence = score >= 75 ? 'VERY HIGH' : score >= 65 ? 'HIGH' : 'MEDIUM';
    }
  }

  // === PRIORITY 2: BREAKOUT BUY ===
  if (signal === 'NEUTRAL') {
    var dRes = (price - res1h) / price * 100;
    var breakoutOk = dRes > 0 && volRatio >= 1.5 && isGreen && bodyRatio > 0.4
      && (range > 0 && upperWick/range < 0.4) && _rsi >= 50 && _rsi <= 78;

    if (breakoutOk) {
      score = 0;
      score += 15; reasons.push('BREAKOUT above resistance');
      if (volRatio >= 3) { score += 20; reasons.push('Vol ' + volRatio.toFixed(1) + 'x breakout volume'); }
      else if (volRatio >= 2) { score += 12; reasons.push('Vol ' + volRatio.toFixed(1) + 'x'); }
      else { score += 6; }
      if (bodyRatio > 0.7) { score += 12; reasons.push('Marubozu breakout'); }
      if (_macd.cu) { score += 12; reasons.push('MACD Bull Cross'); }
      if (bias4h === 'BULLISH') { score += 10; reasons.push('4H confirms'); }
      if (dailyTrend === 'BULLISH') { score += 8; reasons.push('Daily confirms'); }
      if (takerBias === 'BUY') { score += 10; reasons.push('Taker BUY'); }
      if (frPct < -0.05) { score += 8; reasons.push('FR squeeze fuel'); }
      score += volPenalty;

      if (score >= 55) {
        signalType = 'BREAKOUT';
        signal = 'STRONG BUY'; strategy = 'LONG (Breakout)';
        confidence = score >= 70 ? 'VERY HIGH' : score >= 60 ? 'HIGH' : 'MEDIUM';
      }
    }
  }

  // === PRIORITY 3: REVERSAL SHORT (counter-trend, STRICT) ===
  if (signal === 'NEUTRAL') {
    // HARD REQUIREMENTS for counter-trend SHORT:
    // 1. RSI must be > 78 (extreme overbought)
    // 2. Last 2 candles must be RED (sellers taking over)
    // 3. MACD must be declining or bear cross
    // 4. Upper wick rejection present
    var reversalShortOk = _rsi >= 78 && last3Red >= 2
      && (_macd.cd || (_macd.h > 0 && _macd.h < _macd.ph))
      && (range > 0 && upperWick/range > 0.3);

    if (reversalShortOk) {
      score = 0;
      if (_rsi >= 90) { score += 25; reasons.push('RSI ' + _rsi.toFixed(0) + ' EXTREME OB'); }
      else if (_rsi >= 85) { score += 20; reasons.push('RSI ' + _rsi.toFixed(0) + ' very OB'); }
      else { score += 15; reasons.push('RSI ' + _rsi.toFixed(0) + ' OB'); }
      score += 15; reasons.push(last3Red + ' red candles (sellers active)');
      if (_macd.cd) { score += 15; reasons.push('MACD Bear Cross'); }
      else { score += 8; reasons.push('MACD declining'); }
      if (upperWick/range > 0.5) { score += 12; reasons.push('Strong wick rejection'); }
      else { score += 6; reasons.push('Wick rejection'); }
      if (wsPctChange >= 15) { score += 12; reasons.push('Pump ' + wsPctChange.toFixed(1) + '% overextended'); }
      else if (wsPctChange >= 8) { score += 8; reasons.push('Pump ' + wsPctChange.toFixed(1) + '%'); }
      if (frPct > 0.05) { score += 10; reasons.push('FR high (long lure)'); }
      if (lsRatio > 2.0) { score += 8; reasons.push('L/S crowded long'); }
      if (takerBias === 'SELL') { score += 10; reasons.push('Taker SELL'); }
      if (_rsiDiv.bearish) { score += 15; reasons.push('RSI BEAR DIVERGENCE'); }
      if (dailyTrend === 'BEARISH') { score += 8; reasons.push('Daily BEAR'); }
      score += volPenalty;

      if (score >= 60) {
        signalType = 'REVERSAL';
        signal = 'STRONG SELL'; strategy = 'SHORT (Reversal Confirmed)';
        confidence = score >= 80 ? 'VERY HIGH' : score >= 70 ? 'HIGH' : 'MEDIUM';
      }
    }
  }
}

// ═══ DUMP SCENARIO (price going DOWN) ═══
if (wsPctChange <= -dynamicThreshold && signal === 'NEUTRAL') {

  // === PRIORITY 1: MOMENTUM SHORT (follow the dump) ===
  var momentumShortOk = _rsi >= 25 && _rsi <= 50 && volRatio >= 1.2 && isRed
    && (bias4h === 'BEARISH' || dailyTrend === 'BEARISH' || dailyTrend === 'BELOW_EMA')
    && _macd.h < 0;

  if (momentumShortOk) {
    score = 0;
    if (_rsi >= 30 && _rsi <= 45) { score += 20; reasons.push('RSI ' + _rsi.toFixed(0) + ' bearish zone'); }
    else { score += 10; reasons.push('RSI ' + _rsi.toFixed(0)); }
    if (volRatio >= 3) { score += 20; reasons.push('Vol ' + volRatio.toFixed(1) + 'x panic'); }
    else if (volRatio >= 2) { score += 15; reasons.push('Vol ' + volRatio.toFixed(1) + 'x heavy'); }
    else { score += 8; reasons.push('Vol ' + volRatio.toFixed(1) + 'x'); }
    if (bodyRatio > 0.6 && isRed) { score += 12; reasons.push('Red marubozu'); }
    if (_macd.cd) { score += 15; reasons.push('MACD Bear Cross'); }
    else if (_macd.h < _macd.ph) { score += 8; reasons.push('MACD falling'); }
    if (bias4h === 'BEARISH') { score += 12; reasons.push('4H DOWNTREND'); }
    if (dailyTrend === 'BEARISH') { score += 10; reasons.push('Daily BEAR'); }
    if (takerBias === 'SELL') { score += 10; reasons.push('Taker SELL'); }
    if (oiTrend === 'FALLING') { score += 8; reasons.push('OI falling (closing longs)'); }
    if (frPct > 0.05) { score += 8; reasons.push('FR positive (longs paying)'); }
    if (_rsiDiv.bearish) { score += 12; reasons.push('RSI BEAR DIV'); }
    if (price < E21 && E21 < E50) { score += 8; reasons.push('Below EMA21<50'); }
    score += volPenalty;

    if (score >= 55) {
      signalType = 'MOMENTUM';
      signal = 'STRONG SELL'; strategy = 'SHORT (Momentum Follow)';
      confidence = score >= 75 ? 'VERY HIGH' : score >= 65 ? 'HIGH' : 'MEDIUM';
    }
  }

  // === PRIORITY 2: DIP CATCH BUY (counter-trend, STRICT) ===
  if (signal === 'NEUTRAL') {
    // HARD REQUIREMENTS for counter-trend BUY:
    // 1. RSI must be < 22 (extreme oversold)
    // 2. Last candle must be GREEN or have big lower wick (buyers stepping in)
    // 3. MACD must be turning up
    // 4. Not in freefall
    var hasBottomWick = range > 0 && lowerWick/range > 0.35;
    var dipCatchOk = _rsi < 22 && (isGreen || hasBottomWick)
      && (_macd.cu || (_macd.h < 0 && _macd.h > _macd.ph))
      && ffCount < 2;

    if (dipCatchOk) {
      score = 0;
      if (_rsi < 15) { score += 25; reasons.push('RSI ' + _rsi.toFixed(0) + ' EXTREME OS'); }
      else { score += 18; reasons.push('RSI ' + _rsi.toFixed(0) + ' oversold'); }
      if (isGreen && bodyRatio > 0.4) { score += 15; reasons.push('Green reversal candle'); }
      else if (hasBottomWick) { score += 12; reasons.push('Buyer wick'); }
      if (_macd.cu) { score += 15; reasons.push('MACD Bull Cross'); }
      else { score += 8; reasons.push('MACD turning up'); }
      if (absPct >= 10) { score += 12; reasons.push(absPct.toFixed(1) + '% crash (extreme)'); }
      else { score += 6; reasons.push(absPct.toFixed(1) + '% drop'); }
      if (frPct < -0.05) { score += 10; reasons.push('FR negative (squeeze fuel)'); }
      if (lsRatio > 2.0) { score += 8; reasons.push('Crowded long (squeeze)'); }
      if (takerBias === 'BUY') { score += 12; reasons.push('Taker BUY'); }
      if (_rsiDiv.bullish) { score += 18; reasons.push('RSI BULL DIVERGENCE'); }
      // Check for double bottom
      var sup=Math.min.apply(null,l.slice(Math.max(0,idx-168),idx));
      var dSup=(price-sup)/price*100;
      if (dSup < 0.5) { score += 12; reasons.push('Double Bottom'); }
      score += volPenalty;

      if (score >= 60) {
        signalType = 'DIP_CATCH';
        signal = 'STRONG BUY'; strategy = 'LONG (Dip Catch Confirmed)';
        confidence = score >= 80 ? 'VERY HIGH' : score >= 70 ? 'HIGH' : 'MEDIUM';
      }
    }
  }
}

// ═══ FINAL CONFIDENCE GATE ═══
var isHot = signal === 'STRONG BUY' || signal === 'STRONG SELL';
if (isHot && confidence === 'LOW') {
  return [{ json: { isHot: false, symbol, rejectReason: 'Confidence too LOW (score: ' + score + ')' } }];
}

// ═══ DEDUP ═══
if (isHot && lastEntry && (nowTs - lastEntry.ts < 10800000)) {
  if (score - lastEntry.score < 15) {
    return [{ json: { isHot: false, symbol, rejectReason: 'DEDUP ' + lastEntry.score + ' -> ' + score } }];
  }
}
if (isHot) { state.signalCache[dedupKey] = { ts: nowTs, score, signal }; }

// ═══ DYNAMIC SL/TP ═══
var sl=0,tp1=0,tp2=0,tp3=0,riskPct='0';
if (_atr > 0 && isHot) {
  // Trend-following = wider TP, tighter SL (let winners run)
  // Counter-trend = tighter TP, wider SL (take profit quickly)
  var isTrendFollow = signalType === 'MOMENTUM' || signalType === 'BREAKOUT';
  var slMult = isTrendFollow ? 1.5 : 2.0;
  var tp1RR = isTrendFollow ? 1.5 : 1.0;
  var tp2RR = isTrendFollow ? 3.0 : 1.5;
  var tp3RR = isTrendFollow ? 5.0 : 2.5;

  if (strategy.indexOf('LONG') !== -1) {
    sl = price - (_atr * slMult);
    var slDist = price - sl;
    tp1 = price + slDist * tp1RR;
    tp2 = price + slDist * tp2RR;
    tp3 = price + slDist * tp3RR;
    riskPct = ((slDist/price)*100).toFixed(2);
  } else {
    sl = price + (_atr * slMult);
    var slDist = sl - price;
    tp1 = price - slDist * tp1RR;
    tp2 = price - slDist * tp2RR;
    tp3 = price - slDist * tp3RR;
    riskPct = ((slDist/price)*100).toFixed(2);
  }
}

var estTP1Pct = strategy.indexOf('LONG')!==-1 ? (tp1-price)/price*100 : (price-tp1)/price*100;
var estTP2Pct = strategy.indexOf('LONG')!==-1 ? (tp2-price)/price*100 : (price-tp2)/price*100;
var estTP3Pct = strategy.indexOf('LONG')!==-1 ? (tp3-price)/price*100 : (price-tp3)/price*100;
var estRiskPct = parseFloat(riskPct) || 0;

// ═══ SIGNAL TYPE LABELS ═══
var signalTypeLabel = 'NONE';
var isTF = signalType === 'MOMENTUM' || signalType === 'BREAKOUT';
if (signalType === 'MOMENTUM') signalTypeLabel = 'MOMENTUM FOLLOW';
else if (signalType === 'BREAKOUT') signalTypeLabel = 'BREAKOUT';
else if (signalType === 'REVERSAL') signalTypeLabel = 'REVERSAL (Counter-Trend)';
else if (signalType === 'DIP_CATCH') signalTypeLabel = 'DIP CATCH (Counter-Trend)';

// ═══ PRO ENTRY GUIDANCE ═══
var entryValidity='SKIP',entryEmoji='',entryAction='',positionSize='',tradeManagement='',holdDuration='';

if (isHot && isTF) {
  // Trend-following: more aggressive sizing, longer holds
  if (score >= 75) {
    entryValidity='HIGHLY VALID'; entryEmoji='A+';
    entryAction='ENTER NOW - Premium trend signal. Place order immediately.';
    positionSize='2-3% of capital (High Conviction)';
    holdDuration='2 Hours - 2 Days';
  } else if (score >= 65) {
    entryValidity='VALID'; entryEmoji='A';
    entryAction='ENTER NOW - Strong trend. Place order promptly.';
    positionSize='1-2% of capital (Standard)';
    holdDuration='1 Hour - 1 Day';
  } else {
    entryValidity='MODERATE'; entryEmoji='B';
    entryAction='CAUTIOUS ENTRY - Wait for 5min candle confirmation.';
    positionSize='0.5-1% of capital (Conservative)';
    holdDuration='30 Min - 4 Hours';
  }
  tradeManagement='TP1 hit: Move SL to Break-Even. TP2 hit: Close 50%, trail rest to TP3. Let winners run.';
} else if (isHot) {
  // Counter-trend: smaller sizing, quick exits
  if (score >= 75) {
    entryValidity='VALID (REVERSAL)'; entryEmoji='B+';
    entryAction='ENTER - Reversal confirmed. Use tight SL.';
    positionSize='1-1.5% of capital (Reversal Size)';
    holdDuration='15 Min - 2 Hours';
  } else {
    entryValidity='MODERATE (REVERSAL)'; entryEmoji='B';
    entryAction='CAUTIOUS - Counter-trend is risky. Small size only.';
    positionSize='0.5-1% of capital (Small)';
    holdDuration='15 Min - 1 Hour';
  }
  tradeManagement='TP1 hit: CLOSE 100% immediately. Do NOT hold counter-trend trades too long.';
}

return [{json:{
  symbol, price:price.toFixed(4),
  wsChange:wsPctChange.toFixed(2)+'%', wsDirection,
  signalType:signalTypeLabel, signal, strategy, confidence, score,
  reasons:reasons.join(' | '),
  dailyTrend, weeklyBias, trend4h,
  trend1h:price>E21&&E21>E50?'UPTREND':price<E21&&E21<E50?'DOWNTREND':'SIDEWAYS',
  rsi1h:_rsi.toFixed(1), rsi4h:rsi4h.toFixed(1),
  marketStructure: _rsi>50&&price>E21?'BULLISH':_rsi<50&&price<E21?'BEARISH':'MIXED',
  rsiDivergence:_rsiDiv.bullish?'BULL DIV':(_rsiDiv.bearish?'BEAR DIV':'None'),
  macdCross:_macd.cu?'BULL CROSS':(_macd.cd?'BEAR CROSS':'None'),
  macdHist:_macd.h.toFixed(6),
  volRatio:volRatio.toFixed(1)+'x',
  fundingRate:fundingLabel, openInterest:oiLabel, oiTrend:oiTrend,
  longShortRatio:lsLabel, takerVolume:takerLabel,
  ema21:E21.toFixed(4), ema200:E200.toFixed(4),
  macroTrend:price>E200?'ABOVE MA200':'BELOW MA200',
  resistance:res1h.toFixed(4), support:sup1h.toFixed(4),
  distResistance:((res1h-price)/price*100).toFixed(2)+'%',
  distSupport:((price-sup1h)/price*100).toFixed(2)+'%',
  sl:sl.toFixed(4), tp1:tp1.toFixed(4), tp2:tp2.toFixed(4), tp3:tp3.toFixed(4),
  riskPct:riskPct+'%', atr:_atr.toFixed(6), atrPct:atrPct.toFixed(2)+'%',
  estTP1:'+'+estTP1Pct.toFixed(2)+'%', estTP2:'+'+estTP2Pct.toFixed(2)+'%', estTP3:'+'+estTP3Pct.toFixed(2)+'%',
  estRisk:'-'+estRiskPct.toFixed(2)+'%',
  estRR1:'1:'+(estTP1Pct/(estRiskPct||1)).toFixed(1),
  estRR2:'1:'+(estTP2Pct/(estRiskPct||1)).toFixed(1),
  estRR3:'1:'+(estTP3Pct/(estRiskPct||1)).toFixed(1),
  volumeTier:volTier, volumeWarning:volWarning,
  isHot:isHot,
  rejectReason:!isHot?'Score '+score+'/100. '+reasons.join(', '):'',
  entryValidity, entryEmoji, entryAction, positionSize, tradeManagement, holdDuration,
  version:'v17.0',
}}];`;

// Inject into workflow
let proNode = wf.nodes.find(n => n.name.includes('Pro Analisa'));
proNode.name = 'Pro Analisa TA v17.0';
proNode.parameters.jsCode = V17_CODE;

// Update connections
let connStr = JSON.stringify(wf.connections);
connStr = connStr.replace(/Pro Analisa TA v16\.0/g, 'Pro Analisa TA v17.0');
connStr = connStr.replace(/Pro Analisa TA v15\.3/g, 'Pro Analisa TA v17.0');
wf.connections = JSON.parse(connStr);

wf.name = 'Spike Hunter Pro v17.0 — Professional Hybrid Engine';

fs.writeFileSync('n8n-workflow-hybrid-v17.0.json', JSON.stringify(wf, null, 2));
console.log('v17.0 Professional Hybrid Engine generated!');
console.log('Signal Types: MOMENTUM | BREAKOUT | REVERSAL | DIP_CATCH');
console.log('File: n8n-workflow-hybrid-v17.0.json');
