const fs = require("fs");

const files = [
  "n8n-workflow-hybrid.json",
  "n8n-workflow-hybrid-v17.0.json",
  "n8n-workflow-hybrid-v16.1-Scanner.json",
  "n8n-workflow-hybrid-v16.0.json"
];

const targetPattern = "var estRiskPct=parseFloat(riskPct)||0;";
const replacement = `var estRiskPct=parseFloat(riskPct)||0;

// ═══ HARD CAP MAXIMUM SL (10%) ═══
if (estRiskPct > 10.0) {
  var maxRisk = 10.0;
  if (strategy.indexOf('LONG') !== -1) {
    sl = price * (1 - (maxRisk / 100));
  } else {
    sl = price * (1 + (maxRisk / 100));
  }
  estRiskPct = maxRisk;
  riskPct = maxRisk.toFixed(2);
}`;

files.forEach(file => {
  const filepath = './' + file;
  try {
    const data = JSON.parse(fs.readFileSync(filepath, "utf8"));
    let updated = false;
    data.nodes.forEach(node => {
      if (node.parameters && node.parameters.jsCode) {
        const targetRegex = /var estRiskPct\s*=\s*parseFloat\(riskPct\)\s*\|\|\s*0;/;
        if (targetRegex.test(node.parameters.jsCode) && !node.parameters.jsCode.includes("HARD CAP MAXIMUM SL")) {
          node.parameters.jsCode = node.parameters.jsCode.replace(targetRegex, replacement);
          updated = true;
        }
      }
    });
    if (updated) {
      fs.writeFileSync(filepath, JSON.stringify(data, null, 2), "utf8");
      console.log('Updated ' + file);
    } else {
      console.log('No change needed in ' + file);
    }
  } catch (err) {
    console.error('Failed to process ' + file + ': ' + err.message);
  }
});
