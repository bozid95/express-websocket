const fs = require('fs');
const path = 'c:/Project/express-websocket/n8n-workflow-hybrid.json';

// ══════════════════════════════════════════════════════
// PRO ANALISA TA v15 CODE
// ══════════════════════════════════════════════════════
const v15Code = `// ═══════════════════════════════════════════════════════════════
// SPIKE HUNTER PRO v15 — PRO CRYPTO FUTURES ENGINE
// Daily Macro Filter | Market Structure | Funding Rate | Clean TA
// Removed: OBV, ADX, BB Squeeze, EMA 9/21 (not relevant for crypto)
// ═══════════════════════════════════════════════════════════════

const webhookData = $('Webhook Trigger').first().json.body;
const symbol = webhookData.symbol;
const wsPctChange = parseFloat(webhookData.priceChangePercent);
const wsDirection = webhookData.direction;
const dynamicThreshold = webhookData.threshold ? parseFloat(webhookData.threshold) : 2.0;
const nowTs = Date.now();

// ═══ LAYER 1: FRESHNESS ═══
const FRESHNESS_LIMIT_MS = 3 * 60 * 1000;
if (webhookData.triggeredAt) {
  const triggeredTs = new Date(webhookData.triggeredAt).getTime();
  const ageSec = Math.round((nowTs - triggeredTs) / 1000);
  if (nowTs - triggeredTs > FRESHNESS_LIMIT_MS) {
    return [{ json: { isHot: false, symbol, rejectReason: '\\u23f0 STALE: ' + ageSec + 's (max 180s)' } }];
  }
}

// ═══ LAYER 2: RATE LIMIT + DEDUP ═══
const DEDUP_WINDOW_MS = 3 * 60 * 60 * 1000;
const RATE_LIMIT_MS = 10 * 60 * 1000;
const SCORE_UPGRADE_THRESHOLD = 12;
const state = $getWorkflowStaticData('global');
if (!state.signalCache) state.signalCache = {};
for (const key of Object.keys(state.signalCache)) {
  if (nowTs - state.signalCache[key].ts > 6 * 60 * 60 * 1000) delete state.signalCache[key];
}
const dedupKey = symbol + '_' + wsDirection;
const lastEntry = state.signalCache[dedupKey];
if (lastEntry && (nowTs - lastEntry.ts < RATE_LIMIT_MS)) {
  return [{ json: { isHot: false, symbol, rejectReason: '\\ud83d\\udd04 RATE LIMIT: ' + Math.round((nowTs - lastEntry.ts) / 60000) + 'm lalu' } }];
}

// ═══ KLINES PARSING ═══
function parseKlines(nodeName) {
  try {
    let raw = $(nodeName).first().json;
    let data = Array.isArray(raw) ? raw : (typeof raw.data === 'string' ? JSON.parse(raw.data) : raw.data);
    if (!Array.isArray(data) || data.length < 20) return null;
    return {
      open:   data.map(function(k) { return parseFloat(k[1]); }),
      high:   data.map(function(k) { return parseFloat(k[2]); }),
      low:    data.map(function(k) { return parseFloat(k[3]); }),
      close:  data.map(function(k) { return parseFloat(k[4]); }),
      volume: data.map(function(k) { return parseFloat(k[5]); }),
    };
  } catch(e) { return null; }
}

const tf1h = parseKlines('Get Klines 1h');
const tf4h = parseKlines('Get Klines 4h');
const tf1d = parseKlines('Get Klines 1D');
if (!tf1h) return [{ json: { isHot: false, symbol, rejectReason: 'Data klines 1H tidak cukup' } }];

// ═══ INDICATOR FUNCTIONS ═══
function calcEMA(p, n) {
  if (p.length < n) return p[p.length-1] || 0;
  const k = 2/(n+1);
  let e = p.slice(0,n).reduce(function(a,b){return a+b;})/n;
  for (let i=n; i<p.length; i++) e=(p[i]-e)*k+e;
  return e;
}
function calcEMAArr(p, n) {
  const k = 2/(n+1); let e = p.slice(0,n).reduce(function(a,b){return a+b;})/n;
  const r = new Array(n-1).fill(null); r.push(e);
  for (let i=n; i<p.length; i++) { e=(p[i]-e)*k+e; r.push(e); }
  return r;
}
function calcRSI(p, n) {
  n = n || 14;
  if (p.length < n+1) return 50;
  let g=0,lo=0;
  for (let i=1; i<=n; i++) { let d=p[i]-p[i-1]; d>=0?g+=d:lo-=d; }
  let ag=g/n, al=lo/n;
  for (let i=n+1; i<p.length; i++) {
    let d=p[i]-p[i-1]; ag=((ag*(n-1))+(d>=0?d:0))/n; al=((al*(n-1))+(d<0?-d:0))/n;
  }
  return al===0 ? 100 : 100-(100/(1+(ag/al)));
}
function calcRSIArr(p, n) {
  n = n || 14;
  const result = [];
  for (let i = 0; i < p.length; i++) {
    if (i < n) { result.push(null); continue; }
    result.push(calcRSI(p.slice(0, i+1), n));
  }
  return result;
}
function calcMACD(p) {
  const e12 = calcEMAArr(p, 12), e26 = calcEMAArr(p, 26), ml = [];
  for (let i=0; i<p.length; i++) if(e12[i]!==null&&e26[i]!==null) ml.push(e12[i]-e26[i]);
  if (ml.length<9) return {h:0,ph:0,cu:false,cd:false,hist:0};
  const sl = calcEMAArr(ml, 9);
  const lm=ml[ml.length-1], ls=sl[sl.length-1]||0, pm=ml[ml.length-2]||lm, ps=sl[sl.length-2]||ls;
  return {h:lm-ls, ph:pm-ps, cu:pm<=ps&&lm>ls, cd:pm>=ps&&lm<ls, hist:lm-ls};
}
function calcATR(h,l,c,n) {
  n=n||14; if(h.length<n+1) return 0;
  let t=[h[0]-l[0]];
  for(let i=1;i<h.length;i++) t.push(Math.max(h[i]-l[i],Math.abs(h[i]-c[i-1]),Math.abs(l[i]-c[i-1])));
  let a=t.slice(0,n).reduce(function(x,y){return x+y;})/n;
  for(let i=n;i<t.length;i++) a=(a*(n-1)+t[i])/n;
  return a;
}

// ═══ NEW: MARKET STRUCTURE ANALYSIS ═══
// Detects: BULLISH (HH+HL), BEARISH (LH+LL), or TRANSITION
function analyzeMarketStructure(h, l, c, lookback) {
  lookback = lookback || 30;
  const len = c.length;
  if (len < lookback) return 'NEUTRAL';
  const slice_h = h.slice(len-lookback);
  const slice_l = l.slice(len-lookback);
  const slice_c = c.slice(len-lookback);

  // Find swing highs and lows
  const swingHighs = [], swingLows = [];
  for (let i = 2; i < slice_h.length - 2; i++) {
    if (slice_h[i] > slice_h[i-1] && slice_h[i] > slice_h[i-2] &&
        slice_h[i] > slice_h[i+1] && slice_h[i] > slice_h[i+2]) {
      swingHighs.push({ idx: i, val: slice_h[i] });
    }
    if (slice_l[i] < slice_l[i-1] && slice_l[i] < slice_l[i-2] &&
        slice_l[i] < slice_l[i+1] && slice_l[i] < slice_l[i+2]) {
      swingLows.push({ idx: i, val: slice_l[i] });
    }
  }

  if (swingHighs.length < 2 || swingLows.length < 2) return 'NEUTRAL';

  // Compare last 2 swing highs and lows
  const lastHH = swingHighs[swingHighs.length-1].val;
  const prevHH = swingHighs[swingHighs.length-2].val;
  const lastLL = swingLows[swingLows.length-1].val;
  const prevLL = swingLows[swingLows.length-2].val;

  const higherHigh = lastHH > prevHH;
  const higherLow = lastLL > prevLL;
  const lowerHigh = lastHH < prevHH;
  const lowerLow = lastLL < prevLL;

  if (higherHigh && higherLow) return 'BULLISH';  // HH + HL
  if (lowerHigh && lowerLow) return 'BEARISH';    // LH + LL
  if (higherLow && lowerHigh) return 'TRANSITION_UP';  // Potential reversal up
  if (lowerLow && higherHigh) return 'CHOPPY';
  return 'NEUTRAL';
}

// ═══ NEW: RSI DIVERGENCE ═══
function detectRSIDivergence(close, low, high, rsiArr, lookback) {
  lookback = lookback || 40;
  const idx = close.length - 1;
  if (idx < lookback || !rsiArr[idx]) return { bullish: false, bearish: false };
  const startIdx = idx - lookback;
  let bullDiv = false, bearDiv = false;

  for (let i = startIdx + 2; i < idx - 2; i++) {
    if (!rsiArr[i]) continue;
    const isSwingLow = low[i] <= low[i-1] && low[i] <= low[i-2] && low[i] <= low[i+1] && low[i] <= low[i+2];
    if (isSwingLow && (low[idx] < low[i] || Math.abs(low[idx]-low[i])/low[i] < 0.005)) {
      if (rsiArr[idx] > rsiArr[i] + 3) { bullDiv = true; break; }
    }
  }
  for (let i = startIdx + 2; i < idx - 2; i++) {
    if (!rsiArr[i]) continue;
    const isSwingHigh = high[i] >= high[i-1] && high[i] >= high[i-2] && high[i] >= high[i+1] && high[i] >= high[i+2];
    if (isSwingHigh && (high[idx] > high[i] || Math.abs(high[idx]-high[i])/high[i] < 0.005)) {
      if (rsiArr[idx] < rsiArr[i] - 3) { bearDiv = true; break; }
    }
  }
  return { bullish: bullDiv, bearish: bearDiv };
}

// ═══ 1D MACRO TREND ═══
let dailyTrend = 'NEUTRAL';
let dailyEMA21 = 0;
let dailyEMA50 = 0;
if (tf1d) {
  const dc = tf1d.close;
  dailyEMA21 = calcEMA(dc, 21);
  dailyEMA50 = calcEMA(dc, 50);
  const dPrice = dc[dc.length-1];
  const dPrev = (dc.length > 1) ? dc[dc.length-2] : dPrice;
  if (dPrice > dailyEMA21 && dailyEMA21 > dailyEMA50) dailyTrend = 'BULLISH';
  else if (dPrice < dailyEMA21 && dailyEMA21 < dailyEMA50) dailyTrend = 'BEARISH';
  else if (dPrice > dailyEMA21) dailyTrend = 'ABOVE_EMA';
  else dailyTrend = 'BELOW_EMA';
}

// IS DAILY BULLISH? (Above EMA21)
const dailyBullish = dailyTrend === 'BULLISH' || dailyTrend === 'ABOVE_EMA';
const dailyBearish = dailyTrend === 'BEARISH' || dailyTrend === 'BELOW_EMA';

// ═══ 4H TREND ═══
let trend4h = 'SIDEWAYS', rsi4h = 50, trend4hBias = 'NEUTRAL', res4h = 0;
if (tf4h) {
  const c4 = tf4h.close, h4 = tf4h.high;
  const E21_4h = calcEMA(c4, 21);
  const E50_4h = calcEMA(c4, 50);
  const p4h = c4[c4.length-1];
  rsi4h = calcRSI(c4);
  res4h = Math.max.apply(null, h4.slice(-90));
  if (p4h > E21_4h && E21_4h > E50_4h) { trend4h = 'UPTREND'; trend4hBias = 'BULLISH'; }
  else if (p4h < E21_4h && E21_4h < E50_4h) { trend4h = 'DOWNTREND'; trend4hBias = 'BEARISH'; }
}

// ═══ 1H INDICATORS ═══
const c = tf1h.close, h = tf1h.high, l = tf1h.low, o = tf1h.open, v = tf1h.volume;
const price = c[c.length-1];
const idx = c.length - 1;
const _rsi = calcRSI(c);
const _prevRsi = calcRSI(c.slice(0,-1));
const _rsiArr = calcRSIArr(c, 14);
const _macd = calcMACD(c);
const _atr = calcATR(h, l, c);
const E21 = calcEMA(c, 21);
const E50 = calcEMA(c, 50);
const E200 = calcEMA(c, 200);

const avgVol = v.slice(-20).reduce(function(a,b){return a+b;})/20;
const volRatio = avgVol > 0 ? v[v.length-1]/avgVol : 1;
const res1h = Math.max.apply(null, h.slice(-200));
const recentL = Math.min.apply(null, l.slice(-200));
const effectiveRes = (res4h > 0 && Math.abs(res4h-res1h)/price < 0.05)
  ? Math.max(res4h, res1h) : (res4h > 0 ? Math.min(res4h, res1h) : res1h);

let trend1h = 'SIDEWAYS';
if (price > E21 && E21 > E50) trend1h = 'UPTREND';
else if (price < E21 && E21 < E50) trend1h = 'DOWNTREND';

const body = Math.abs(c[idx]-o[idx]);
const range = h[idx]-l[idx];
const upperWick = h[idx]-Math.max(c[idx],o[idx]);
const lowerWick = Math.min(c[idx],o[idx])-l[idx];
const bodyRatio = range > 0 ? body/range : 0;
const isGreen = c[idx] > o[idx];
const isRed = c[idx] < o[idx];

// Last CLOSED candle check (index -2 = last completed candle)
const lastClosedDrop = o.length > 1 ? ((c[idx-1] - o[idx-1]) / o[idx-1]) * 100 : 0;
const lastClosedPump = lastClosedDrop; // positive = pump

// Volume for breakout (vs 5 bar avg)
const vol5avg = v.slice(Math.max(0,idx-5),idx).reduce(function(a,b){return a+b;},0) / Math.min(5,idx);
const volBreakRatio = vol5avg > 0 ? v[idx]/vol5avg : 1;

// Freefall
let ffCount = 0;
for (let k=idx-5;k<=idx;k++) {
  if (k>24) { const ll=Math.min.apply(null,l.slice(k-24,k)); if(l[k]<ll) ffCount++; }
}

// ATR %
const atrPct = price > 0 ? (_atr/price)*100 : 0;

// Market Structure
const _marketStructure = analyzeMarketStructure(h, l, c, 30);

// RSI Divergence
const _rsiDiv = detectRSIDivergence(c, l, h, _rsiArr, 40);

// ═══ FUNDING RATE (from separate node) ═══
let fundingRate = 0;
let fundingLabel = 'N/A';
try {
  const fr = $('Get Funding Rate').first().json;
  fundingRate = parseFloat(fr.lastFundingRate || fr.body?.lastFundingRate || 0);
  const frPct = fundingRate * 100;
  if (frPct < -0.1) fundingLabel = frPct.toFixed(3) + '% \\ud83d\\udd25 SHORT SQUEEZE';
  else if (frPct < -0.05) fundingLabel = frPct.toFixed(3) + '% Negative';
  else if (frPct > 0.1) fundingLabel = '+' + frPct.toFixed(3) + '% \\ud83d\\udd25 LONG LURE';
  else if (frPct > 0.05) fundingLabel = '+' + frPct.toFixed(3) + '% High';
  else fundingLabel = (frPct >= 0 ? '+' : '') + frPct.toFixed(3) + '% Neutral';
} catch(e) { fundingRate = 0; fundingLabel = 'N/A'; }

const frPct = fundingRate * 100;

// ════════════════════════════════════════════════════════
// SCORING ENGINE
// ════════════════════════════════════════════════════════
let score = 0, signal = 'NEUTRAL', strategy = 'WAIT', confidence = 'LOW';
const reasons = [];

// ═══ STRATEGY 1: BUY THE DIP ═══
if (wsPctChange <= -dynamicThreshold) {

  // ── HARD GATES ──
  // GATE A: Daily macro — no LONG in daily downtrend
  if (dailyBearish) {
    return [{ json: { isHot: false, symbol, rejectReason: '\\ud83d\\udeab GATE: Daily ' + dailyTrend + ' — no LONG melawan macro bear' } }];
  }
  // GATE B: RSI oversold (core signal)
  if (_rsi >= 42) {
    return [{ json: { isHot: false, symbol, rejectReason: '\\ud83d\\udeab GATE: RSI ' + _rsi.toFixed(0) + ' tidak oversold' } }];
  }
  // GATE C: No freefall
  if (ffCount >= 3) {
    return [{ json: { isHot: false, symbol, rejectReason: '\\ud83d\\udeab GATE: FREEFALL (' + ffCount + ' break low)' } }];
  }
  // GATE D: Green candle confirmation
  if (!isGreen) {
    return [{ json: { isHot: false, symbol, rejectReason: '\\ud83d\\udeab GATE: Candle merah — tunggu hijau. RSI: ' + _rsi.toFixed(0) } }];
  }
  // GATE E: Volume must be present
  if (volRatio < 1.5) {
    return [{ json: { isHot: false, symbol, rejectReason: '\\ud83d\\udeab GATE: Volume ' + volRatio.toFixed(1) + 'x — min 1.5x' } }];
  }
  // GATE F: Market structure must not be BEARISH
  if (_marketStructure === 'BEARISH') {
    return [{ json: { isHot: false, symbol, rejectReason: '\\ud83d\\udeab GATE: Market structure BEARISH (LH+LL) — no buy dip' } }];
  }
  // GATE G: ATR filter
  if (atrPct < 0.3) {
    return [{ json: { isHot: false, symbol, rejectReason: '\\ud83d\\udeab GATE: ATR ' + atrPct.toFixed(2) + '% terlalu rendah' } }];
  }

  // ── SCORING ──
  // 1. RSI level (max 25)
  if (_rsi < 20) { score += 25; reasons.push('RSI ' + _rsi.toFixed(0) + ' EXTREME \\ud83d\\udd25'); }
  else if (_rsi < 25) { score += 20; reasons.push('RSI ' + _rsi.toFixed(0) + ' extreme oversold'); }
  else if (_rsi < 30) { score += 15; reasons.push('RSI ' + _rsi.toFixed(0) + ' oversold'); }
  else if (_rsi < 35) { score += 10; reasons.push('RSI ' + _rsi.toFixed(0)); }
  else { score += 5; reasons.push('RSI ' + _rsi.toFixed(0) + ' borderline'); }

  // 2. Drop magnitude (max 15)
  const absPct = Math.abs(wsPctChange);
  if (absPct >= 10) { score += 15; reasons.push(absPct.toFixed(1) + '% CRASH \\ud83d\\udca5'); }
  else if (absPct >= 7) { score += 12; reasons.push(absPct.toFixed(1) + '% big drop'); }
  else if (absPct >= 5) { score += 9; reasons.push(absPct.toFixed(1) + '% drop'); }
  else { score += 5; reasons.push(absPct.toFixed(1) + '% dip'); }

  // 3. Volume (max 12)
  if (volRatio > 4.0) { score += 12; reasons.push('Vol ' + volRatio.toFixed(1) + 'x massive'); }
  else if (volRatio > 2.5) { score += 8; reasons.push('Vol ' + volRatio.toFixed(1) + 'x spike'); }
  else { score += 4; reasons.push('Vol ' + volRatio.toFixed(1) + 'x'); }

  // 4. Candle quality (max 12)
  if (bodyRatio > 0.6) { score += 12; reasons.push('Marubozu (' + (bodyRatio*100).toFixed(0) + '%) \\u2705'); }
  else if (bodyRatio > 0.4) { score += 8; reasons.push('Strong green (' + (bodyRatio*100).toFixed(0) + '%)'); }
  else { score += 4; reasons.push('Green (' + (bodyRatio*100).toFixed(0) + '%)'); }

  // 5. MACD (max 12)
  if (_macd.cu) { score += 12; reasons.push('MACD Bull Cross \\ud83d\\udd25'); }
  else if (_macd.h < 0 && _macd.h > _macd.ph) { score += 7; reasons.push('MACD turning \\u2191'); }
  else { reasons.push('MACD bearish'); }

  // 6. Support level (max 12)
  const sup = Math.min.apply(null, l.slice(Math.max(0,idx-168),idx));
  const dSup = (price-sup)/price*100;
  if (dSup < 0.5) { score += 12; reasons.push('Double Bottom \\u2705'); }
  else if (dSup < 1.5) { score += 7; reasons.push('Near support (' + dSup.toFixed(1) + '%)'); }
  else if (dSup < 3) { score += 3; }

  // 7. Lower wick (max 7)
  if (range > 0 && lowerWick/range > 0.5) { score += 7; reasons.push('Buyer wick \\u2191'); }
  else if (range > 0 && lowerWick/range > 0.3) { score += 4; }

  // 8. NEW: Market Structure bonus (max 15)
  if (_marketStructure === 'BULLISH') { score += 15; reasons.push('Structure: HH+HL \\u2705'); }
  else if (_marketStructure === 'TRANSITION_UP') { score += 10; reasons.push('Structure: TRANSITION \\u2705'); }
  else { reasons.push('Structure: ' + _marketStructure); }

  // 9. NEW: Funding Rate (max 15) — contrarian signal
  if (frPct < -0.1) { score += 15; reasons.push('Funding ' + frPct.toFixed(3) + '% — SHORT SQUEEZE \\ud83d\\udd25'); }
  else if (frPct < -0.05) { score += 10; reasons.push('Funding ' + frPct.toFixed(3) + '% negative'); }
  else if (frPct > 0.05) { score -= 5; reasons.push('Funding +' + frPct.toFixed(3) + '% — long crowded'); }

  // 10. New: RSI Divergence (max 20) — very strong reversal signal
  if (_rsiDiv.bullish) { score += 20; reasons.push('\\ud83d\\udd25 RSI BULLISH DIVERGENCE'); }

  // 11. 4H alignment bonus
  if (trend4hBias === 'BULLISH') { score += 8; reasons.push('4H UPTREND \\u2705'); }
  else if (trend4hBias === 'BEARISH') { score -= 5; reasons.push('4H downtrend \\u26a0\\ufe0f'); }

  // ── CLASSIFY ──
  if (score >= 68) { signal = 'STRONG BUY'; strategy = 'LONG (Buy Dip)'; confidence = 'VERY HIGH'; }
  else if (score >= 58) { signal = 'STRONG BUY'; strategy = 'LONG (Buy Dip)'; confidence = 'HIGH'; }
  else { reasons.push('Score ' + score + ' (min 58)'); }
}

// ═══ STRATEGY 2 & 3: PUMP ═══
else if (wsPctChange >= dynamicThreshold) {
  let shortScore = 0, breakoutScore = 0;
  const shortReasons = [], breakoutReasons = [];

  // ── SHORT: GATE Daily BULLISH = no short ──
  const shortGate = (_rsi >= 65) && isRed && (!dailyBullish);
  if (shortGate) {
    if (_rsi >= 80) { shortScore += 25; shortReasons.push('RSI ' + _rsi.toFixed(0) + ' EXTREME OB \\ud83d\\udd25'); }
    else if (_rsi >= 75) { shortScore += 20; shortReasons.push('RSI ' + _rsi.toFixed(0) + ' OB'); }
    else if (_rsi >= 70) { shortScore += 15; shortReasons.push('RSI ' + _rsi.toFixed(0)); }
    else { shortScore += 8; shortReasons.push('RSI ' + _rsi.toFixed(0)); }

    if (wsPctChange >= 12) { shortScore += 15; shortReasons.push('Pump ' + wsPctChange.toFixed(1) + '% MASSIVE'); }
    else if (wsPctChange >= 8) { shortScore += 12; shortReasons.push('Pump ' + wsPctChange.toFixed(1) + '%'); }
    else if (wsPctChange >= 5) { shortScore += 8; shortReasons.push('Pump ' + wsPctChange.toFixed(1) + '%'); }
    else { shortScore += 4; }

    if (bodyRatio > 0.5) { shortScore += 12; shortReasons.push('Strong red reversal'); }
    else { shortScore += 7; shortReasons.push('Red candle'); }

    if (range > 0 && upperWick/range > 0.5) { shortScore += 12; shortReasons.push('Upper wick rejection'); }
    else if (range > 0 && upperWick/range > 0.3) { shortScore += 6; }

    if (_macd.cd) { shortScore += 12; shortReasons.push('MACD Bear Cross \\ud83d\\udd25'); }
    else if (_macd.h > 0 && _macd.h < _macd.ph) { shortScore += 6; shortReasons.push('MACD fading'); }

    const dRes = (effectiveRes-price)/price*100;
    if (dRes > -0.5 && dRes < 1.0) { shortScore += 10; shortReasons.push('At Resistance'); }

    // Market structure
    if (_marketStructure === 'BEARISH') { shortScore += 12; shortReasons.push('Structure: LH+LL \\u2705'); }

    // Funding — contrarian short
    if (frPct > 0.1) { shortScore += 15; shortReasons.push('Funding +' + frPct.toFixed(3) + '% LONG LURE \\ud83d\\udd25'); }
    else if (frPct > 0.05) { shortScore += 8; shortReasons.push('Funding high +' + frPct.toFixed(3) + '%'); }

    // RSI Bearish Divergence
    if (_rsiDiv.bearish) { shortScore += 20; shortReasons.push('\\ud83d\\udd25 RSI BEARISH DIVERGENCE'); }

    // Daily alignment
    if (dailyBearish) { shortScore += 8; shortReasons.push('Daily BEARISH \\u2705'); }
    if (trend4hBias === 'BEARISH') { shortScore += 8; shortReasons.push('4H DOWNTREND \\u2705'); }
  }

  // ── BREAKOUT: GATE Daily BEARISH = no breakout ──
  const dRes1hBreak = (price-res1h)/price*100;
  const breakGate = (dRes1hBreak > 0 || (res4h > 0 && price > res4h))
    && volBreakRatio > 1.5 && dailyBullish
    && (range > 0 && upperWick/range < 0.5);

  if (breakGate) {
    const prevAboveRes = idx > 0 && c[idx-1] > res1h;
    if (prevAboveRes) { breakoutScore += 18; breakoutReasons.push('2-bar close above res \\ud83d\\udd11'); }
    else { breakoutScore += 10; breakoutReasons.push('Breakout candle'); }

    if (volBreakRatio > 3.0) { breakoutScore += 20; breakoutReasons.push('Vol ' + volBreakRatio.toFixed(1) + 'x BREAKOUT \\ud83d\\udd25'); }
    else if (volBreakRatio > 2.0) { breakoutScore += 14; breakoutReasons.push('Vol ' + volBreakRatio.toFixed(1) + 'x'); }
    else { breakoutScore += 8; breakoutReasons.push('Vol ' + volBreakRatio.toFixed(1) + 'x'); }

    if (_rsi >= 55 && _rsi < 70) { breakoutScore += 15; breakoutReasons.push('RSI Momentum ' + _rsi.toFixed(0)); }
    else if (_rsi >= 50) { breakoutScore += 8; breakoutReasons.push('RSI ' + _rsi.toFixed(0)); }
    else { breakoutScore -= 5; breakoutReasons.push('RSI weak ' + _rsi.toFixed(0)); }

    if (isGreen && bodyRatio > 0.7) { breakoutScore += 15; breakoutReasons.push('Marubozu breakout'); }
    else if (isGreen && bodyRatio > 0.5) { breakoutScore += 8; breakoutReasons.push('Bullish body'); }

    const dRes4h = res4h > 0 ? (price-res4h)/price*100 : null;
    if (dRes4h !== null && dRes4h > 0 && dRes4h < 3) { breakoutScore += 18; breakoutReasons.push('4H Res BREAK \\ud83d\\udd11'); }
    else if (dRes1hBreak > 0 && dRes1hBreak < 2) { breakoutScore += 10; breakoutReasons.push('1H Res break'); }

    if (_macd.cu) { breakoutScore += 10; breakoutReasons.push('MACD Bull Cross'); }
    else if (_macd.h > 0 && _macd.h > _macd.ph) { breakoutScore += 6; breakoutReasons.push('MACD \\u2191'); }

    // Market structure aligned
    if (_marketStructure === 'BULLISH') { breakoutScore += 12; breakoutReasons.push('Structure: HH+HL \\u2705'); }

    // Funding — short squeeze = breakout reinforcement
    if (frPct < -0.05) { breakoutScore += 12; breakoutReasons.push('Funding neg — SHORT SQUEEZE \\ud83d\\udd25'); }

    if (trend4hBias === 'BULLISH') { breakoutScore += 10; breakoutReasons.push('4H UPTREND \\u2705'); }
    if (dailyTrend === 'BULLISH') { breakoutScore += 8; breakoutReasons.push('Daily BULLISH \\u2705'); }
  }

  // WINNER
  const shortOk = shortGate && shortScore >= 60;
  const breakOk = breakGate && breakoutScore >= 60;

  if (shortOk && shortScore >= breakoutScore) {
    score = shortScore; reasons.push.apply(reasons, shortReasons);
    if (score >= 75) { signal = 'STRONG SELL'; strategy = 'SHORT (Overbought)'; confidence = 'VERY HIGH'; }
    else { signal = 'STRONG SELL'; strategy = 'SHORT (Overbought)'; confidence = 'HIGH'; }
  } else if (breakOk) {
    score = breakoutScore; reasons.push.apply(reasons, breakoutReasons);
    if (score >= 75) { signal = 'STRONG BUY'; strategy = 'LONG (Breakout)'; confidence = 'VERY HIGH'; }
    else { signal = 'STRONG BUY'; strategy = 'LONG (Breakout)'; confidence = 'HIGH'; }
  } else {
    const why = [];
    if (shortGate) why.push('SHORT sc:' + shortScore);
    else why.push('SHORT gate fail (RSI/candle/daily)');
    if (breakGate) why.push('BREAK sc:' + breakoutScore);
    else why.push('BREAK gate fail');
    reasons.push('Pump ' + wsPctChange.toFixed(1) + '% — ' + why.join(' | '));
  }
} else {
  reasons.push('Change ' + wsPctChange.toFixed(1) + '% < threshold ' + dynamicThreshold + '%');
}

// ═══ SL/TP + PROFIT ESTIMATION ═══
let sl = 0, tp1 = 0, tp2 = 0, tp3 = 0, riskPct = '0';
const isStrongSignal = signal === 'STRONG BUY' || signal === 'STRONG SELL';

if (_atr > 0 && isStrongSignal) {
  if (strategy.indexOf('LONG') !== -1) {
    sl = price - (_atr * 2.0);
    const slDist = price - sl;
    const meanDist = Math.max(E21 - price, _atr * 2);
    tp1 = price + Math.max(meanDist * 0.4, slDist * 1.5);
    tp2 = price + Math.max(meanDist * 0.7, slDist * 2.5);
    tp3 = price + Math.max(meanDist * 1.0, slDist * 3.5);
    riskPct = ((slDist/price)*100).toFixed(2);
  } else {
    sl = price + (_atr * 2.0);
    const slDist = sl - price;
    const meanDist = Math.max(price - E21, _atr * 2);
    tp1 = price - Math.max(meanDist * 0.4, slDist * 1.5);
    tp2 = price - Math.max(meanDist * 0.7, slDist * 2.5);
    tp3 = price - Math.max(meanDist * 1.0, slDist * 3.5);
    riskPct = ((slDist/price)*100).toFixed(2);
  }
}

const estTP1Pct = strategy.indexOf('LONG') !== -1 ? (tp1-price)/price*100 : (price-tp1)/price*100;
const estTP2Pct = strategy.indexOf('LONG') !== -1 ? (tp2-price)/price*100 : (price-tp2)/price*100;
const estTP3Pct = strategy.indexOf('LONG') !== -1 ? (tp3-price)/price*100 : (price-tp3)/price*100;
const estRiskPct = parseFloat(riskPct) || 0;

// ═══ DEDUP FINAL ═══
if (isStrongSignal && lastEntry && (nowTs-lastEntry.ts < DEDUP_WINDOW_MS)) {
  if (score - lastEntry.score < SCORE_UPGRADE_THRESHOLD) {
    return [{ json: { isHot: false, symbol, rejectReason: '\\ud83d\\udd01 DEDUP: sent ' + Math.round((nowTs-lastEntry.ts)/60000) + 'm ago (sc ' + lastEntry.score + '\\u2192' + score + ')' } }];
  }
}
if (isStrongSignal) { state.signalCache[dedupKey] = { ts: nowTs, score, signal }; }

return [{
  json: {
    symbol, price: price.toFixed(4),
    wsChange: wsPctChange.toFixed(2) + '%', wsDirection,
    signal, strategy, confidence, score,
    reasons: reasons.join(' | '),
    dailyTrend,
    trend4h, trend1h: trend1h,
    rsi1h: _rsi.toFixed(1), rsi4h: rsi4h.toFixed(1),
    marketStructure: _marketStructure,
    fundingRate: fundingLabel,
    rsiDivergence: _rsiDiv.bullish ? 'BULL DIV \\ud83d\\udd25' : (_rsiDiv.bearish ? 'BEAR DIV \\ud83d\\udd25' : 'None'),
    macdCross: _macd.cu ? 'BULL CROSS' : (_macd.cd ? 'BEAR CROSS' : 'None'),
    macdHist: _macd.hist.toFixed(6),
    volRatio: volRatio.toFixed(1) + 'x', volBreakRatio: volBreakRatio.toFixed(1) + 'x',
    ema21: E21.toFixed(4), ema200: E200.toFixed(4),
    macroTrend: price > E200 ? 'ABOVE MA200' : 'BELOW MA200',
    res1h: res1h.toFixed(4), res4h: res4h > 0 ? res4h.toFixed(4) : 'N/A',
    support: recentL.toFixed(4), resistance: effectiveRes.toFixed(4),
    distSupport: ((price-recentL)/price*100).toFixed(2) + '%',
    distResistance: ((effectiveRes-price)/price*100).toFixed(2) + '%',
    sl: sl.toFixed(4), tp1: tp1.toFixed(4), tp2: tp2.toFixed(4), tp3: tp3.toFixed(4),
    riskPct: riskPct + '%', atr: _atr.toFixed(6), atrPct: atrPct.toFixed(2) + '%',
    estTP1: '+' + estTP1Pct.toFixed(2) + '%',
    estTP2: '+' + estTP2Pct.toFixed(2) + '%',
    estTP3: '+' + estTP3Pct.toFixed(2) + '%',
    estRisk: '-' + estRiskPct.toFixed(2) + '%',
    estRR1: '1:' + (estTP1Pct/(estRiskPct||1)).toFixed(1),
    estRR2: '1:' + (estTP2Pct/(estRiskPct||1)).toFixed(1),
    estRR3: '1:' + (estTP3Pct/(estRiskPct||1)).toFixed(1),
    isHot: isStrongSignal,
    rejectReason: !isStrongSignal ? 'Score ' + score + '/100 (min 58). ' + reasons.join(', ') : '',
  }
}];`;

