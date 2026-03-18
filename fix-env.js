const fs = require('fs');

// Placeholder values - user will replace in N8N UI
const SUPA_URL = 'https://YOUR_PROJECT.supabase.co';
const SUPA_KEY = 'YOUR_SUPABASE_ANON_KEY';

// ═══ Fix v17.0 ═══
let wf = JSON.parse(fs.readFileSync('n8n-workflow-hybrid-v17.0.json', 'utf8'));
let json = JSON.stringify(wf);
json = json.replace(/\{\{ \$env\.SUPABASE_URL \}\}/g, SUPA_URL);
json = json.replace(/\{\{ \$env\.SUPABASE_KEY \}\}/g, SUPA_KEY);
// Also handle the ={{ $env... }} format
json = json.replace(/=\{\{ \$env\.SUPABASE_URL[^}]*\}\}/g, SUPA_URL);
json = json.replace(/=\{\{ \$env\.SUPABASE_KEY \}\}/g, SUPA_KEY);
json = json.replace(/=Bearer \{\{ \$env\.SUPABASE_KEY \}\}/g, 'Bearer ' + SUPA_KEY);
wf = JSON.parse(json);

// Fix the Supabase node to use direct values (not expressions)
wf.nodes.forEach(n => {
  if (n.name === 'Save to Supabase') {
    n.parameters.url = SUPA_URL + '/rest/v1/signals';
    n.parameters.headerParameters.parameters = [
      { name: 'apikey', value: SUPA_KEY },
      { name: 'Authorization', value: 'Bearer ' + SUPA_KEY },
      { name: 'Content-Type', value: 'application/json' },
      { name: 'Prefer', value: 'return=minimal' }
    ];
  }
});

fs.writeFileSync('n8n-workflow-hybrid-v17.0.json', JSON.stringify(wf, null, 2));
console.log('v17.0 fixed - direct URLs (no $env)');

// ═══ Fix Tracker ═══
let tr = JSON.parse(fs.readFileSync('n8n-signal-tracker.json', 'utf8'));
tr.nodes.forEach(n => {
  if (n.parameters && n.parameters.headerParameters) {
    n.parameters.headerParameters.parameters.forEach(p => {
      if (p.value && p.value.includes('$env.SUPABASE_KEY')) p.value = SUPA_KEY;
      if (p.value && p.value.includes('Bearer')) p.value = 'Bearer ' + SUPA_KEY;
    });
  }
  // Fix URLs
  if (n.name === 'Get Active Signals') {
    n.parameters.url = SUPA_URL + "/rest/v1/signals?status=eq.ACTIVE&select=*";
    n.parameters.headerParameters.parameters = [
      { name: 'apikey', value: SUPA_KEY },
      { name: 'Authorization', value: 'Bearer ' + SUPA_KEY }
    ];
  }
  if (n.name === 'Update Supabase') {
    n.parameters.url = "={{ '" + SUPA_URL + "/rest/v1/signals?id=eq.' + $json.id }}";
    n.parameters.headerParameters.parameters = [
      { name: 'apikey', value: SUPA_KEY },
      { name: 'Authorization', value: 'Bearer ' + SUPA_KEY },
      { name: 'Content-Type', value: 'application/json' },
      { name: 'Prefer', value: 'return=minimal' }
    ];
  }
  if (n.name === 'Get Daily Stats') {
    n.parameters.url = "={{ '" + SUPA_URL + "/rest/v1/daily_stats?trade_date=eq.' + $now.setZone('Asia/Jakarta').toFormat('yyyy-MM-dd') + '&select=*' }}";
    n.parameters.headerParameters.parameters = [
      { name: 'apikey', value: SUPA_KEY },
      { name: 'Authorization', value: 'Bearer ' + SUPA_KEY }
    ];
  }
});

fs.writeFileSync('n8n-signal-tracker.json', JSON.stringify(tr, null, 2));
console.log('Tracker fixed - direct URLs (no $env)');
console.log('\nIMPORTANT: Replace these in N8N after import:');
console.log('  URL:  ' + SUPA_URL);
console.log('  KEY:  ' + SUPA_KEY);
