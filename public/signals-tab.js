let currentPage = 1;
const PAGE_SIZE = 10;
let filterStatus = 'all';
let filterSide = 'all';
let filterSort = 'newest';
let filterSearch = '';

function toggleFilterPanel() {
  const panel = document.getElementById('filterOptionsPanel');
  const btn = document.getElementById('btnToggleFilters');
  if(!panel || !btn) return;
  const isVisible = panel.style.display === 'flex';
  panel.style.display = isVisible ? 'none' : 'flex';
  btn.classList.toggle('active', !isVisible);
}

function resetFilters() {
  filterStatus = 'all';
  filterSide = 'all';
  filterSort = 'newest';
  filterSearch = '';
  
  const fs = document.getElementById('filterSearch'); if(fs) fs.value = '';
  document.querySelectorAll('.seg-btn').forEach(c => c.classList.remove('active'));
  document.querySelectorAll('[data-val="all"], [data-val="newest"]').forEach(c => c.classList.add('active'));
  
  updateResetBtn();
  currentPage = 1;
  renderSignals();
}

function updateResetBtn() {
  const isFiltered = filterStatus !== 'all' || filterSide !== 'all' || filterSort !== 'newest' || filterSearch !== '';
  const btn = document.getElementById('btnResetFilters');
  if(btn) btn.style.display = isFiltered ? 'block' : 'none';
}

function changePage(dir) {
  currentPage += dir;
  renderSignals();
  const tab = document.getElementById('tab-signals');
  if(tab) tab.scrollIntoView({ behavior: 'smooth' });
}

function getFilteredSignals() {
  const filtered = allSignals.filter(s => {
    const status = s.status || 'ACTIVE';
    const isActiveOrPartial = ['ACTIVE', 'TP1_HIT', 'TP2_HIT'].includes(status);
    const side = (s.signal === 'STRONG BUY' || (s.signal||'').includes('BUY')) ? 'long' : 'short';

    if (filterStatus === 'active' && !isActiveOrPartial) return false;
    if (filterStatus === 'tp' && !status.includes('TP')) return false;
    if (filterStatus === 'tsl' && status !== 'TSL_HIT') return false;
    if (filterStatus === 'sl' && status !== 'SL_HIT') return false;

    if (filterSide !== 'all' && side !== filterSide) return false;

    if (filterSearch && !(s.symbol || '').toUpperCase().includes(filterSearch)) return false;

    return true;
  });

  if (filterSort === 'score') {
    filtered.sort((a, b) => (parseInt(b.score) || 0) - (parseInt(a.score) || 0));
  } else if (filterSort === 'profit') {
    filtered.sort((a, b) => (parseFloat(b.profit_pct) || 0) - (parseFloat(a.profit_pct) || 0));
  } else if (filterSort === 'symbol') {
    filtered.sort((a, b) => (a.symbol || '').localeCompare(b.symbol || ''));
  } else {
    filtered.sort((a, b) => new Date(b.sent_at) - new Date(a.sent_at));
  }

  return filtered;
}

function renderSignals() {
  const container = document.getElementById('signalContainer');
  if(!container) return;

  const filtered = getFilteredSignals();
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  if (currentPage > totalPages) currentPage = totalPages;
  if (currentPage < 1) currentPage = 1;

  const start = (currentPage - 1) * PAGE_SIZE;
  const pageItems = filtered.slice(start, start + PAGE_SIZE);

  const sc = document.getElementById('signalCount');
  if(sc) sc.textContent = `Showing ${pageItems.length} of ${filtered.length} signals`;

  if (pageItems.length === 0) {
    container.innerHTML = '<div style="text-align:center; padding:60px 20px; color:var(--text-dim); font-size: 13px;">No signals found</div>';
  } else {
    container.innerHTML = pageItems.map(s => renderCard(s)).join('');
  }

  const pag = document.getElementById('pagination');
  if(pag) {
      pag.style.display = totalPages > 1 ? 'flex' : 'none';
      const pi = document.getElementById('pageInfo'); if(pi) pi.textContent = `${currentPage} / ${totalPages}`;
      const pp = document.getElementById('prevPage'); if(pp) pp.disabled = currentPage <= 1;
      const np = document.getElementById('nextPage'); if(np) np.disabled = currentPage >= totalPages;
  }

  if (typeof connectPriceWs === 'function') connectPriceWs();
}

