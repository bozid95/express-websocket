// v15.4 PRO CRYPTO FUTURES — MAXIMUM DATA ENGINE + DYNAMIC VOLUME FILTER
// Data: 1500 candles (1H/4H/1D) + Open Interest + Long/Short Ratio + Taker Buy/Sell + Funding History

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
  if (ageSec > 180) return [{ json: { isHot: false, symbol, rejectReason: '\u23f0 STALE: ' + ageSec + 's' } }];
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
  return [{ json: { isHot: false, symbol, rejectReason: '\ud83d\udd04 RATE LIMIT' } }];
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

// ═══ DYNAMIC VOLUME FILTER v15.4 ═══
// Pro trader approach: tiered volume with penalty instead of hard cutoff
var quoteVol = parseFloat(webhookData.quoteVolume || 0);
var volTier = 'HIGH'; // default: high liquidity
var volPenalty = 0;
var volWarning = '';
if (quoteVol > 0 && quoteVol < 1000000) {
  // HARD BLOCK: under $1M = too illiquid to trade
  return [{ json: { isHot: false, symbol, rejectReason: '🚫 Vol ' + (quoteVol/1e6).toFixed(2) + 'M < $1M minimum' } }];
} else if (quoteVol > 0 && quoteVol < 5000000) {
  // SOFT PENALTY: $1-5M = tradeable with caution
  volTier = 'LOW';
  volPenalty = -10;
  volWarning = '⚠️ Low Liquidity ($' + (quoteVol/1e6).toFixed(1) + 'M)';
} else if (quoteVol > 0 && quoteVol < 20000000) {
  volTier = 'MEDIUM';
  volPenalty = 0;
} else {
  volTier = 'HIGH';
  volPenalty = 0;
}

// ═══ FUTURES DATA PARSING ═══
// Funding Rate History
let fundingRate = 0, fundingTrend = 'NEUTRAL', fundingLabel = 'N/A';
try {
  const frArr = $('Get Funding Rate').first().json;
  const frData = Array.isArray(frArr) ? frArr : (frArr.body ? JSON.parse(frArr.body) : [frArr]);
  if (Array.isArray(frData) && frData.length > 0) {
    fundingRate = parseFloat(frData[frData.length-1].fundingRate || 0);
    const frPct = fundingRate * 100;
    // Funding trend: average of last 8 vs last 3
    if (frData.length >= 8) {
      const recent3 = frData.slice(-3).reduce(function(a,f){return a+parseFloat(f.fundingRate||0);},0)/3;
      const older8 = frData.slice(-8,-3).reduce(function(a,f){return a+parseFloat(f.fundingRate||0);},0)/5;
      if (recent3 < older8 - 0.0002) fundingTrend = 'FALLING';
      else if (recent3 > older8 + 0.0002) fundingTrend = 'RISING';
    }
    if (frPct < -0.1) fundingLabel = frPct.toFixed(3) + '% \ud83d\udd25 SHORT SQUEEZE (' + fundingTrend + ')';
    else if (frPct < -0.05) fundingLabel = frPct.toFixed(3) + '% Negative (' + fundingTrend + ')';
    else if (frPct > 0.1) fundingLabel = '+' + frPct.toFixed(3) + '% \ud83d\udd25 LONG LURE (' + fundingTrend + ')';
    else if (frPct > 0.05) fundingLabel = '+' + frPct.toFixed(3) + '% High (' + fundingTrend + ')';
    else fundingLabel = (frPct>=0?'+':'') + frPct.toFixed(3) + '% (' + fundingTrend + ')';
  }
} catch(e) {}
const frPct = fundingRate * 100;

// Open Interest HISTORY (30 periods) — trend analysis
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
    oiLabel = oiStr + ' ' + (oiTrend === 'RISING' ? '\u2191+' : oiTrend === 'FALLING' ? '\u2193' : '\u2194') + oiChange.toFixed(1) + '%';
  } else if (oiData.length > 0) {
    oiValue = parseFloat(oiData[oiData.length-1].sumOpenInterest || oiData[oiData.length-1].openInterest || 0);
    oiLabel = oiValue > 1e6 ? (oiValue/1e6).toFixed(1)+'M' : oiValue.toFixed(0);
  }
} catch(e) {}

