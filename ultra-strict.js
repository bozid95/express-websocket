const fs = require('fs');
let d = JSON.parse(fs.readFileSync('n8n-workflow-hybrid-v16.0.json', 'utf8'));
let proNode = d.nodes.find(n => n.name.includes('Pro Analisa'));
let code = proNode.parameters.jsCode;

// ═══ ULTRA-STRICT MODE ═══

// 1. INTRADAY Short/Breakout: raise from 55 to 65
code = code.replace("pumpResult2.shortScore>=55", "pumpResult2.shortScore>=65");
code = code.replace("pumpResult2.breakoutScore>=55", "pumpResult2.breakoutScore>=65");

// 2. INTRADAY Dip: raise from 55 to 62
code = code.replace("dipResult2.score>=55", "dipResult2.score>=62");

// 3. SWING Short: raise from 68 to 72
code = code.replace("pumpResult.shortScore>=68", "pumpResult.shortScore>=72");

// 4. Confidence labels - only send if MEDIUM or above (skip LOW-MEDIUM)
// Add a final gate that blocks LOW confidence signals
let finalGate = `
// ═══ CONFIDENCE GATE ═══
// Only notify for MEDIUM confidence and above
if (isStrongSignal && (confidence === 'LOW-MEDIUM' || confidence === 'LOW')) {
  return [{json:{
    isHot: false, symbol: symbol,
    rejectReason: 'Confidence too low: ' + confidence + ' (score: ' + score + ')'
  }}];
}
`;

// Insert confidence gate before Multi-Confirm gate
if (!code.includes('CONFIDENCE GATE')) {
    code = code.replace(
        "// ═══ MULTI-CONFIRMATION GATE",
        finalGate + "\n// ═══ MULTI-CONFIRMATION GATE"
    );
}

// 5. Increase dedup window from 10 min to 30 min
code = code.replace("nowTs - lastEntry.ts < 600000", "nowTs - lastEntry.ts < 1800000");

// 6. Increase dedup score delta from 12 to 20
code = code.replace("score-lastEntry.score<12", "score-lastEntry.score<20");

proNode.parameters.jsCode = code;
fs.writeFileSync('n8n-workflow-hybrid-v16.0.json', JSON.stringify(d, null, 2));

console.log('=== ULTRA-STRICT MODE APPLIED ===');
console.log('INTRADAY Short/Break: 55 -> 65');
console.log('INTRADAY Dip: 55 -> 62');
console.log('SWING Short: 68 -> 72');
console.log('Confidence gate: blocks LOW-MEDIUM & LOW');
console.log('Dedup window: 10min -> 30min');
console.log('Dedup score delta: 12 -> 20');
