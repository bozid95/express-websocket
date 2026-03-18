const fs = require('fs');
let d = JSON.parse(fs.readFileSync('n8n-workflow-hybrid-v16.0.json', 'utf8'));

let proNode = d.nodes.find(n => n.name.includes('Pro Analisa'));
let code = proNode.parameters.jsCode;

// ═══ 1. RAISE MINIMUM SCORES ═══

// TIER 1 SWING: Dip 58→70, Short 55→68, Breakout 60→72
code = code.replace("if(dipResult.score>=58) {", "if(dipResult.score>=70) {");
code = code.replace("if(score>=68){signal='STRONG BUY';strategy='LONG (Buy Dip)';confidence='VERY HIGH';}", 
                     "if(score>=85){signal='STRONG BUY';strategy='LONG (Buy Dip)';confidence='VERY HIGH';}");
code = code.replace("pumpResult.shortScore>=55", "pumpResult.shortScore>=68");
code = code.replace("pumpResult.breakoutScore>=60", "pumpResult.breakoutScore>=72");

// TIER 2 INTRADAY: All from 40→55
code = code.replace(/dipResult2\.score>=40/g, "dipResult2.score>=55");
code = code.replace(/pumpResult2\.shortScore>=40/g, "pumpResult2.shortScore>=55");
code = code.replace(/pumpResult2\.breakoutScore>=40/g, "pumpResult2.breakoutScore>=55");

// ═══ 2. TIGHTEN RSI GATES ═══
// SWING dip: RSI must be < 40 (was 45)
code = code.replace("_rsi<45 && ffCount<3", "_rsi<40 && ffCount<2");
// INTRADAY dip: RSI must be < 48 (was 55)
code = code.replace("_rsi<55 && ffCount<4", "_rsi<48 && ffCount<3");
// SWING short: RSI must be > 70 (was 65)
code = code.replace("var shortRsiMin = tier==='SWING' ? 65 : 55;", "var shortRsiMin = tier==='SWING' ? 70 : 60;");

// ═══ 3. REQUIRE VOLUME SPIKE ═══
// SWING: volume must be >= 1.8x (was 1.5x)
code = code.replace("volRatio>=1.5 && _ms!=='BEARISH'", "volRatio>=1.8 && _ms!=='BEARISH'");
// INTRADAY: volume must be >= 1.3x (was 1.0x)
code = code.replace("volRatio>=1.0 && atrPct>=0.2", "volRatio>=1.3 && atrPct>=0.25");

// ═══ 4. ADD MULTI-CONFIRMATION GATE ═══
// Signal must have at least 2 of 3 confirmations:
// 1) Futures confirmation (Funding OR OI OR Taker aligned)
// 2) Momentum confirmation (RSI extreme OR MACD cross OR RSI divergence)
// 3) Structure confirmation (Market Structure aligned OR near S/R)
const multiConfirmGate = `
// ═══ MULTI-CONFIRMATION GATE (Anti-False-Signal) ═══
if (isStrongSignal) {
  var confirmCount = 0;
  // Dimension 1: Futures confirmation
  var futuresOk = false;
  if (strategy.indexOf('LONG') !== -1) {
    futuresOk = (frPct < -0.03) || (takerBias === 'BUY_AGGRESSIVE') || (oiTrend === 'RISING' && wsPctChange < 0);
  } else {
    futuresOk = (frPct > 0.03) || (takerBias === 'SELL_AGGRESSIVE') || (oiTrend === 'FALLING' && wsPctChange > 0);
  }
  if (futuresOk) confirmCount++;

  // Dimension 2: Momentum confirmation
  var momentumOk = false;
  if (strategy.indexOf('LONG') !== -1) {
    momentumOk = (_rsi < 35) || (_macd.cu) || (_rsiDiv.bullish);
  } else {
    momentumOk = (_rsi > 72) || (_macd.cd) || (_rsiDiv.bearish);
  }
  if (momentumOk) confirmCount++;

  // Dimension 3: Structure confirmation
  var structureOk = false;
  if (strategy.indexOf('LONG') !== -1) {
    structureOk = (_ms === 'BULLISH' || _ms === 'TRANSITION_UP') || (lowerWick > 0 && range > 0 && lowerWick/range > 0.3);
  } else {
    structureOk = (_ms === 'BEARISH') || (upperWick > 0 && range > 0 && upperWick/range > 0.3);
  }
  if (structureOk) confirmCount++;

  if (confirmCount < 2) {
    return [{json:{
      isHot: false, symbol: symbol,
      rejectReason: 'Multi-Confirm FAIL: only ' + confirmCount + '/3 dimensions confirmed'
    }}];
  }
}
`;

// Insert before the final return
code = code.replace(
    "// ═══ SCANNER QUALITY GATE ═══",
    multiConfirmGate + "\n// ═══ SCANNER QUALITY GATE ═══"
);

// If no scanner gate exists yet, insert before the return
if (!code.includes('Multi-Confirm FAIL')) {
    code = code.replace(
        "\nreturn [{json:{",
        multiConfirmGate + "\nreturn [{json:{"
    );
}

proNode.parameters.jsCode = code;

fs.writeFileSync('n8n-workflow-hybrid-v16.0.json', JSON.stringify(d, null, 2));
console.log('v16.0 HARDENED successfully!');
console.log('Changes:');
console.log('  SWING min score: 58 -> 70 (dip), 55 -> 68 (short), 60 -> 72 (breakout)');
console.log('  INTRADAY min score: 40 -> 55');
console.log('  RSI gates: SWING <40 (was <45), INTRADAY <48 (was <55), Short >70 (was >65)');
console.log('  Volume gates: SWING >=1.8x (was 1.5x), INTRADAY >=1.3x (was 1.0x)');
console.log('  Multi-Confirmation: 2/3 dimensions required (Futures + Momentum + Structure)');
