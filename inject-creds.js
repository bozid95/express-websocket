const fs = require('fs');

const SUPA_URL = 'https://hgcsdpqceuhmpeksdhpj.supabase.co';
const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhnY3NkcHFjZXVobXBla3NkaHBqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4MzU0NTMsImV4cCI6MjA4OTQxMTQ1M30.Llo6V1m4qdzXq3b3cB54cp7iEVrhpQ9nipBFbpcaWFQ';

// Fix v17.0
let wf = JSON.parse(fs.readFileSync('n8n-workflow-hybrid-v17.0.json', 'utf8'));
let json = JSON.stringify(wf);
json = json.replace(/https:\/\/YOUR_PROJECT\.supabase\.co/g, SUPA_URL);
json = json.replace(/YOUR_SUPABASE_ANON_KEY/g, SUPA_KEY);
fs.writeFileSync('n8n-workflow-hybrid-v17.0.json', json);
console.log('v17.0: Supabase credentials injected');

// Fix tracker
let tr = JSON.parse(fs.readFileSync('n8n-signal-tracker.json', 'utf8'));
let json2 = JSON.stringify(tr);
json2 = json2.replace(/https:\/\/YOUR_PROJECT\.supabase\.co/g, SUPA_URL);
json2 = json2.replace(/YOUR_SUPABASE_ANON_KEY/g, SUPA_KEY);
fs.writeFileSync('n8n-signal-tracker.json', json2);
console.log('Tracker: Supabase credentials injected');
console.log('Done! Both files ready to import.');
