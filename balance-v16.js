const fs = require('fs');
let d = JSON.parse(fs.readFileSync('n8n-workflow-hybrid-v16.0.json', 'utf8'));
let proNode = d.nodes.find(n => n.name.includes('Pro Analisa'));
let code = proNode.parameters.jsCode;

// ═══════════════════════════════════════════════════
// BALANCED MODE: Keep Multi-Confirm (best anti-false)
// but relax score & RSI gates to allow quality signals
// ═══════════════════════════════════════════════════

// 1. SWING Dip: 70 -> 60 (was originally 58)
code = code.replace("dipResult.score>=70", "dipResult.score>=60");

// 2. SWING Short: 72 -> 62 
code = code.replace("pumpResult.shortScore>=72", "pumpResult.shortScore>=62");

// 3. SWING Breakout: keep at 72 (breakouts need to be strict)

// 4. INTRADAY Dip: 62 -> 50
code = code.replace("dipResult2.score>=62", "dipResult2.score>=50");

// 5. INTRADAY Short: 65 -> 50
code = code.replace("pumpResult2.shortScore>=65", "pumpResult2.shortScore>=50");

// 6. INTRADAY Breakout: 65 -> 55
code = code.replace("pumpResult2.breakoutScore>=65", "pumpResult2.breakoutScore>=55");

// 7. RSI gate SWING: <40 -> <45 (give more room)
code = code.replace("_rsi<40 && ffCount<2", "_rsi<45 && ffCount<3");

// 8. RSI gate INTRADAY: <48 -> <50
code = code.replace("_rsi<48 && ffCount<3", "_rsi<50 && ffCount<3");

// 9. Volume SWING: 1.8x -> 1.5x
code = code.replace("volRatio>=1.8 && _ms!=='BEARISH'", "volRatio>=1.5 && _ms!=='BEARISH'");

// 10. Volume INTRADAY: 1.3x -> 1.1x
code = code.replace("volRatio>=1.3 && atrPct>=0.25", "volRatio>=1.1 && atrPct>=0.2");

// 11. Remove CONFIDENCE GATE (too aggressive, blocks valid scalps)
code = code.replace(/\/\/ ═══ CONFIDENCE GATE[\s\S]*?}\n}/m, '// confidence gate removed');

// 12. Dedup: 30min -> 15min (more reasonable)
code = code.replace("nowTs - lastEntry.ts < 1800000", "nowTs - lastEntry.ts < 900000");

// 13. Dedup score delta: 20 -> 15
code = code.replace("score-lastEntry.score<20", "score-lastEntry.score<15");

// KEEP: Multi-Confirmation Gate (2/3 dimensions) - this is the BEST anti-false filter

proNode.parameters.jsCode = code;
fs.writeFileSync('n8n-workflow-hybrid-v16.0.json', JSON.stringify(d, null, 2));

console.log('=== BALANCED MODE APPLIED ===');
console.log('SWING Dip: 70 -> 60 | Short: 72 -> 62');
console.log('INTRADAY Dip: 62 -> 50 | Short: 65 -> 50');
console.log('RSI: SWING <45 | INTRADAY <50');
console.log('Volume: SWING 1.5x | INTRADAY 1.1x');
console.log('Dedup: 15min window');
console.log('Confidence gate: REMOVED');
console.log('Multi-Confirm 2/3: KEPT (best anti-false filter)');
console.log('\nEstimate: 3-8 signals/day on volatile days');
