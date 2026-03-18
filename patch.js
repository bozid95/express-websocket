const fs = require('fs');

const data = JSON.parse(fs.readFileSync('n8n-workflow-hybrid-v15.4.json', 'utf8'));
const codeNode = data.nodes.find(n => n.name.includes('Pro Analisa'));
let c = codeNode.parameters.jsCode;

c = c.replace(/volBreakRatio>1\.5/g, 'volBreakRatio>1.1');
c = c.replace(/breakOk=breakGate&&breakoutScore>=60/ig, 'breakOk=breakGate&&breakoutScore>=48');
c = c.replace(/shortOk=shortGate&&shortScore>=55/ig, 'shortOk=shortGate&&shortScore>=48');
c = c.replace(/var shortGate=\(_rsi>=65\)&&/g, 'var shortGate=(_rsi>=55)&&');
c = c.replace(/\(!dailyBullish\)&&/g, ''); 
c = c.replace(/score>=58/g, 'score>=48');
c = c.replace(/score>=68/g, 'score>=58');

codeNode.parameters.jsCode = c;

fs.writeFileSync('n8n-workflow-hybrid-v15.4.json', JSON.stringify(data, null, 2));
console.log('Successfully patched all hard blockers in JSON');
