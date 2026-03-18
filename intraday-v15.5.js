const fs = require('fs');

const data = JSON.parse(fs.readFileSync('n8n-workflow-hybrid-v15.4.json', 'utf8'));
const codeNode = data.nodes.find(n => n.name.includes('Pro Analisa'));
let c = codeNode.parameters.jsCode;

// Update version string
c = c.replace(/v15\.4/g, 'v15.5');
c = c.replace(/v15\.3/g, 'v15.5');
c = c.replace(/v15\.2/g, 'v15.5');

// 1. Lower Required Score (Catch all intraday swings)
c = c.replace(/score>=48/g, 'score>=40');
c = c.replace(/score>=58/g, 'score>=50');
c = c.replace(/shortOk=shortGate&&shortScore>=48/g, 'shortOk=shortGate&&shortScore>=40');
c = c.replace(/breakOk=breakGate&&breakoutScore>=48/g, 'breakOk=breakGate&&breakoutScore>=40');

// 2. Increase RSI Sensitivity for Intraday Scalps
c = c.replace(/var shortGate=\(_rsi>=55\)&&/g, 'var shortGate=(_rsi>=55)&&'); // keep 55
// Let's modify the buy dip hard-gate entirely. It currently has `_rsi>=50` block?
// Previously it was _rsi>=45 hard block. Now we make it _rsi>=55 hard block for dip, meaning if RSI is below 55 it can be a dip.
c = c.replace(/_rsi>=50/g, '_rsi>=55'); 
c = c.replace(/isRed&&_rsi>=30/g, 'isRed&&_rsi>=40'); // allow buying a red candle if RSI < 40

// 3. Remove MACRO daily blocks explicitly
// Instead of penalizing daily trend, intraday doesn't care. Let's just remove the Daily Bearish reject.
c = c.replace(/if\(dailyBearish\)return\[\{json:\{isHot:false,symbol,rejectReason:'🚫 Daily '\+dailyTrend\}\}\];/g, '');

// 4. Tighten Stop Loss & Take Profit for Intraday (Faster exits)
// Change ATR multipliers from generic swings to intraday
// SL: ATR * 2 -> ATR * 1.5
// TP1: SL * 1.5 -> SL * 1.0 (1:1 RR)
// TP2: SL * 2.5 -> SL * 1.5 (1:1.5 RR)
// TP3: SL * 3.5 -> SL * 2.5 (1:2.5 RR)
c = c.replace(/sl=price-\(_atr\*2\);/g, 'sl=price-(_atr*1.5);');
c = c.replace(/sl=price\+\(_atr\*2\);/g, 'sl=price+(_atr*1.5);');
c = c.replace(/_atr\*2/g, '_atr*1.5');

c = c.replace(/tp1\=price\+Math\.max\(meanDist\*0\.4,slDist\*1\.5\);tp2\=price\+Math\.max\(meanDist\*0\.7,slDist\*2\.5\);tp3\=price\+Math\.max\(meanDist\*1\.0,slDist\*3\.5\);/g, 'tp1=price+Math.max(meanDist*0.3,slDist*1.0);tp2=price+Math.max(meanDist*0.5,slDist*1.5);tp3=price+Math.max(meanDist*0.8,slDist*2.5);');

c = c.replace(/tp1\=price-Math\.max\(meanDist\*0\.4,slDist\*1\.5\);tp2\=price-Math\.max\(meanDist\*0\.7,slDist\*2\.5\);tp3\=price-Math\.max\(meanDist\*1\.0,slDist\*3\.5\);/g, 'tp1=price-Math.max(meanDist*0.3,slDist*1.0);tp2=price-Math.max(meanDist*0.5,slDist*1.5);tp3=price-Math.max(meanDist*0.8,slDist*2.5);');


codeNode.parameters.jsCode = c;
codeNode.name = 'Pro Analisa TA v15.5';

fs.writeFileSync('n8n-workflow-hybrid-v15.5.json', JSON.stringify(data, null, 2));
console.log('Successfully generated v15.5 Intraday trading JSON');
