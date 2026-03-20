const SUPA_URL = 'https://hgcsdpqceuhmpeksdhpj.supabase.co';
const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhnY3NkcHFjZXVobXBla3NkaHBqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4MzU0NTMsImV4cCI6MjA4OTQxMTQ1M30.Llo6V1m4qdzXq3b3cB54cp7iEVrhpQ9nipBFbpcaWFQ';

let allSignals = [];
let lastPrices = {};
let allDonations = [];
let priceWs = null;
let subscribedSymbols = '';

// Shared Utilities
function getTimeAgo(date) {
  if (!date) return '';
  const seconds = Math.floor((new Date() - new Date(date)) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

async function fetchData() {
  try {
    const res = await fetch(SUPA_URL + '/rest/v1/signals?select=*&order=sent_at.desc&limit=1000', { 
      headers: { apikey: SUPA_KEY, Authorization: 'Bearer ' + SUPA_KEY } 
    });
    if (!res.ok) throw new Error('Query error');
    const signals = await res.json();
    if (!Array.isArray(signals)) return;

    allSignals = signals;
    
    // Statistics Calculation
    const activeSignals = signals.filter(s => ['ACTIVE', 'TP1_HIT', 'TP2_HIT'].includes(s.status || 'ACTIVE'));
    const resolvedSignals = signals.filter(s => s.status && !['ACTIVE', '⌛ WAITING', 'EXPIRED'].includes(s.status));
    
    // Win Rate (Overall)
    const wins = resolvedSignals.filter(s => s.status.includes('TP') || (s.status === 'TSL_HIT' && parseFloat(s.profit_pct) > 0));
    const winRate = resolvedSignals.length > 0 ? ((wins.length / resolvedSignals.length) * 100).toFixed(0) : 0;
    
    // Win Rate (Last 24h)
    const now = new Date();
    const signals24h = resolvedSignals.filter(s => (now - new Date(s.sent_at)) < 86400000);
    const wins24h = signals24h.filter(s => s.status.includes('TP') || (s.status === 'TSL_HIT' && parseFloat(s.profit_pct) > 0));
    const winRate24h = signals24h.length > 0 ? ((wins24h.length / signals24h.length) * 100).toFixed(0) : 0;
    
    const totalPnl = resolvedSignals.reduce((acc, s) => acc + (parseFloat(s.profit_pct) || 0), 0);
    
    // Best Trade
    const bestTrade = resolvedSignals.reduce((max, s) => Math.max(max, parseFloat(s.profit_pct) || 0), 0);
    
    // Avg Weekly (Estimate based on oldest signal)
    let avgWeekly = totalPnl;
    if (resolvedSignals.length > 0) {
        const oldest = new Date(resolvedSignals[resolvedSignals.length-1].sent_at);
        const weeks = Math.max(1, (now - oldest) / (86400000 * 7));
        avgWeekly = totalPnl / weeks;
    }

    // Hero Cards
    const hpnl = document.getElementById('hpnl');
    if (hpnl) {
        hpnl.textContent = (totalPnl >= 0 ? '+' : '') + totalPnl.toFixed(2) + '%';
        hpnl.className = 'hero-pnl ' + (totalPnl >= 0 ? 'pos' : 'neg');
    }
    const heroBox = document.getElementById('heroBox');
    if (heroBox) heroBox.className = 'stat-box hero-box ' + (totalPnl >= 0 ? 'pos' : 'neg');
    
    const hwin = document.getElementById('hwin');
    if (hwin) hwin.textContent = `Closed: ${resolvedSignals.length} · Running: ${activeSignals.length}`;
    
    const hBest = document.getElementById('hBest');
    if (hBest) hBest.textContent = `+${bestTrade.toFixed(2)}%`;
    
    const hWeekly = document.getElementById('hWeekly');
    if (hWeekly) hWeekly.textContent = `${avgWeekly >= 0 ? '+' : ''}${avgWeekly.toFixed(2)}%`;

    // Win Rate Card
    const macc = document.getElementById('macc');
    if (macc) macc.textContent = winRate + '%';
    
    const macc24 = document.getElementById('macc24h');
    if (macc24) {
        macc24.textContent = `24H: ${winRate24h}%`;
        macc24.style.background = winRate24h >= 50 ? 'rgba(14, 203, 129, 0.1)' : 'rgba(246, 70, 93, 0.1)';
        macc24.style.color = winRate24h >= 50 ? 'var(--buy)' : 'var(--sell)';
    }
    
    const mbar = document.getElementById('accMiniBar');
    if (mbar) mbar.style.width = winRate + '%';
    
    // System Signals Card
    const mTotal = document.getElementById('mactiveTotal');
    if (mTotal) mTotal.textContent = signals.length;
    
    const mside = document.getElementById('msideBreakdown');
    if (mside) {
        const longs = signals.filter(s => (s.signal || '').includes('BUY')).length;
        const shorts = signals.length - longs;
        const high = signals.filter(s => (parseFloat(s.score) || 0) >= 85).length;
        mside.innerHTML = `<span style="color: var(--buy);">${longs} L</span> · <span style="color: var(--sell);">${shorts} S</span> · <span style="color: var(--text);">${high} High Score</span>`;
    }

    if (typeof updateRunningStats === 'function') updateRunningStats();

    // Trigger tab-specific renders if they exist
    if (typeof renderSignals === 'function') renderSignals();
    if (typeof renderInsightTables === 'function') renderInsightTables();

  } catch (e) { console.error("Fetch data error:", e); }
}

function connectPriceWs() {
  const activeSignals = allSignals.filter(s => ['ACTIVE', 'TP1_HIT', 'TP2_HIT'].includes(s.status || 'ACTIVE'));
  const activeSymbols = activeSignals.map(s => s.symbol || '');
  const rows = document.querySelectorAll('.price-now-row[data-symbol]');
  const visibleSymbols = [...rows].map(r => r.dataset.symbol);
  const combined = [...activeSymbols, ...visibleSymbols].filter(Boolean);
  const symbols = [...new Set(combined)];

  if (symbols.length === 0) return;

  const symKey = symbols.sort().join(',');
  if (symKey === subscribedSymbols && priceWs && priceWs.readyState === WebSocket.OPEN) return;
  subscribedSymbols = symKey;

  if (priceWs) { try { priceWs.close(); } catch(_){} priceWs = null; }

  const streams = symbols.map(s => s.toLowerCase() + '@miniTicker').join('/');
  const wsUrl = `wss://fstream.binance.com/stream?streams=${streams}`;

  console.log(`[PriceWS] Connecting for ${symbols.length} symbols...`);
  priceWs = new WebSocket(wsUrl);

  priceWs.onmessage = (evt) => {
    try {
      const msg = JSON.parse(evt.data);
      if (msg.data && msg.data.s && msg.data.c) {
        const sym = msg.data.s;
        const price = parseFloat(msg.data.c);
        if (!isNaN(price) && typeof updatePriceUI === 'function') updatePriceUI(sym, price);
      }
    } catch(_) {}
  };

  priceWs.onclose = () => {
    console.log('[PriceWS] Disconnected. Reconnecting in 5s...');
    setTimeout(connectPriceWs, 5000);
  };
}

function updatePriceUI(sym, price) {
  document.querySelectorAll(`.price-now-row[data-symbol="${sym}"]`).forEach(row => {
    const valEl = row.querySelector('.price-now-val');
    if (valEl) {
      const prec = price < 1 ? 6 : price < 100 ? 4 : 2;
      valEl.textContent = price.toFixed(prec);
    }
    
    if (lastPrices[sym] !== undefined && lastPrices[sym] !== price) {
      const dir = price > lastPrices[sym] ? 'up' : 'down';
      if (valEl) { valEl.style.color = dir === 'up' ? 'var(--buy)' : 'var(--sell)'; }
      row.classList.remove('price-flash-up', 'price-flash-down');
      void row.offsetWidth;
      row.classList.add(dir === 'up' ? 'price-flash-up' : 'price-flash-down');
    }

    const pnlEl = row.querySelector('.price-now-pnl');
    if (pnlEl) {
      const entry = parseFloat(row.dataset.entry);
      const side = row.dataset.side;
      if (entry > 0) {
        let pnl = ((price - entry) / entry) * 100;
        if (side === 'SHORT') pnl = -pnl;
        const arrow = pnl >= 0 ? '▲' : '▼';
        pnlEl.textContent = `${arrow} ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}%`;
        pnlEl.className = 'price-now-pnl ' + (pnl >= 0 ? 'pos' : 'neg');
      }
    }
  });

  document.querySelectorAll(`.price-now-pnl[data-symbol="${sym}"]`).forEach(el => {
    const entry = parseFloat(el.dataset.entry);
    const side = el.dataset.side;
    if (entry > 0) {
      let pnl = ((price - entry) / entry) * 100;
      if (side === 'SHORT') pnl = -pnl;
      const arrow = pnl >= 0 ? '▲' : '▼';
      el.textContent = `${arrow} ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}%`;
      el.className = 'price-now-pnl ' + (pnl >= 0 ? 'pos' : 'neg');
    }
  });
  
  lastPrices[sym] = price;
  if (typeof updateRunningStats === 'function') updateRunningStats();
}

function switchTab(id, el) {
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  document.querySelectorAll('.nav-btn, .side-link').forEach(n => n.classList.remove('active'));
  document.getElementById('tab-' + id).classList.add('active');
  
  const tabs = document.querySelectorAll(`.nav-btn[onclick*="'${id}'"], .side-link[onclick*="'${id}'"]`);
  tabs.forEach(t => t.classList.add('active'));

  localStorage.setItem('activeCryptoTab', id);
}

// Global initialization
window.addEventListener('DOMContentLoaded', () => {
    const savedTab = localStorage.getItem('activeCryptoTab');
    if (savedTab) {
      const tabEl = document.querySelector(`.nav-btn[onclick*="'${savedTab}'"]`);
      if (tabEl) switchTab(savedTab, tabEl);
    }
    
    fetchData();
    if (typeof fetchDonations === 'function') fetchDonations();
    
    setInterval(fetchData, 45000);
    if (typeof fetchDonations === 'function') setInterval(fetchDonations, 60000);
    if (typeof renderSignals === 'function') setInterval(renderSignals, 60000);
    
    setTimeout(connectPriceWs, 3000);
});
