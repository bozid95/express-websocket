const fs = require('fs');
let d = JSON.parse(fs.readFileSync('n8n-workflow-hybrid-v16.0.json', 'utf8'));
let proNode = d.nodes.find(n => n.name.includes('Pro Analisa'));
let code = proNode.parameters.jsCode;

// ═══════════════════════════════════════════════════════════
// ADAPTIVE SMART FILTER
// Core idea: Instead of FIXED score thresholds,
// the minimum score ADAPTS based on how many dimensions confirm
//
// 3/3 dimensions confirmed → lower score needed (peka/sensitive)
// 2/3 dimensions confirmed → higher score needed (selektif)
// 1/3 or 0/3                → BLOCKED (invalid)
//
// This achieves BOTH selectivity AND sensitivity simultaneously
// ═══════════════════════════════════════════════════════════

// Replace the old Multi-Confirmation Gate with Adaptive version
let oldGate = code.match(/\/\/ ═══ MULTI-CONFIRMATION GATE[\s\S]*?}\n}/m);
if (oldGate) {
    code = code.replace(oldGate[0], `// ═══ ADAPTIVE SMART FILTER (Selective + Sensitive) ═══
if (isStrongSignal) {
  var confirmCount = 0;
  
  // Dimension 1: Futures confirmation
  var futuresOk = false;
  if (strategy.indexOf('LONG') !== -1) {
    futuresOk = (frPct < -0.03) || (takerBias === 'BUY_AGGRESSIVE') || (oiTrend === 'RISING' && wsPctChange < 0) || (lsRatio > 2.0);
  } else {
    futuresOk = (frPct > 0.03) || (takerBias === 'SELL_AGGRESSIVE') || (oiTrend === 'FALLING' && wsPctChange > 0) || (lsRatio > 2.0);
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

  // ADAPTIVE THRESHOLD based on confirmation count
  var adaptiveMin = 999; // default: block
  if (confirmCount >= 3) {
    // ALL 3 dimensions agree = HIGHLY VALID, lower threshold (peka)
    adaptiveMin = signalType === 'PRIME_SWING' ? 50 : 42;
  } else if (confirmCount >= 2) {
    // 2/3 = VALID but needs higher score (selektif)
    adaptiveMin = signalType === 'PRIME_SWING' ? 62 : 55;
  } else {
    // 0-1/3 = BLOCKED
    return [{json:{
      isHot: false, symbol: symbol,
      rejectReason: 'SmartFilter: only ' + confirmCount + '/3 confirmed (need 2+)'
    }}];
  }

  if (score < adaptiveMin) {
    return [{json:{
      isHot: false, symbol: symbol,
      rejectReason: 'SmartFilter: score ' + score + ' < adaptive min ' + adaptiveMin + ' (' + confirmCount + '/3 confirmed)'
    }}];
  }

  // Upgrade confidence label if 3/3 confirmed
  if (confirmCount >= 3 && confidence !== 'VERY HIGH') {
    confidence = 'HIGH';
    reasons.push('3/3 CONFIRMED');
  }
}`);
}

proNode.parameters.jsCode = code;
fs.writeFileSync('n8n-workflow-hybrid-v16.0.json', JSON.stringify(d, null, 2));

console.log('=== ADAPTIVE SMART FILTER APPLIED ===');
console.log('3/3 confirmed → SWING min 50 | INTRADAY min 42 (SENSITIVE)');
console.log('2/3 confirmed → SWING min 62 | INTRADAY min 55 (SELECTIVE)');
console.log('0-1/3 confirmed → BLOCKED');
console.log('Result: Peka ketika bukti kuat, Selektif ketika bukti lemah');