function renderCard(s) {
  const side = (s.signal === 'STRONG BUY' || (s.signal||'').includes('BUY')) ? 'LONG' : 'SHORT';
  const pnl = parseFloat(s.profit_pct || 0);
  const pastDate = new Date(s.sent_at || s.created_at);
  const time = pastDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  const date = pastDate.toLocaleDateString('en-US', { day: '2-digit', month: 'short' });
  const timeAgo = getTimeAgo(pastDate);

  const status = s.status || 'ACTIVE';
  const isActiveOrPartial = ['ACTIVE', 'TP1_HIT', 'TP2_HIT'].includes(status);
  const isTP1 = status.includes('TP1') || status.includes('TP2') || status.includes('TP3');
  const isTP2 = status.includes('TP2') || status.includes('TP3');
  const isTP3 = status.includes('TP3');
  const isSL = status === 'SL_HIT';

  let statusDisplay = '⌛ WAITING';
  if (status === 'TP1_HIT') statusDisplay = '🔄 TP1 (Running)';
  else if (status === 'TP2_HIT') statusDisplay = '🔄 TP2 (Running)';
  else if (status === 'TP3_HIT') statusDisplay = '🏆 TP3 (Closed)';
  else if (status === 'SL_HIT') statusDisplay = '❌ SL HIT';
  else if (status === 'TSL_HIT') statusDisplay = '🛡️ TSL HIT';
  else if (status === 'EXPIRED') statusDisplay = '⌛ EXPIRED';

  return `
    <div class="signal-card">
      <div class="card-head">
        <span class="pair-name">${s.symbol}</span>
        <span class="time-stamp">${date} • ${time} <span style="color:var(--accent); font-weight:600;">(${timeAgo})</span></span>
      </div>
      <div class="data-row" style="margin-bottom: 8px;">
        <div class="data-cell"><span class="label">Entry</span><span class="val">${parseFloat(s.entry_price || 0).toFixed(4)}</span></div>
        <div class="data-cell"><span class="label">Score</span><span class="val">${s.score || 0}</span></div>
        <div class="data-cell" style="text-align:right"><span class="label">Side</span><span class="val ${side === 'LONG' ? 'pos' : 'neg'}">${side}</span></div>
      </div>
      <div class="price-now-row" data-symbol="${s.symbol}" data-entry="${parseFloat(s.entry_price || 0)}" data-side="${side}">
        <div>
          <div class="price-now-label">💰 Current Price</div>
          <div class="price-now-val">—</div>
        </div>
        <div style="text-align:right">
          <div class="price-now-label">P&L from Entry</div>
          <div class="price-now-pnl">—</div>
        </div>
      </div>
      <div class="target-row">
        <div class="target-item ${isSL ? 'hit-sl' : ''}">
          <span class="target-label">SL ${isSL ? '❌' : '🛡️'}</span>
          <span class="target-val">${parseFloat(s.sl || 0).toFixed(4)}</span>
          <span style="font-size:9px; color:var(--sell);">${(() => { const e=parseFloat(s.entry_price)||0; const v=parseFloat(s.sl)||0; if(!e) return ''; const pct = side==='LONG' ? (v-e)/e*100 : (e-v)/e*100; return (pct>=0?'+':'')+pct.toFixed(1)+'%'; })()}</span>
        </div>
        <div class="target-item ${isTP1 || isTP2 || isTP3 ? 'hit-tp' : ''}">
          <span class="target-label">TP1 ${isTP1 || isTP2 || isTP3 ? '✅' : '⏳'}</span>
          <span class="target-val">${parseFloat(s.tp1 || 0).toFixed(4)}</span>
          <span style="font-size:9px; color:var(--buy);">${(() => { const e=parseFloat(s.entry_price)||0; const v=parseFloat(s.tp1)||0; if(!e) return ''; const pct = side==='LONG' ? (v-e)/e*100 : (e-v)/e*100; return (pct>=0?'+':'')+pct.toFixed(1)+'%'; })()}</span>
        </div>
        <div class="target-item ${isTP2 || isTP3 ? 'hit-tp' : ''}">
          <span class="target-label">TP2 ${isTP2 || isTP3 ? '✅' : '⏳'}</span>
          <span class="target-val">${parseFloat(s.tp2 || 0).toFixed(4)}</span>
          <span style="font-size:9px; color:var(--buy);">${(() => { const e=parseFloat(s.entry_price)||0; const v=parseFloat(s.tp2)||0; if(!e) return ''; const pct = side==='LONG' ? (v-e)/e*100 : (e-v)/e*100; return (pct>=0?'+':'')+pct.toFixed(1)+'%'; })()}</span>
        </div>
        <div class="target-item ${isTP3 ? 'hit-tp' : ''}">
          <span class="target-label">TP3 ${isTP3 ? '🏆' : '⏳'}</span>
          <span class="target-val">${parseFloat(s.tp3 || 0).toFixed(4)}</span>
          <span style="font-size:9px; color:var(--buy);">${(() => { const e=parseFloat(s.entry_price)||0; const v=parseFloat(s.tp3)||0; if(!e) return ''; const pct = side==='LONG' ? (v-e)/e*100 : (e-v)/e*100; return (pct>=0?'+':'')+pct.toFixed(1)+'%'; })()}</span>
        </div>
      </div>
      <div class="card-foot">
        <div style="display:flex; gap:8px; align-items:center;">
          <span class="side-tag ${side === 'LONG' ? 'side-buy' : 'side-sell'}">${side}</span>
          <span class="status-tag ${status !== 'ACTIVE' ? 'status-hit' : ''}">${statusDisplay}</span>
        </div>
        <div class="res-val ${pnl >= 0 ? 'pos' : 'neg'}">
          ${isActiveOrPartial ? '—' : (pnl >= 0 ? '+' : '') + pnl.toFixed(1) + '%'}
        </div>
      </div>
    </div>
  `;
}

