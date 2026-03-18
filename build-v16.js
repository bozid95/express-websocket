const fs = require('fs');

// ═══════════════════════════════════════════════════════════════
// v16.0 DUAL-LAYER ENGINE BUILDER
// Combines Tier 1 (PRIME SWING) + Tier 2 (INTRADAY SCALP)
// ═══════════════════════════════════════════════════════════════

const v16Code = `// v16.0 DUAL-LAYER PRO ENGINE — SWING + INTRADAY
// Tier 1: PRIME SWING (strict macro validation, wide SL/TP)
// Tier 2: INTRADAY SCALP (1H momentum only, tight SL/TP)

const webhookData = $('Webhook Trigger').first().json.body;
const symbol = webhookData.symbol;
const wsPctChange = parseFloat(webhookData.priceChangePercent);
const wsDirection = webhookData.direction;
const dynamicThreshold = webhookData.threshold ? parseFloat(webhookData.threshold) : 2.0;
const nowTs = Date.now();

// ═══ FRESHNESS ═══
const FRESHNESS_LIMIT_MS = 3 * 60 * 1000;
if (webhookData.triggeredAt) {
  const ageSec = Math.round((nowTs - new Date(webhookData.triggeredAt).getTime()) / 1000);
  if (ageSec > 180) return [{ json: { isHot: false, symbol, rejectReason: '\\u23f0 STALE: ' + ageSec + 's' } }];
}

// ═══ RATE LIMIT + DEDUP ═══
const state = $getWorkflowStaticData('global');
if (!state.signalCache) state.signalCache = {};
for (const key of Object.keys(state.signalCache)) {
  if (nowTs - state.signalCache[key].ts > 6 * 3600000) delete state.signalCache[key];
}
const dedupKey = symbol + '_' + wsDirection;
const lastEntry = state.signalCache[dedupKey];
if (lastEntry && (nowTs - lastEntry.ts < 600000)) {
  return [{ json: { isHot: false, symbol, rejectReason: '\\ud83d\\udd04 RATE LIMIT' } }];
}

// ═══ KLINES PARSING ═══
function parseKlines(nodeName) {
  try {
    let raw = $(nodeName).first().json;
    let data = Array.isArray(raw) ? raw : (typeof raw.data === 'string' ? JSON.parse(raw.data) : raw.data);
    if (!Array.isArray(data) || data.length < 20) return null;
    return {
      open: data.map(function(k){return parseFloat(k[1]);}),
      high: data.map(function(k){return parseFloat(k[2]);}),
      low: data.map(function(k){return parseFloat(k[3]);}),
      close: data.map(function(k){return parseFloat(k[4]);}),
      volume: data.map(function(k){return parseFloat(k[5]);})
    };
  } catch(e) { return null; }
}

const tf1h = parseKlines('Get Klines 1h');
const tf4h = parseKlines('Get Klines 4h');
const tf1d = parseKlines('Get Klines 1D');
if (!tf1h) return [{ json: { isHot: false, symbol, rejectReason: 'No 1H data' } }];

// ═══ DYNAMIC VOLUME FILTER ═══
var quoteVol = parseFloat(webhookData.quoteVolume || 0);
var volTier = 'HIGH';
var volPenalty = 0;
var volWarning = '';
if (quoteVol > 0 && quoteVol < 1000000) {
  return [{ json: { isHot: false, symbol, rejectReason: '\\ud83d\\udeab Vol ' + (quoteVol/1e6).toFixed(2) + 'M < $1M minimum' } }];
} else if (quoteVol > 0 && quoteVol < 5000000) {
  volTier = 'LOW'; volPenalty = -10;
  volWarning = '\\u26a0\\ufe0f Low Liquidity ($' + (quoteVol/1e6).toFixed(1) + 'M)';
} else if (quoteVol > 0 && quoteVol < 20000000) {
  volTier = 'MEDIUM'; volPenalty = 0;
} else {
  volTier = 'HIGH'; volPenalty = 0;
}

// ═══ FUTURES DATA PARSING ═══
let fundingRate = 0, fundingTrend = 'NEUTRAL', fundingLabel = 'N/A';
try {
  const frArr = $('Get Funding Rate').first().json;
  const frData = Array.isArray(frArr) ? frArr : (frArr.body ? JSON.parse(frArr.body) : [frArr]);
  if (Array.isArray(frData) && frData.length > 0) {
    fundingRate = parseFloat(frData[frData.length-1].fundingRate || 0);
    const frPctVal = fundingRate * 100;
    if (frData.length >= 8) {
      const recent3 = frData.slice(-3).reduce(function(a,f){return a+parseFloat(f.fundingRate||0);},0)/3;
      const older8 = frData.slice(-8,-3).reduce(function(a,f){return a+parseFloat(f.fundingRate||0);},0)/5;
      if (recent3 < older8 - 0.0002) fundingTrend = 'FALLING';
      else if (recent3 > older8 + 0.0002) fundingTrend = 'RISING';
    }
    if (frPctVal < -0.1) fundingLabel = frPctVal.toFixed(3) + '% \\ud83d\\udd25 SHORT SQUEEZE (' + fundingTrend + ')';
    else if (frPctVal < -0.05) fundingLabel = frPctVal.toFixed(3) + '% Negative (' + fundingTrend + ')';
    else if (frPctVal > 0.1) fundingLabel = '+' + frPctVal.toFixed(3) + '% \\ud83d\\udd25 LONG LURE (' + fundingTrend + ')';
    else if (frPctVal > 0.05) fundingLabel = '+' + frPctVal.toFixed(3) + '% High (' + fundingTrend + ')';
    else fundingLabel = (frPctVal>=0?'+':'') + frPctVal.toFixed(3) + '% (' + fundingTrend + ')';
  }
} catch(e) {}
const frPct = fundingRate * 100;

let oiValue = 0, oiLabel = 'N/A', oiTrend = 'NEUTRAL', oiChange = 0;
try {
  var oiArr = $('Get OI History').first().json;
  var oiData = Array.isArray(oiArr) ? oiArr : [oiArr];
  if (oiData.length >= 5) {
    var lastOI = parseFloat(oiData[oiData.length-1].sumOpenInterest || oiData[oiData.length-1].openInterest || 0);
    var prevOI = parseFloat(oiData[oiData.length-5].sumOpenInterest || oiData[oiData.length-5].openInterest || 0);
    oiValue = lastOI;
    oiChange = prevOI > 0 ? ((lastOI - prevOI) / prevOI * 100) : 0;
    if (oiChange > 3) oiTrend = 'RISING';
    else if (oiChange < -3) oiTrend = 'FALLING';
    else oiTrend = 'STABLE';
    var oiStr = lastOI > 1e9 ? (lastOI/1e9).toFixed(2)+'B' : lastOI > 1e6 ? (lastOI/1e6).toFixed(1)+'M' : lastOI > 1e3 ? (lastOI/1e3).toFixed(0)+'K' : lastOI.toFixed(0);
    oiLabel = oiStr + ' ' + (oiTrend === 'RISING' ? '\\u2191+' : oiTrend === 'FALLING' ? '\\u2193' : '\\u2194') + oiChange.toFixed(1) + '%';
  } else if (oiData.length > 0) {
    oiValue = parseFloat(oiData[oiData.length-1].sumOpenInterest || oiData[oiData.length-1].openInterest || 0);
    oiLabel = oiValue > 1e6 ? (oiValue/1e6).toFixed(1)+'M' : oiValue.toFixed(0);
  }
} catch(e) {}

let lsRatio = 1.0, lsTrend = 'NEUTRAL', lsLabel = 'N/A';
try {
  const lsArr = $('Get Long Short Ratio').first().json;
  const lsData = Array.isArray(lsArr) ? lsArr : [lsArr];
  if (lsData.length > 0) {
    lsRatio = parseFloat(lsData[lsData.length-1].longShortRatio || 1.0);
    lsLabel = lsRatio.toFixed(2);
    if (lsData.length >= 5) {
      const recent = parseFloat(lsData[lsData.length-1].longShortRatio||1);
      const older = parseFloat(lsData[Math.max(0,lsData.length-5)].longShortRatio||1);
      if (recent > older + 0.1) { lsTrend = 'LONG_INCREASING'; lsLabel += ' \\u2191 Longs growing'; }
      else if (recent < older - 0.1) { lsTrend = 'SHORT_INCREASING'; lsLabel += ' \\u2193 Shorts growing'; }
      else lsLabel += ' Stable';
    }
    if (lsRatio > 2.5) lsLabel += ' \\u26a0\\ufe0f CROWDED LONG';
    else if (lsRatio < 0.5) lsLabel += ' \\u26a0\\ufe0f CROWDED SHORT';
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
    if (takerRatio > 1.3) { takerBias = 'BUY_AGGRESSIVE'; takerLabel = takerRatio.toFixed(2) + ' \\ud83d\\udfe2 Buyers aggressive'; }
    else if (takerRatio < 0.7) { takerBias = 'SELL_AGGRESSIVE'; takerLabel = takerRatio.toFixed(2) + ' \\ud83d\\udd34 Sellers aggressive'; }
    else takerLabel = takerRatio.toFixed(2) + ' Balanced';
    if (tkData.length >= 5) {
      const recent3 = tkData.slice(-3).reduce(function(a,t){return a+(parseFloat(t.buyVol||0)/Math.max(parseFloat(t.sellVol||1),0.001));},0)/3;
      const older = tkData.slice(-5,-3).reduce(function(a,t){return a+(parseFloat(t.buyVol||0)/Math.max(parseFloat(t.sellVol||1),0.001));},0)/2;
      if (recent3 > older + 0.15) takerLabel += ' (trend: BUY\\u2191)';
      else if (recent3 < older - 0.15) takerLabel += ' (trend: SELL\\u2191)';
    }
  }
} catch(e) {}

// ═══ INDICATOR FUNCTIONS ═══
function calcEMA(p,n){if(p.length<n)return p[p.length-1]||0;var k=2/(n+1),e=p.slice(0,n).reduce(function(a,b){return a+b;})/n;for(var i=n;i<p.length;i++)e=(p[i]-e)*k+e;return e;}
function calcEMAArr(p,n){var k=2/(n+1),e=p.slice(0,n).reduce(function(a,b){return a+b;})/n;var r=new Array(n-1).fill(null);r.push(e);for(var i=n;i<p.length;i++){e=(p[i]-e)*k+e;r.push(e);}return r;}
function calcRSI(p,n){n=n||14;if(p.length<n+1)return 50;var g=0,lo=0;for(var i=1;i<=n;i++){var d=p[i]-p[i-1];d>=0?g+=d:lo-=d;}var ag=g/n,al=lo/n;for(var i=n+1;i<p.length;i++){var d=p[i]-p[i-1];ag=((ag*(n-1))+(d>=0?d:0))/n;al=((al*(n-1))+(d<0?-d:0))/n;}return al===0?100:100-(100/(1+(ag/al)));}
function calcRSIArr(p,n){n=n||14;var r=[];for(var i=0;i<p.length;i++){if(i<n){r.push(null);continue;}r.push(calcRSI(p.slice(0,i+1),n));}return r;}
function calcMACD(p){var e12=calcEMAArr(p,12),e26=calcEMAArr(p,26),ml=[];for(var i=0;i<p.length;i++)if(e12[i]!==null&&e26[i]!==null)ml.push(e12[i]-e26[i]);if(ml.length<9)return{h:0,ph:0,cu:false,cd:false,hist:0};var sl=calcEMAArr(ml,9);var lm=ml[ml.length-1],ls=sl[sl.length-1]||0,pm=ml[ml.length-2]||lm,ps=sl[sl.length-2]||ls;return{h:lm-ls,ph:pm-ps,cu:pm<=ps&&lm>ls,cd:pm>=ps&&lm<ls,hist:lm-ls};}
function calcATR(h,l,c,n){n=n||14;if(h.length<n+1)return 0;var t=[h[0]-l[0]];for(var i=1;i<h.length;i++)t.push(Math.max(h[i]-l[i],Math.abs(h[i]-c[i-1]),Math.abs(l[i]-c[i-1])));var a=t.slice(0,n).reduce(function(x,y){return x+y;})/n;for(var i=n;i<t.length;i++)a=(a*(n-1)+t[i])/n;return a;}

function analyzeMarketStructure(h,l,c,lookback) {
  lookback=lookback||30; var len=c.length; if(len<lookback)return'NEUTRAL';
  var sh=h.slice(len-lookback),sl=l.slice(len-lookback);
  var swH=[],swL=[];
  for(var i=2;i<sh.length-2;i++){
    if(sh[i]>sh[i-1]&&sh[i]>sh[i-2]&&sh[i]>sh[i+1]&&sh[i]>sh[i+2])swH.push({i:i,v:sh[i]});
    if(sl[i]<sl[i-1]&&sl[i]<sl[i-2]&&sl[i]<sl[i+1]&&sl[i]<sl[i+2])swL.push({i:i,v:sl[i]});
  }
  if(swH.length<2||swL.length<2)return'NEUTRAL';
  var hh=swH[swH.length-1].v>swH[swH.length-2].v,hl=swL[swL.length-1].v>swL[swL.length-2].v;
  var lh=swH[swH.length-1].v<swH[swH.length-2].v,ll=swL[swL.length-1].v<swL[swL.length-2].v;
  if(hh&&hl)return'BULLISH';if(lh&&ll)return'BEARISH';if(hl&&lh)return'TRANSITION_UP';return'CHOPPY';
}

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

// ═══ TIMEFRAME ANALYSIS ═══
var c=tf1h.close,h=tf1h.high,l=tf1h.low,o=tf1h.open,v=tf1h.volume;
var price=c[c.length-1],idx=c.length-1;
var _rsi=calcRSI(c),_rsiArr=calcRSIArr(c,14),_macd=calcMACD(c),_atr=calcATR(h,l,c);
var E21=calcEMA(c,21),E50=calcEMA(c,50),E200=calcEMA(c,200);
var avgVol=v.slice(-20).reduce(function(a,b){return a+b;})/20;
var volRatio=avgVol>0?v[v.length-1]/avgVol:1;
var body=Math.abs(c[idx]-o[idx]),range=h[idx]-l[idx];
var bodyRatio=range>0?body/range:0;
var upperWick=h[idx]-Math.max(c[idx],o[idx]);
var lowerWick=Math.min(c[idx],o[idx])-l[idx];
var isGreen=c[idx]>o[idx],isRed=!isGreen;
var atrPct=price>0?(_atr/price)*100:0;
var _ms=analyzeMarketStructure(h,l,c,30);
var _rsiDiv=detectRSIDivergence(c,l,h,_rsiArr,40);
var trend1h=price>E21&&E21>E50?'UPTREND':price<E21&&E21<E50?'DOWNTREND':'SIDEWAYS';

var res1h=Math.max.apply(null,h.slice(-500));
var sup1h=Math.min.apply(null,l.slice(-500));

var ffCount=0;
for(var k=idx-5;k<=idx;k++){if(k>24){var ll=Math.min.apply(null,l.slice(k-24,k));if(l[k]<ll)ffCount++;}}

var vol5avg=v.slice(Math.max(0,idx-5),idx).reduce(function(a,b){return a+b;},0)/Math.min(5,idx);
var volBreakRatio=vol5avg>0?v[idx]/vol5avg:1;

var trend4h='SIDEWAYS',rsi4h=50,bias4h='NEUTRAL',res4h=0;
if(tf4h){var c4=tf4h.close,h4=tf4h.high;var E21_4=calcEMA(c4,21),E50_4=calcEMA(c4,50);var p4=c4[c4.length-1];rsi4h=calcRSI(c4);res4h=Math.max.apply(null,h4.slice(-200));
  if(p4>E21_4&&E21_4>E50_4){trend4h='UPTREND';bias4h='BULLISH';}else if(p4<E21_4&&E21_4<E50_4){trend4h='DOWNTREND';bias4h='BEARISH';}}

var dailyTrend='NEUTRAL',dailyEMA21=0,dailyEMA50=0,dailyEMA200=0;
var weeklyBias='NEUTRAL';
if(tf1d){var dc=tf1d.close;dailyEMA21=calcEMA(dc,21);dailyEMA50=calcEMA(dc,50);dailyEMA200=calcEMA(dc,200);
  var dp=dc[dc.length-1];
  if(dp>dailyEMA21&&dailyEMA21>dailyEMA50)dailyTrend='BULLISH';
  else if(dp<dailyEMA21&&dailyEMA21<dailyEMA50)dailyTrend='BEARISH';
  else if(dp>dailyEMA21)dailyTrend='ABOVE_EMA';
  else dailyTrend='BELOW_EMA';
  if(dp>dailyEMA200)weeklyBias='ABOVE MA200';
  else weeklyBias='BELOW MA200';
}
var dailyBearish=dailyTrend==='BEARISH';
var dailyBullish=dailyTrend==='BULLISH'||dailyTrend==='ABOVE_EMA';

var effectiveRes=(res4h>0&&Math.abs(res4h-res1h)/price<0.05)?Math.max(res4h,res1h):(res4h>0?Math.min(res4h,res1h):res1h);

// ════════════════════════════════════════════════════════════
// v16.0 DUAL-LAYER SCORING ENGINE
// TIER 1: PRIME SWING (strict macro rules, wide SL/TP)
// TIER 2: INTRADAY SCALP (1H momentum, tight SL/TP)
// ════════════════════════════════════════════════════════════

var score=0,signal='NEUTRAL',strategy='WAIT',confidence='LOW';
var reasons=[];
var signalType='NONE'; // 'PRIME_SWING' or 'INTRADAY_SCALP'

// ═══════════════════════════════════════
// SCORING FUNCTION (reusable for both tiers)
// ═══════════════════════════════════════
function scoreDip(tier) {
  var s=0, r=[];
  var absPct=Math.abs(wsPctChange);

  // RSI scoring
  if(_rsi<20){s+=25;r.push('RSI '+_rsi.toFixed(0)+' EXTREME');}
  else if(_rsi<25){s+=20;r.push('RSI '+_rsi.toFixed(0)+' extreme');}
  else if(_rsi<30){s+=15;r.push('RSI '+_rsi.toFixed(0)+' oversold');}
  else if(_rsi<35){s+=10;r.push('RSI '+_rsi.toFixed(0));}
  else if(_rsi<40){s+=7;r.push('RSI '+_rsi.toFixed(0));}
  else if(_rsi<50){s+=4;r.push('RSI '+_rsi.toFixed(0));}
  else{s+=2;}

  // Price change magnitude
  if(absPct>=10){s+=15;r.push(absPct.toFixed(1)+'% CRASH');}
  else if(absPct>=7){s+=12;r.push(absPct.toFixed(1)+'% big drop');}
  else if(absPct>=5){s+=9;r.push(absPct.toFixed(1)+'% drop');}
  else{s+=5;}

  // Volume
  if(volRatio>4){s+=12;r.push('Vol '+volRatio.toFixed(1)+'x massive');}
  else if(volRatio>2.5){s+=8;r.push('Vol '+volRatio.toFixed(1)+'x');}
  else if(volRatio>1.2){s+=4;r.push('Vol '+volRatio.toFixed(1)+'x');}
  else{s+=2;}

  // Candle structure
  if(bodyRatio>0.6){s+=12;r.push('Marubozu');}
  else if(bodyRatio>0.4){s+=8;r.push('Strong green');}
  else{s+=4;}

  // MACD
  if(_macd.cu){s+=12;r.push('MACD Bull Cross');}
  else if(_macd.h<0&&_macd.h>_macd.ph){s+=7;r.push('MACD turning');}

  // Support
  var sup=Math.min.apply(null,l.slice(Math.max(0,idx-168),idx));
  var dSup=(price-sup)/price*100;
  if(dSup<0.5){s+=12;r.push('Double Bottom');}
  else if(dSup<1.5){s+=7;r.push('Near support');}
  else if(dSup<3){s+=3;}

  // Wicks
  if(range>0&&lowerWick/range>0.5){s+=7;r.push('Buyer wick');}
  else if(range>0&&lowerWick/range>0.3){s+=4;}

  // Market Structure
  if(_ms==='BULLISH'){s+=15;r.push('Structure HH+HL');}
  else if(_ms==='TRANSITION_UP'){s+=10;r.push('Structure TRANSITION');}

  // Funding Rate
  if(frPct<-0.1){s+=15;r.push('Funding '+frPct.toFixed(3)+'% SHORT SQZ');}
  else if(frPct<-0.05){s+=10;r.push('Funding negative');}
  else if(frPct>0.05){s-=5;}
  if(fundingTrend==='FALLING'&&frPct<0){s+=5;r.push('FR trend falling');}

  // L/S Ratio
  if(lsRatio>2.5){s+=10;r.push('L/S '+lsRatio.toFixed(1)+' CROWDED LONG');}
  else if(lsRatio>1.8){s+=5;r.push('L/S long heavy');}
  else if(lsRatio<0.5){s-=8;r.push('L/S shorts dominate');}
  if(lsTrend==='SHORT_INCREASING'){s+=5;r.push('Shorts growing');}

  // Taker
  if(takerBias==='BUY_AGGRESSIVE'){s+=12;r.push('Taker BUY \\ud83d\\udfe2');}
  else if(takerBias==='SELL_AGGRESSIVE'){s-=8;r.push('Taker SELL aggressive');}

  // OI
  if(oiTrend==='RISING'&&wsPctChange<0){s+=10;r.push('OI RISING+drop=squeeze');}
  else if(oiTrend==='FALLING'&&wsPctChange<0){s+=5;r.push('OI FALLING=bottom near');}

  // RSI Divergence
  if(_rsiDiv.bullish){s+=20;r.push('RSI BULL DIVERGENCE');}

  // 4H / Daily alignment (ONLY matters for SWING tier)
  if(tier==='SWING') {
    if(bias4h==='BULLISH'){s+=8;r.push('4H UPTREND');}
    else if(bias4h==='BEARISH'){s-=5;r.push('4H downtrend');}
    if(dailyTrend==='BULLISH'){s+=5;r.push('Daily BULLISH');}
    else if(dailyTrend==='ABOVE_EMA'){s+=3;}
    else if(dailyTrend==='BELOW_EMA'){s-=8;r.push('Daily BELOW EMA');}
  }

  // Volume tier penalty
  if(volPenalty!==0){s+=volPenalty;r.push('LiqPenalty '+volPenalty);}

  return {score:s, reasons:r};
}

function scorePump(tier) {
  var shortScore=0,breakoutScore=0;
  var shortReasons=[],breakoutReasons=[];

  // SHORT gate
  var hasWickReject=range>0&&upperWick/range>0.3;
  var shortRsiMin = tier==='SWING' ? 65 : 55;
  var shortGate=(_rsi>=shortRsiMin)&&(tier==='INTRADAY'||!dailyBullish)&&(isRed||(_rsi>=72)||hasWickReject);
  if(shortGate){
    if(_rsi>=80){shortScore+=25;shortReasons.push('RSI '+_rsi.toFixed(0)+' EXTREME OB');}
    else if(_rsi>=75){shortScore+=20;shortReasons.push('RSI '+_rsi.toFixed(0));}
    else if(_rsi>=70){shortScore+=15;shortReasons.push('RSI '+_rsi.toFixed(0));}
    else if(_rsi>=60){shortScore+=8;shortReasons.push('RSI '+_rsi.toFixed(0));}
    else{shortScore+=4;}

    if(wsPctChange>=12){shortScore+=15;shortReasons.push('Pump '+wsPctChange.toFixed(1)+'%');}
    else if(wsPctChange>=8){shortScore+=12;shortReasons.push('Pump '+wsPctChange.toFixed(1)+'%');}
    else if(wsPctChange>=5){shortScore+=8;shortReasons.push('Pump '+wsPctChange.toFixed(1)+'%');}
    else{shortScore+=4;}

    if(isRed&&bodyRatio>0.5){shortScore+=12;shortReasons.push('Strong red');}
    else if(isRed){shortScore+=7;shortReasons.push('Red candle');}
    else if(hasWickReject){shortScore+=10;shortReasons.push('Upper wick reject');}
    else{shortScore+=3;}

    if(range>0&&upperWick/range>0.5){shortScore+=12;shortReasons.push('Long Upper wick');}
    else if(range>0&&upperWick/range>0.3){shortScore+=6;}

    if(_macd.cd){shortScore+=12;shortReasons.push('MACD Bear Cross');}
    else if(_macd.h>0&&_macd.h<_macd.ph){shortScore+=6;shortReasons.push('MACD fading');}

    if(_ms==='BEARISH'){shortScore+=12;shortReasons.push('Structure LH+LL');}

    if(frPct>0.1){shortScore+=15;shortReasons.push('Funding +'+frPct.toFixed(3)+'% LONG LURE');}
    else if(frPct>0.05){shortScore+=8;shortReasons.push('Funding high');}

    if(lsRatio>2.5){shortScore+=12;shortReasons.push('L/S CROWDED LONG');}
    else if(lsRatio>1.8){shortScore+=6;shortReasons.push('L/S long heavy');}

    if(takerBias==='SELL_AGGRESSIVE'){shortScore+=10;shortReasons.push('Taker SELL aggressive');}

    if(oiTrend==='RISING'&&wsPctChange>0){shortScore-=5;shortReasons.push('OI RISING=careful short');}
    else if(oiTrend==='FALLING'&&wsPctChange>0){shortScore+=8;shortReasons.push('OI FALLING=fake pump');}

    if(_rsiDiv.bearish){shortScore+=20;shortReasons.push('RSI BEAR DIVERGENCE');}

    // Macro alignment only for SWING
    if(tier==='SWING') {
      if(dailyBearish){shortScore+=8;shortReasons.push('Daily BEAR');}
      if(bias4h==='BEARISH'){shortScore+=8;shortReasons.push('4H DOWN');}
    }

    if(volPenalty!==0){shortScore+=volPenalty;shortReasons.push('LiqPenalty '+volPenalty);}
  }

  // BREAKOUT gate
  var dRes1h=(price-res1h)/price*100;
  var volBreakMin = tier==='SWING' ? 1.5 : 1.1;
  var breakGate=(dRes1h>0||(res4h>0&&price>res4h))&&volBreakRatio>volBreakMin&&(tier==='INTRADAY'||dailyBullish)&&(range>0&&upperWick/range<0.5);
  if(breakGate){
    var prevAboveRes=idx>0&&c[idx-1]>res1h;
    if(prevAboveRes){breakoutScore+=18;breakoutReasons.push('2-bar close above res');}
    else{breakoutScore+=10;breakoutReasons.push('Breakout candle');}

    if(volBreakRatio>3){breakoutScore+=20;breakoutReasons.push('Vol '+volBreakRatio.toFixed(1)+'x BREAK');}
    else if(volBreakRatio>2){breakoutScore+=14;breakoutReasons.push('Vol '+volBreakRatio.toFixed(1)+'x');}
    else{breakoutScore+=8;}

    if(_rsi>=55&&_rsi<70){breakoutScore+=15;breakoutReasons.push('RSI Momentum '+_rsi.toFixed(0));}
    else if(_rsi>=50){breakoutScore+=8;}
    else{breakoutScore-=5;}

    if(isGreen&&bodyRatio>0.7){breakoutScore+=15;breakoutReasons.push('Marubozu breakout');}
    else if(isGreen&&bodyRatio>0.5){breakoutScore+=8;}

    if(_macd.cu){breakoutScore+=10;breakoutReasons.push('MACD Bull Cross');}
    if(_ms==='BULLISH'){breakoutScore+=12;breakoutReasons.push('Structure HH+HL');}

    if(takerBias==='BUY_AGGRESSIVE'){breakoutScore+=12;breakoutReasons.push('Taker BUY aggressive');}
    if(frPct<-0.05){breakoutScore+=12;breakoutReasons.push('Funding neg SHORT SQZ');}

    // Macro only for SWING
    if(tier==='SWING') {
      if(bias4h==='BULLISH'){breakoutScore+=10;breakoutReasons.push('4H UPTREND');}
      if(dailyTrend==='BULLISH'){breakoutScore+=8;breakoutReasons.push('Daily BULL');}
    }

    if(volPenalty!==0){breakoutScore+=volPenalty;breakoutReasons.push('LiqPenalty '+volPenalty);}
  }

  return {shortScore,breakoutScore,shortReasons,breakoutReasons,shortGate,breakGate};
}

// ════════════════════════════════════════
// TIER 1: PRIME SWING (strict rules)
// ════════════════════════════════════════
var tier1Passed = false;

if(wsPctChange<=-dynamicThreshold) {
  // SWING hard gates
  var swingGatePass = !dailyBearish && _rsi<45 && ffCount<3 && (isGreen||_rsi<22) && volRatio>=1.5 && _ms!=='BEARISH' && atrPct>=0.3;
  if(swingGatePass) {
    var dipResult = scoreDip('SWING');
    if(dipResult.score>=58) {
      tier1Passed=true; score=dipResult.score; reasons=dipResult.reasons;
      signalType='PRIME_SWING';
      if(score>=68){signal='STRONG BUY';strategy='LONG (Buy Dip)';confidence='VERY HIGH';}
      else{signal='STRONG BUY';strategy='LONG (Buy Dip)';confidence='HIGH';}
    }
  }
} else if(wsPctChange>=dynamicThreshold) {
  var pumpResult = scorePump('SWING');
  var shortOkSwing = pumpResult.shortGate && pumpResult.shortScore>=55;
  var breakOkSwing = pumpResult.breakGate && pumpResult.breakoutScore>=60;
  if(shortOkSwing && pumpResult.shortScore>=pumpResult.breakoutScore) {
    tier1Passed=true; score=pumpResult.shortScore; reasons=pumpResult.shortReasons;
    signalType='PRIME_SWING';
    if(score>=75){signal='STRONG SELL';strategy='SHORT (Overbought)';confidence='VERY HIGH';}
    else{signal='STRONG SELL';strategy='SHORT (Overbought)';confidence='HIGH';}
  } else if(breakOkSwing) {
    tier1Passed=true; score=pumpResult.breakoutScore; reasons=pumpResult.breakoutReasons;
    signalType='PRIME_SWING';
    if(score>=75){signal='STRONG BUY';strategy='LONG (Breakout)';confidence='VERY HIGH';}
    else{signal='STRONG BUY';strategy='LONG (Breakout)';confidence='HIGH';}
  }
}

// ════════════════════════════════════════
// TIER 2: INTRADAY SCALP (relaxed rules)
// Only runs if Tier 1 did NOT pass
// ════════════════════════════════════════
if(!tier1Passed) {
  if(wsPctChange<=-dynamicThreshold) {
    // Intraday has NO daily trend block, relaxed RSI/vol gates
    var intradayGatePass = _rsi<55 && ffCount<4 && volRatio>=1.0 && atrPct>=0.2;
    if(intradayGatePass) {
      var dipResult2 = scoreDip('INTRADAY');
      if(dipResult2.score>=40) {
        score=dipResult2.score; reasons=dipResult2.reasons;
        signalType='INTRADAY_SCALP';
        if(score>=55){signal='STRONG BUY';strategy='LONG (Intraday Dip)';confidence='MEDIUM';}
        else{signal='STRONG BUY';strategy='LONG (Intraday Dip)';confidence='LOW-MEDIUM';}
      } else {
        reasons.push('INTRADAY score '+dipResult2.score+' (min 40)');
      }
    } else {
      reasons.push('Gates blocked: RSI='+_rsi.toFixed(0)+' Vol='+volRatio.toFixed(1)+'x FF='+ffCount);
    }
  } else if(wsPctChange>=dynamicThreshold) {
    var pumpResult2 = scorePump('INTRADAY');
    var shortOkIntra = pumpResult2.shortGate && pumpResult2.shortScore>=40;
    var breakOkIntra = pumpResult2.breakGate && pumpResult2.breakoutScore>=40;
    if(shortOkIntra && pumpResult2.shortScore>=pumpResult2.breakoutScore) {
      score=pumpResult2.shortScore; reasons=pumpResult2.shortReasons;
      signalType='INTRADAY_SCALP';
      if(score>=55){signal='STRONG SELL';strategy='SHORT (Intraday OB)';confidence='MEDIUM';}
      else{signal='STRONG SELL';strategy='SHORT (Intraday OB)';confidence='LOW-MEDIUM';}
    } else if(breakOkIntra) {
      score=pumpResult2.breakoutScore; reasons=pumpResult2.breakoutReasons;
      signalType='INTRADAY_SCALP';
      if(score>=55){signal='STRONG BUY';strategy='LONG (Intraday Break)';confidence='MEDIUM';}
      else{signal='STRONG BUY';strategy='LONG (Intraday Break)';confidence='LOW-MEDIUM';}
    } else {
      reasons.push('Pump '+wsPctChange.toFixed(1)+'%');
      if(pumpResult2.shortGate)reasons.push('SHORT sc:'+pumpResult2.shortScore);
      if(pumpResult2.breakGate)reasons.push('BREAK sc:'+pumpResult2.breakoutScore);
    }
  } else {
    reasons.push('Change '+wsPctChange.toFixed(1)+'% < threshold');
  }
}

// ═══ DYNAMIC SL/TP based on TIER ═══
var sl=0,tp1=0,tp2=0,tp3=0,riskPct='0';
var isStrongSignal=signal==='STRONG BUY'||signal==='STRONG SELL';

if(_atr>0&&isStrongSignal) {
  // SWING = wide targets | INTRADAY = tight targets
  var slMult = signalType==='PRIME_SWING' ? 2.0 : 1.5;
  var tp1RR = signalType==='PRIME_SWING' ? 1.5 : 1.0;
  var tp2RR = signalType==='PRIME_SWING' ? 2.5 : 1.5;
  var tp3RR = signalType==='PRIME_SWING' ? 3.5 : 2.5;
  var meanMult1 = signalType==='PRIME_SWING' ? 0.4 : 0.3;
  var meanMult2 = signalType==='PRIME_SWING' ? 0.7 : 0.5;
  var meanMult3 = signalType==='PRIME_SWING' ? 1.0 : 0.8;

  if(strategy.indexOf('LONG')!==-1) {
    sl=price-(_atr*slMult);var slDist=price-sl;var meanDist=Math.max(E21-price,_atr*slMult);
    tp1=price+Math.max(meanDist*meanMult1,slDist*tp1RR);
    tp2=price+Math.max(meanDist*meanMult2,slDist*tp2RR);
    tp3=price+Math.max(meanDist*meanMult3,slDist*tp3RR);
    riskPct=((slDist/price)*100).toFixed(2);
  } else {
    sl=price+(_atr*slMult);var slDist=sl-price;var meanDist=Math.max(price-E21,_atr*slMult);
    tp1=price-Math.max(meanDist*meanMult1,slDist*tp1RR);
    tp2=price-Math.max(meanDist*meanMult2,slDist*tp2RR);
    tp3=price-Math.max(meanDist*meanMult3,slDist*tp3RR);
    riskPct=((slDist/price)*100).toFixed(2);
  }
}

var estTP1Pct=strategy.indexOf('LONG')!==-1?(tp1-price)/price*100:(price-tp1)/price*100;
var estTP2Pct=strategy.indexOf('LONG')!==-1?(tp2-price)/price*100:(price-tp2)/price*100;
var estTP3Pct=strategy.indexOf('LONG')!==-1?(tp3-price)/price*100:(price-tp3)/price*100;
var estRiskPct=parseFloat(riskPct)||0;

// DEDUP
if(isStrongSignal&&lastEntry&&(nowTs-lastEntry.ts<10800000)){
  if(score-lastEntry.score<12)return[{json:{isHot:false,symbol,rejectReason:'\\ud83d\\udd01 DEDUP sc '+lastEntry.score+'\\u2192'+score}}];
}
if(isStrongSignal){state.signalCache[dedupKey]={ts:nowTs,score,signal};}

// Signal Type Label
var signalTypeLabel = signalType==='PRIME_SWING' ? '\\ud83d\\udc51 PRIME SWING' : signalType==='INTRADAY_SCALP' ? '\\u26a1 INTRADAY SCALP' : 'NONE';

return [{json:{
  symbol, price:price.toFixed(4),
  wsChange:wsPctChange.toFixed(2)+'%', wsDirection,
  signalType:signalTypeLabel,
  signal, strategy, confidence, score,
  reasons:reasons.join(' | '),
  dailyTrend, weeklyBias,
  trend4h, trend1h,
  rsi1h:_rsi.toFixed(1), rsi4h:rsi4h.toFixed(1),
  marketStructure:_ms,
  rsiDivergence:_rsiDiv.bullish?'BULL DIV \\ud83d\\udd25':(_rsiDiv.bearish?'BEAR DIV \\ud83d\\udd25':'None'),
  macdCross:_macd.cu?'BULL CROSS':(_macd.cd?'BEAR CROSS':'None'),
  macdHist:_macd.hist.toFixed(6),
  volRatio:volRatio.toFixed(1)+'x', volBreakRatio:volBreakRatio.toFixed(1)+'x',
  fundingRate:fundingLabel,
  openInterest:oiLabel, oiTrend:oiTrend,
  longShortRatio:lsLabel,
  takerVolume:takerLabel,
  ema21:E21.toFixed(4), ema200:E200.toFixed(4),
  macroTrend:price>E200?'ABOVE MA200':'BELOW MA200',
  resistance:effectiveRes.toFixed(4), support:sup1h.toFixed(4),
  distResistance:((effectiveRes-price)/price*100).toFixed(2)+'%',
  distSupport:((price-sup1h)/price*100).toFixed(2)+'%',
  sl:sl.toFixed(4), tp1:tp1.toFixed(4), tp2:tp2.toFixed(4), tp3:tp3.toFixed(4),
  riskPct:riskPct+'%', atr:_atr.toFixed(6), atrPct:atrPct.toFixed(2)+'%',
  estTP1:'+'+estTP1Pct.toFixed(2)+'%', estTP2:'+'+estTP2Pct.toFixed(2)+'%', estTP3:'+'+estTP3Pct.toFixed(2)+'%',
  estRisk:'-'+estRiskPct.toFixed(2)+'%',
  estRR1:'1:'+(estTP1Pct/(estRiskPct||1)).toFixed(1),
  estRR2:'1:'+(estTP2Pct/(estRiskPct||1)).toFixed(1),
  estRR3:'1:'+(estTP3Pct/(estRiskPct||1)).toFixed(1),
  volumeTier:volTier, volumeWarning:volWarning,
  isHot:isStrongSignal,
  rejectReason:!isStrongSignal?'Score '+score+'/100. '+reasons.join(', '):'',
  version:'v16.0',
}}];`;

// ═══ Build n8n workflow JSON ═══
const workflow = JSON.parse(fs.readFileSync('n8n-workflow-hybrid-v15.4.json', 'utf8'));
const codeNode = workflow.nodes.find(n => n.name.includes('Pro Analisa'));
codeNode.parameters.jsCode = v16Code;
codeNode.name = 'Pro Analisa TA v16.0';

// Update connections
if (workflow.connections['Pro Analisa TA v15.4']) {
    workflow.connections['Pro Analisa TA v16.0'] = workflow.connections['Pro Analisa TA v15.4'];
    delete workflow.connections['Pro Analisa TA v15.4'];
}

fs.writeFileSync('n8n-workflow-hybrid-v16.0.json', JSON.stringify(workflow, null, 2));
console.log('Generated n8n-workflow-hybrid-v16.0.json');
console.log('jsCode length:', v16Code.length, 'chars //', v16Code.split('\n').length, 'lines');