// Long/Short Ratio
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
      if (recent > older + 0.1) { lsTrend = 'LONG_INCREASING'; lsLabel += ' \u2191 Longs growing'; }
      else if (recent < older - 0.1) { lsTrend = 'SHORT_INCREASING'; lsLabel += ' \u2193 Shorts growing'; }
      else lsLabel += ' Stable';
    }
    if (lsRatio > 2.5) lsLabel += ' \u26a0\ufe0f CROWDED LONG';
    else if (lsRatio < 0.5) lsLabel += ' \u26a0\ufe0f CROWDED SHORT';
  }
} catch(e) {}

// Taker Buy/Sell
let takerRatio = 1.0, takerLabel = 'N/A', takerBias = 'NEUTRAL';
try {
  const tkArr = $('Get Taker Volume').first().json;
  const tkData = Array.isArray(tkArr) ? tkArr : [tkArr];
  if (tkData.length > 0) {
    const last = tkData[tkData.length-1];
    const buyVol = parseFloat(last.buyVol || 0);
    const sellVol = parseFloat(last.sellVol || 0);
    takerRatio = sellVol > 0 ? buyVol / sellVol : 1;
    if (takerRatio > 1.3) { takerBias = 'BUY_AGGRESSIVE'; takerLabel = takerRatio.toFixed(2) + ' \ud83d\udfe2 Buyers aggressive'; }
    else if (takerRatio < 0.7) { takerBias = 'SELL_AGGRESSIVE'; takerLabel = takerRatio.toFixed(2) + ' \ud83d\udd34 Sellers aggressive'; }
    else takerLabel = takerRatio.toFixed(2) + ' Balanced';
    // Trend over last 5
    if (tkData.length >= 5) {
      const recent3 = tkData.slice(-3).reduce(function(a,t){return a+(parseFloat(t.buyVol||0)/Math.max(parseFloat(t.sellVol||1),0.001));},0)/3;
      const older = tkData.slice(-5,-3).reduce(function(a,t){return a+(parseFloat(t.buyVol||0)/Math.max(parseFloat(t.sellVol||1),0.001));},0)/2;
      if (recent3 > older + 0.15) takerLabel += ' (trend: BUY\u2191)';
      else if (recent3 < older - 0.15) takerLabel += ' (trend: SELL\u2191)';
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

// Support/Resistance with maximum data (1500 candles!)
var res1h=Math.max.apply(null,h.slice(-500));
var sup1h=Math.min.apply(null,l.slice(-500));

// Freefall
var ffCount=0;
for(var k=idx-5;k<=idx;k++){if(k>24){var ll=Math.min.apply(null,l.slice(k-24,k));if(l[k]<ll)ffCount++;}}

// Volume breakout ratio
var vol5avg=v.slice(Math.max(0,idx-5),idx).reduce(function(a,b){return a+b;},0)/Math.min(5,idx);
var volBreakRatio=vol5avg>0?v[idx]/vol5avg:1;

// 4H Analysis
var trend4h='SIDEWAYS',rsi4h=50,bias4h='NEUTRAL',res4h=0;
if(tf4h){var c4=tf4h.close,h4=tf4h.high;var E21_4=calcEMA(c4,21),E50_4=calcEMA(c4,50);var p4=c4[c4.length-1];rsi4h=calcRSI(c4);res4h=Math.max.apply(null,h4.slice(-200));
  if(p4>E21_4&&E21_4>E50_4){trend4h='UPTREND';bias4h='BULLISH';}else if(p4<E21_4&&E21_4<E50_4){trend4h='DOWNTREND';bias4h='BEARISH';}}

// 1D Macro (with 1500 candles = ~4 years!)
var dailyTrend='NEUTRAL',dailyEMA21=0,dailyEMA50=0,dailyEMA200=0;
var weeklyBias='NEUTRAL';
if(tf1d){var dc=tf1d.close;dailyEMA21=calcEMA(dc,21);dailyEMA50=calcEMA(dc,50);dailyEMA200=calcEMA(dc,200);
  var dp=dc[dc.length-1];
  if(dp>dailyEMA21&&dailyEMA21>dailyEMA50)dailyTrend='BULLISH';
  else if(dp<dailyEMA21&&dailyEMA21<dailyEMA50)dailyTrend='BEARISH';
  else if(dp>dailyEMA21)dailyTrend='ABOVE_EMA';
  else dailyTrend='BELOW_EMA';
  // Weekly bias from daily data (EMA200 = roughly weekly trend)
  if(dp>dailyEMA200)weeklyBias='ABOVE MA200';
  else weeklyBias='BELOW MA200';
}
var dailyBearish=dailyTrend==='BEARISH';
var dailyBullish=dailyTrend==='BULLISH'||dailyTrend==='ABOVE_EMA';

var effectiveRes=(res4h>0&&Math.abs(res4h-res1h)/price<0.05)?Math.max(res4h,res1h):(res4h>0?Math.min(res4h,res1h):res1h);

// ════════════════════════════════════════
// SCORING ENGINE v15.2
// ════════════════════════════════════════
var score=0,signal='NEUTRAL',strategy='WAIT',confidence='LOW';
var reasons=[];

// ═══ STRATEGY 1: BUY THE DIP ═══
if(wsPctChange<=-dynamicThreshold){
  // HARD GATES
  if(dailyBearish)return[{json:{isHot:false,symbol,rejectReason:'\ud83d\udeab Daily '+dailyTrend}}];
  if(_rsi>=50)return[{json:{isHot:false,symbol,rejectReason:'\ud83d\udeab RSI '+_rsi.toFixed(0)+' >=45'}}];
  if(ffCount>=3)return[{json:{isHot:false,symbol,rejectReason:'\ud83d\udeab FREEFALL'}}];
  if(!isGreen&&_rsi>=22)return[{json:{isHot:false,symbol,rejectReason:'\ud83d\udeab Red candle RSI '+_rsi.toFixed(0)}}];
  if(volRatio<1.2)return[{json:{isHot:false,symbol,rejectReason:'\ud83d\udeab Vol '+volRatio.toFixed(1)+'x'}}];
  if(_ms==='BEARISH')return[{json:{isHot:false,symbol,rejectReason:'\ud83d\udeab Structure BEARISH'}}];
  if(atrPct<0.25)return[{json:{isHot:false,symbol,rejectReason:'\ud83d\udeab ATR '+atrPct.toFixed(2)+'%'}}];

  // SCORING
  var absPct=Math.abs(wsPctChange);
  if(_rsi<20){score+=25;reasons.push('RSI '+_rsi.toFixed(0)+' EXTREME');}
  else if(_rsi<25){score+=20;reasons.push('RSI '+_rsi.toFixed(0)+' extreme');}
  else if(_rsi<30){score+=15;reasons.push('RSI '+_rsi.toFixed(0)+' oversold');}
  else if(_rsi<35){score+=10;reasons.push('RSI '+_rsi.toFixed(0));}
  else if(_rsi<40){score+=7;reasons.push('RSI '+_rsi.toFixed(0));}
  else{score+=4;}

  if(absPct>=10){score+=15;reasons.push(absPct.toFixed(1)+'% CRASH');}
  else if(absPct>=7){score+=12;reasons.push(absPct.toFixed(1)+'% big drop');}
  else if(absPct>=5){score+=9;reasons.push(absPct.toFixed(1)+'% drop');}
  else{score+=5;}

  if(volRatio>4){score+=12;reasons.push('Vol '+volRatio.toFixed(1)+'x massive');}
  else if(volRatio>2.5){score+=8;reasons.push('Vol '+volRatio.toFixed(1)+'x');}
  else{score+=4;}

  if(bodyRatio>0.6){score+=12;reasons.push('Marubozu');}
  else if(bodyRatio>0.4){score+=8;reasons.push('Strong green');}
  else{score+=4;}

  if(_macd.cu){score+=12;reasons.push('MACD Bull Cross');}
  else if(_macd.h<0&&_macd.h>_macd.ph){score+=7;reasons.push('MACD turning');}

  // Support (using 500 candle range)
  var sup=Math.min.apply(null,l.slice(Math.max(0,idx-168),idx));
  var dSup=(price-sup)/price*100;
  if(dSup<0.5){score+=12;reasons.push('Double Bottom');}
  else if(dSup<1.5){score+=7;reasons.push('Near support');}
  else if(dSup<3){score+=3;}

  if(range>0&&lowerWick/range>0.5){score+=7;reasons.push('Buyer wick');}
  else if(range>0&&lowerWick/range>0.3){score+=4;}

  // Market Structure
  if(_ms==='BULLISH'){score+=15;reasons.push('Structure HH+HL');}
  else if(_ms==='TRANSITION_UP'){score+=10;reasons.push('Structure TRANSITION');}

  // NEW v15.2: Funding Rate + Trend
  if(frPct<-0.1){score+=15;reasons.push('Funding '+frPct.toFixed(3)+'% SHORT SQZ');}
  else if(frPct<-0.05){score+=10;reasons.push('Funding negative');}
  else if(frPct>0.05){score-=5;}
  if(fundingTrend==='FALLING'&&frPct<0){score+=5;reasons.push('FR trend falling');}

  // NEW v15.2: Open Interest analysis
  // OI data is single snapshot. We can't trend it without history in Code Node.
  // But we output it for the trader to see.

  // NEW v15.2: Long/Short Ratio — contrarian
  if(lsRatio>2.5){score+=10;reasons.push('L/S '+lsRatio.toFixed(1)+' CROWDED LONG \u2192 liquidation risk');}
  else if(lsRatio>1.8){score+=5;reasons.push('L/S '+lsRatio.toFixed(1)+' long heavy');}
  else if(lsRatio<0.5){score-=8;reasons.push('L/S '+lsRatio.toFixed(1)+' shorts dominate');}
  if(lsTrend==='SHORT_INCREASING'){score+=5;reasons.push('Shorts growing \u2192 squeeze setup');}

  // NEW v15.2: Taker Buy/Sell — smart money
  if(takerBias==='BUY_AGGRESSIVE'){score+=12;reasons.push('Taker BUY '+takerRatio.toFixed(2)+' \ud83d\udfe2');}
  else if(takerBias==='SELL_AGGRESSIVE'){score-=8;reasons.push('Taker SELL aggressive');}

  // NEW: OI Trend scoring
  if (oiTrend === 'RISING' && wsPctChange < 0) { score += 10; reasons.push('OI RISING + price drop = squeeze setup'); }
  else if (oiTrend === 'FALLING' && wsPctChange < 0) { score += 5; reasons.push('OI FALLING = longs closing, bottom near'); }

  // RSI Divergence
  if(_rsiDiv.bullish){score+=20;reasons.push('RSI BULL DIVERGENCE');}

  // 4H / Daily alignment
  if(bias4h==='BULLISH'){score+=8;reasons.push('4H UPTREND');}
  else if(bias4h==='BEARISH'){score-=5;reasons.push('4H downtrend');}
  if(dailyTrend==='BULLISH'){score+=5;reasons.push('Daily BULLISH');}
  else if(dailyTrend==='ABOVE_EMA'){score+=3;}
  else if(dailyTrend==='BELOW_EMA'){score-=8;reasons.push('Daily BELOW EMA');}

  // v15.4: Volume tier penalty
  if (volPenalty !== 0) { score += volPenalty; reasons.push('LiqPenalty ' + volPenalty); }

  // Classify
  if(score>=60){signal='STRONG BUY';strategy='LONG (Buy Dip)';confidence=volTier==='LOW'?'HIGH':'VERY HIGH';}
  else if(score>=48){signal='STRONG BUY';strategy='LONG (Buy Dip)';confidence='HIGH';}
  else{reasons.push('Score ' + score + ' (min 58)');}
}

// ═══ STRATEGY 2&3: PUMP (SHORT / BREAKOUT) ═══
else if(wsPctChange>=dynamicThreshold){
  var shortScore=0,breakoutScore=0;
  var shortReasons=[],breakoutReasons=[];

  // SHORT
  var hasWickReject=range>0&&upperWick/range>0.3;
  var shortGate=(_rsi>=60)&&(isRed||(_rsi>=72)||hasWickReject);
  if(shortGate){
    if(_rsi>=80){shortScore+=25;shortReasons.push('RSI '+_rsi.toFixed(0)+' EXTREME OB');}
    else if(_rsi>=75){shortScore+=20;shortReasons.push('RSI '+_rsi.toFixed(0));}
    else if(_rsi>=70){shortScore+=15;shortReasons.push('RSI '+_rsi.toFixed(0));}
    else{shortScore+=8;}

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

    // v15.2: Funding contrarian
    if(frPct>0.1){shortScore+=15;shortReasons.push('Funding +'+frPct.toFixed(3)+'% LONG LURE');}
    else if(frPct>0.05){shortScore+=8;shortReasons.push('Funding high');}

    // v15.2: L/S Ratio — crowded longs = good to short
    if(lsRatio>2.5){shortScore+=12;shortReasons.push('L/S '+lsRatio.toFixed(1)+' CROWDED LONG');}
    else if(lsRatio>1.8){shortScore+=6;shortReasons.push('L/S long heavy');}

    // v15.2: Taker — sellers aggressive = short confirmation
    if(takerBias==='SELL_AGGRESSIVE'){shortScore+=10;shortReasons.push('Taker SELL aggressive');}

    // OI trend for SHORT
    if (oiTrend === 'RISING' && wsPctChange > 0) { shortScore -= 5; shortReasons.push('OI RISING = trend valid, careful short'); }
    else if (oiTrend === 'FALLING' && wsPctChange > 0) { shortScore += 8; shortReasons.push('OI FALLING = fake pump'); }

    if(_rsiDiv.bearish){shortScore+=20;shortReasons.push('RSI BEAR DIVERGENCE');}
    if(dailyBearish){shortScore+=8;shortReasons.push('Daily BEAR');}
    if(bias4h==='BEARISH'){shortScore+=8;shortReasons.push('4H DOWN');}
  }

  // BREAKOUT
  var dRes1h=(price-res1h)/price*100;
  var breakGate=(dRes1h>0||(res4h>0&&price>res4h))&&volBreakRatio>1.1&&dailyBullish&&(range>0&&upperWick/range<0.5);
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

    // v15.2: Taker buy = confirms breakout
    if(takerBias==='BUY_AGGRESSIVE'){breakoutScore+=12;breakoutReasons.push('Taker BUY aggressive');}
    // v15.2: Funding negative = fuel for breakout
    if(frPct<-0.05){breakoutScore+=12;breakoutReasons.push('Funding neg SHORT SQZ');}

    if(bias4h==='BULLISH'){breakoutScore+=10;breakoutReasons.push('4H UPTREND');}
    if(dailyTrend==='BULLISH'){breakoutScore+=8;breakoutReasons.push('Daily BULL');}
  }

  // v15.4: Volume tier penalty for SHORT
  if (volPenalty !== 0 && shortGate) { shortScore += volPenalty; shortReasons.push('LiqPenalty ' + volPenalty); }
  if (volPenalty !== 0 && breakGate) { breakoutScore += volPenalty; breakoutReasons.push('LiqPenalty ' + volPenalty); }

  // WINNER
  var shortOk=shortGate&&shortScore>=50;
  var breakOk=breakGate&&breakoutScore>=48;

  if(shortOk&&shortScore>=breakoutScore){
    score=shortScore;reasons.push.apply(reasons,shortReasons);
    if(score>=75){signal='STRONG SELL';strategy='SHORT (Overbought)';confidence=volTier==='LOW'?'HIGH':'VERY HIGH';}
    else{signal='STRONG SELL';strategy='SHORT (Overbought)';confidence='HIGH';}
  } else if(breakOk){
    score=breakoutScore;reasons.push.apply(reasons,breakoutReasons);
    if(score>=75){signal='STRONG BUY';strategy='LONG (Breakout)';confidence=volTier==='LOW'?'HIGH':'VERY HIGH';}
    else{signal='STRONG BUY';strategy='LONG (Breakout)';confidence='HIGH';}
  } else {
    reasons.push('Pump '+wsPctChange.toFixed(1)+'%');
    if(shortGate)reasons.push('SHORT sc:'+shortScore);
    if(breakGate)reasons.push('BREAK sc:'+breakoutScore);
  }
} else {
  reasons.push('Change '+wsPctChange.toFixed(1)+'% < threshold');
}

// ═══ SL/TP ═══
var sl=0,tp1=0,tp2=0,tp3=0,riskPct='0';
var isStrongSignal=signal==='STRONG BUY'||signal==='STRONG SELL';
if(_atr>0&&isStrongSignal){
  if(strategy.indexOf('LONG')!==-1){
    sl=price-(_atr*2);var slDist=price-sl;var meanDist=Math.max(E21-price,_atr*2);
    tp1=price+Math.max(meanDist*0.4,slDist*1.5);tp2=price+Math.max(meanDist*0.7,slDist*2.5);tp3=price+Math.max(meanDist*1.0,slDist*3.5);
    riskPct=((slDist/price)*100).toFixed(2);
  } else {
    sl=price+(_atr*2);var slDist=sl-price;var meanDist=Math.max(price-E21,_atr*2);
    tp1=price-Math.max(meanDist*0.4,slDist*1.5);tp2=price-Math.max(meanDist*0.7,slDist*2.5);tp3=price-Math.max(meanDist*1.0,slDist*3.5);
    riskPct=((slDist/price)*100).toFixed(2);
  }
}
var estTP1Pct=strategy.indexOf('LONG')!==-1?(tp1-price)/price*100:(price-tp1)/price*100;
var estTP2Pct=strategy.indexOf('LONG')!==-1?(tp2-price)/price*100:(price-tp2)/price*100;
var estTP3Pct=strategy.indexOf('LONG')!==-1?(tp3-price)/price*100:(price-tp3)/price*100;
var estRiskPct=parseFloat(riskPct)||0;

// DEDUP
if(isStrongSignal&&lastEntry&&(nowTs-lastEntry.ts<10800000)){
  if(score-lastEntry.score<12)return[{json:{isHot:false,symbol,rejectReason:'\ud83d\udd01 DEDUP sc '+lastEntry.score+'\u2192'+score}}];
}
if(isStrongSignal){state.signalCache[dedupKey]={ts:nowTs,score,signal};}

return [{json:{
  symbol, price:price.toFixed(4),
  wsChange:wsPctChange.toFixed(2)+'%', wsDirection,
  signal, strategy, confidence, score,
  reasons:reasons.join(' | '),
  dailyTrend, weeklyBias,
  trend4h, trend1h,
  rsi1h:_rsi.toFixed(1), rsi4h:rsi4h.toFixed(1),
  marketStructure:_ms,
  rsiDivergence:_rsiDiv.bullish?'BULL DIV \ud83d\udd25':(_rsiDiv.bearish?'BEAR DIV \ud83d\udd25':'None'),
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
  rejectReason:!isStrongSignal?'Score ' + score + '/100. '+reasons.join(', '):'',
  version:'v15.4',
}}];