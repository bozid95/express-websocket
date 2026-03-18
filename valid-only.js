const fs = require('fs');
let d = JSON.parse(fs.readFileSync('n8n-workflow-hybrid-v17.0.json', 'utf8'));
let proNode = d.nodes.find(n => n.name.includes('v17'));
let code = proNode.parameters.jsCode;

// Raise minimum scores to only allow VALID (A) and HIGHLY VALID (A+)
// Trend-following: 55 -> 65
code = code.replace(/if \(score >= 55\) \{\n      signalType = 'MOMENTUM'/g, 
  "if (score >= 65) {\n      signalType = 'MOMENTUM'");

code = code.replace(/if \(score >= 55\) \{\n        signalType = 'BREAKOUT'/g,
  "if (score >= 65) {\n        signalType = 'BREAKOUT'");

// Counter-trend: 60 -> 70
code = code.replace(/if \(score >= 60\) \{\n        signalType = 'REVERSAL'/g,
  "if (score >= 70) {\n        signalType = 'REVERSAL'");

code = code.replace(/if \(score >= 60\) \{\n        signalType = 'DIP_CATCH'/g,
  "if (score >= 70) {\n        signalType = 'DIP_CATCH'");

proNode.parameters.jsCode = code;
fs.writeFileSync('n8n-workflow-hybrid-v17.0.json', JSON.stringify(d, null, 2));

console.log('VALID-ONLY filter applied!');
console.log('Trend-follow min: 55 -> 65 (skip MODERATE)');
console.log('Counter-trend min: 60 -> 70 (skip MODERATE)');
console.log('Only A and A+ signals will reach Telegram now.');