// ══════════════════════════════════════════════════════
// BUILD WORKFLOW
// ══════════════════════════════════════════════════════
const workflow = {
  name: "Spike Hunter Pro v15 — Pro Crypto Futures Engine",
  nodes: [
    {
      id: "b1000001-0001-4000-b000-000000000001",
      name: "Webhook Trigger",
      type: "n8n-nodes-base.webhook",
      typeVersion: 1.1,
      position: [-1800, 800],
      webhookId: "crypto-signal",
      parameters: {
        httpMethod: "POST",
        path: "crypto-signal",
        responseMode: "onReceived",
        responseData: "allEntries",
        options: {}
      }
    },
    {
      id: "b1000001-0003-4000-b000-000000000003",
      name: "Get Klines 1h",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.1,
      position: [-1500, 800],
      parameters: {
        url: "https://fapi.binance.com/fapi/v1/klines",
        sendQuery: true,
        queryParameters: { parameters: [
          { name: "symbol", value: "={{ $json.body.symbol }}" },
          { name: "interval", value: "1h" },
          { name: "limit", value: "500" }
        ]},
        options: { response: { response: { responseFormat: "text" } } }
      }
    },
    {
      id: "b1000001-0004-4000-b000-000000000004",
      name: "Get Klines 4h",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.1,
      position: [-1250, 800],
      parameters: {
        url: "https://fapi.binance.com/fapi/v1/klines",
        sendQuery: true,
        queryParameters: { parameters: [
          { name: "symbol", value: "={{ $('Webhook Trigger').first().json.body.symbol }}" },
          { name: "interval", value: "4h" },
          { name: "limit", value: "200" }
        ]},
        options: { response: { response: { responseFormat: "text" } } }
      }
    },
    {
      id: "b1000001-0011-4000-b000-000000000011",
      name: "Get Klines 1D",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.1,
      position: [-1000, 800],
      parameters: {
        url: "https://fapi.binance.com/fapi/v1/klines",
        sendQuery: true,
        queryParameters: { parameters: [
          { name: "symbol", value: "={{ $('Webhook Trigger').first().json.body.symbol }}" },
          { name: "interval", value: "1d" },
          { name: "limit", value: "60" }
        ]},
        options: { response: { response: { responseFormat: "text" } } }
      }
    },
    {
      id: "b1000001-0012-4000-b000-000000000012",
      name: "Get Funding Rate",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.1,
      position: [-750, 800],
      parameters: {
        url: "https://fapi.binance.com/fapi/v1/premiumIndex",
        sendQuery: true,
        queryParameters: { parameters: [
          { name: "symbol", value: "={{ $('Webhook Trigger').first().json.body.symbol }}" }
        ]},
        options: {}
      }
    },
    {
      id: "b1000001-0006-4000-b000-000000000006",
      name: "Pro Analisa TA v15",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [-500, 800],
      parameters: { jsCode: v15Code }
    },
    {
      id: "b1000001-0007-4000-b000-000000000007",
      name: "Is Hot?",
      type: "n8n-nodes-base.if",
      typeVersion: 1,
      position: [-250, 800],
      parameters: {
        conditions: { boolean: [{ value1: "={{ $json.isHot }}", value2: true }] }
      }
    },
    {
      id: "b1000001-0008-4000-b000-000000000008",
      name: "Telegram Alert",
      type: "n8n-nodes-base.telegram",
      typeVersion: 1.2,
      position: [50, 620],
      credentials: { telegramApi: { id: "aNtvHk0oDffDwsLX", name: "Telegram account" } },
      parameters: {
        chatId: "@cryptospikehunter",
        text: `={{ $json.signal === 'STRONG BUY' ? '🟢' : '🔴' }} *{{ $json.symbol }} — {{ $json.signal }}*
🎯 Confidence: *{{ $json.confidence }}* (Score: {{ $json.score }}/100)

💰 *Entry:* \`{{ $json.price }}\`
📉 *WS Trigger:* {{ $json.wsDirection }} {{ $json.wsChange }}
📈 *Strategy:* {{ $json.strategy }}

*💵 Estimated Profit:*
├ 🥇 *TP1:* \`{{ $json.tp1 }}\` ({{ $json.estTP1 }}) — RR {{ $json.estRR1 }}
├ 🥈 *TP2:* \`{{ $json.tp2 }}\` ({{ $json.estTP2 }}) — RR {{ $json.estRR2 }}
├ 🥉 *TP3:* \`{{ $json.tp3 }}\` ({{ $json.estTP3 }}) — RR {{ $json.estRR3 }}
├ 🛡️ *SL:* \`{{ $json.sl }}\` ({{ $json.estRisk }} risk)
└ 📐 ATR: {{ $json.atr }} ({{ $json.atrPct }})

*Market Context:*
├ 🌍 Daily: {{ $json.dailyTrend }}
├ Trend 4H: {{ $json.trend4h }} (RSI: {{ $json.rsi4h }})
├ Trend 1H: {{ $json.trend1h }} (RSI: {{ $json.rsi1h }})
├ Structure: {{ $json.marketStructure }}
├ MACD: {{ $json.macdCross }}
├ RSI Div: {{ $json.rsiDivergence }}
├ Volume: {{ $json.volRatio }}
└ {{ $json.macroTrend }}

*⚡ Crypto Futures Signals:*
└ Funding Rate: {{ $json.fundingRate }}

*Support & Resistance:*
├ 🔺 Resistance: \`{{ $json.resistance }}\` ({{ $json.distResistance }})
└ 🔻 Support: \`{{ $json.support }}\` ({{ $json.distSupport }})

💡 _{{ $json.reasons }}_

📊 _v15 Pro Crypto Engine | Daily+4H+1H Confluence_
🔗 [Binance](https://www.binance.com/en/futures/{{ $json.symbol }}) | [TradingView](https://www.tradingview.com/chart/?symbol=BINANCE:{{ $json.symbol }}.P)
⏰ {{ $now.setZone('Asia/Jakarta').format('dd MMM HH:mm') }} WIB`,
        additionalFields: { parse_mode: "Markdown" }
      }
    },
    {
      id: "b1000001-0010-4000-b000-000000000010",
      name: "Ntfy Alert",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.1,
      position: [50, 900],
      parameters: {
        method: "POST",
        url: "https://ntfy.sh/cryptospike-bot-tetot",
        sendHeaders: true,
        headerParameters: { parameters: [
          { name: "Title", value: "={{ $json.signal === 'STRONG BUY' ? '🟢' : '🔴' }} {{ $json.symbol }} — {{ $json.signal }} ({{ $json.score }}/100) {{ $json.rsiDivergence !== 'None' ? '📡' : '' }}" },
          { name: "Tags", value: "={{ $json.signal === 'STRONG BUY' ? 'green_circle,chart_with_upwards_trend' : 'red_circle,chart_with_downwards_trend' }}" },
          { name: "Priority", value: "={{ $json.confidence === 'VERY HIGH' ? '5' : '4' }}" },
          { name: "Actions", value: "=view, Binance, https://www.binance.com/en/futures/{{ $json.symbol }}; view, TradingView, https://www.tradingview.com/chart/?symbol=BINANCE:{{ $json.symbol }}.P" }
        ]},
        sendBody: true,
        specifyBody: "string",
        body: `={{ $json.signal === "STRONG BUY" ? "🟢" : "🔴" }} {{ $json.symbol }} — {{ $json.signal }}
🎯 Confidence: {{ $json.confidence }} (Score: {{ $json.score }}/100)

💰 Entry: {{ $json.price }}
📉 WS: {{ $json.wsDirection }} {{ $json.wsChange }}
📈 Strategy: {{ $json.strategy }}

💵 Estimated Profit:
├ 🥇 TP1: {{ $json.tp1 }} ({{ $json.estTP1 }}) RR {{ $json.estRR1 }}
├ 🥈 TP2: {{ $json.tp2 }} ({{ $json.estTP2 }}) RR {{ $json.estRR2 }}
├ 🥉 TP3: {{ $json.tp3 }} ({{ $json.estTP3 }}) RR {{ $json.estRR3 }}
├ 🛡️ SL: {{ $json.sl }} ({{ $json.estRisk }})
└ 📐 ATR: {{ $json.atr }} ({{ $json.atrPct }})

Market Context:
├ 🌍 Daily: {{ $json.dailyTrend }}
├ 4H: {{ $json.trend4h }} | 1H: {{ $json.trend1h }}
├ RSI: {{ $json.rsi1h }} | Vol: {{ $json.volRatio }}
├ Structure: {{ $json.marketStructure }}
├ RSI Div: {{ $json.rsiDivergence }}
└ Funding Rate: {{ $json.fundingRate }}

Support & Resistance:
├ 🔺 Resistance: {{ $json.resistance }} ({{ $json.distResistance }})
└ 🔻 Support: {{ $json.support }} ({{ $json.distSupport }})

💡 {{ $json.reasons }}

📊 v15 Pro Crypto Engine
⏰ {{ $now.setZone("Asia/Jakarta").format("dd MMM HH:mm") }} WIB`,
        options: {}
      }
    },
    {
      id: "b1000001-0009-4000-b000-000000000009",
      name: "Telegram Log (Disabled)",
      type: "n8n-nodes-base.telegram",
      typeVersion: 1.2,
      position: [50, 1150],
      disabled: true,
      credentials: { telegramApi: { id: "aNtvHk0oDffDwsLX", name: "Telegram account" } },
      parameters: {
        chatId: "@cryptospikehunter",
        text: "=📋 *{{ $json.symbol }}* — SKIP ({{ $json.score }}/100)\n_{{ $json.rejectReason }}_",
        additionalFields: { parse_mode: "Markdown" }
      }
    }
  ],
  pinData: {},
  connections: {
    "Webhook Trigger": { main: [[{ node: "Get Klines 1h", type: "main", index: 0 }]] },
    "Get Klines 1h":   { main: [[{ node: "Get Klines 4h", type: "main", index: 0 }]] },
    "Get Klines 4h":   { main: [[{ node: "Get Klines 1D", type: "main", index: 0 }]] },
    "Get Klines 1D":   { main: [[{ node: "Get Funding Rate", type: "main", index: 0 }]] },
    "Get Funding Rate":{ main: [[{ node: "Pro Analisa TA v15", type: "main", index: 0 }]] },
    "Pro Analisa TA v15": { main: [[{ node: "Is Hot?", type: "main", index: 0 }]] },
    "Is Hot?": { main: [
      [{ node: "Telegram Alert", type: "main", index: 0 }, { node: "Ntfy Alert", type: "main", index: 0 }],
      [{ node: "Telegram Log (Disabled)", type: "main", index: 0 }]
    ]}
  },
  active: false,
  settings: { executionOrder: "v1" },
  meta: { templateCredsSetupCompleted: true },
  tags: []
};

fs.writeFileSync(path, JSON.stringify(workflow, null, 2));
console.log('✅ v15 workflow written');
console.log('Nodes:', workflow.nodes.map(n => n.name).join(' → '));
console.log('Total nodes:', workflow.nodes.length);