// Event Listeners for Filters
window.addEventListener('DOMContentLoaded', () => {
    const fs = document.getElementById('filterStatus');
    if(fs) {
        fs.addEventListener('click', e => {
          const chip = e.target.closest('.seg-btn');
          if (!chip) return;
          document.querySelectorAll('#filterStatus .seg-btn').forEach(c => c.classList.remove('active'));
          chip.classList.add('active');
          filterStatus = chip.dataset.val;
          currentPage = 1;
          updateResetBtn();
          renderSignals();
        });
    }

    const fside = document.getElementById('filterSide');
    if(fside) {
        fside.addEventListener('click', e => {
          const chip = e.target.closest('.seg-btn');
          if (!chip) return;
          document.querySelectorAll('#filterSide .seg-btn').forEach(c => c.classList.remove('active'));
          chip.classList.add('active');
          filterSide = chip.dataset.val;
          currentPage = 1;
          updateResetBtn();
          renderSignals();
        });
    }

    const fsort = document.getElementById('filterSort');
    if(fsort) {
        fsort.addEventListener('click', e => {
          const chip = e.target.closest('.seg-btn');
          if (!chip) return;
          document.querySelectorAll('#filterSort .seg-btn').forEach(c => c.classList.remove('active'));
          chip.classList.add('active');
          filterSort = chip.dataset.val;
          currentPage = 1;
          updateResetBtn();
          renderSignals();
        });
    }

    const fsearch = document.getElementById('filterSearch');
    if(fsearch) {
        fsearch.addEventListener('input', e => {
          filterSearch = e.target.value.trim().toUpperCase();
          currentPage = 1;
          updateResetBtn();
          renderSignals();
        });
    }
});
