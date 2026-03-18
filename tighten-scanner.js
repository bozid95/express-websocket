const fs = require('fs');
let d = JSON.parse(fs.readFileSync('n8n-workflow-hybrid-v16.1-Scanner.json','utf8'));

// ═══ 1. RAISE VOLATILITY THRESHOLD ON SCANNER ═══
// Only scan coins with >= 5% movement (not 3.5%)
let filterNode = d.nodes.find(n => n.name === 'Filter Top Volatile');
filterNode.parameters.jsCode = filterNode.parameters.jsCode.replace(
    'const THRESHOLD = 3.5;',
    'const THRESHOLD = 5.0;'
);
// Reduce max coins to top 15 (not 30)
filterNode.parameters.jsCode = filterNode.parameters.jsCode.replace(
    'let scanList = candidates.slice(0, 30);',
    'let scanList = candidates.slice(0, 15);'
);
console.log('Filter: threshold 3.5% -> 5.0%, max coins 30 -> 15');

// ═══ 2. ADD SCANNER QUALITY GATE IN PRO ANALISA ═══
// For Scanner signals: only send if score >= 60 (not 40)
let proNode = d.nodes.find(n => n.name.includes('Pro Analisa'));
let code = proNode.parameters.jsCode;

// Add a quality gate right before the return statement
let qualityGate = `
// ═══ SCANNER QUALITY GATE ═══
// Scanner signals must have HIGHER score to pass (reduce noise)
if (webhookData.source === 'HOURLY_SCANNER' && isStrongSignal) {
  var scannerMinScore = signalType === 'PRIME_SWING' ? 65 : 60;
  if (score < scannerMinScore) {
    return [{json:{
      isHot: false, symbol: symbol,
      rejectReason: 'SCANNER quality gate: score ' + score + ' < min ' + scannerMinScore
    }}];
  }
}
`;

// Insert before the final return
code = code.replace(
    "return [{json:{",
    qualityGate + "\nreturn [{json:{"
);
proNode.parameters.jsCode = code;
console.log('Quality gate added: SWING >= 65, INTRADAY >= 60 for Scanner signals');

fs.writeFileSync('n8n-workflow-hybrid-v16.1-Scanner.json', JSON.stringify(d, null, 2));
console.log('\nDone! Scanner is now much more selective.');
