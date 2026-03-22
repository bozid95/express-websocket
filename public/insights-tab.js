let currentInsightPage = 1;
const INSIGHT_PAGE_SIZE = 10;
let insightSortCol = 'newest';
let insightFilterStatus = 'all';

function renderInsightTables() {
  const statsSignals = allSignals.filter(s => s.status && !['ACTIVE', '⌛ WAITING', 'EXPIRED'].includes(s.status));
  const running = allSignals.filter(s => !s.status || ['ACTIVE','TP1_HIT','TP2_HIT'].includes(s.status));
  
  const ist = document.getElementById('insightStatsTables');
  if (closed.length < 1 && running.length < 1) {
      if(ist) ist.style.display = 'none';
      return;
  }

  const wins = statsSignals.filter(s => s.status?.includes('TP') || (s.status?.includes('TSL') && (s.profit_pct == null || s.profit_pct === "" || parseFloat(s.profit_pct) >= 0)));
  const losses = statsSignals.filter(s => s.status?.includes('SL') && !s.status?.includes('TSL') || (s.status?.includes('TSL') && parseFloat(s.profit_pct) < 0));
  const wr = statsSignals.length > 0 ? ((wins.length / statsSignals.length) * 100).toFixed(1) : '0';
  
  const avgW = wins.length ? (wins.map(s=>parseFloat(s.profit_pct)||0).reduce((a,b)=>a+b,0)/wins.length).toFixed(2) : '0';
  const avgL = losses.length ? (losses.map(s=>parseFloat(s.profit_pct)||0).reduce((a,b)=>a+b,0)/losses.length).toFixed(2) : '0';
  const avgLAbs = Math.abs(parseFloat(avgL));
  const rr = avgLAbs > 0 ? (parseFloat(avgW) / avgLAbs).toFixed(2) : 'N/A';

  let tp3=0, tp2_c=0, tp1_c=0, sl=0, tsl=0;
  let longWins = 0, longTotal = 0;
  let shortWins = 0, shortTotal = 0;

  statsSignals.forEach(s => {
    const pnl = parseFloat(s.profit_pct || 0);
    const st = s.status;
    const entry = parseFloat(s.entry_price || 0);
    const tp1 = parseFloat(s.tp1 || 0);
    const tp2 = parseFloat(s.tp2 || 0);
    const side = (s.signal || '').includes('BUY') ? 'LONG' : 'SHORT';

    if (st === 'TP3_HIT') {
      tp3++;
    } else if (st === 'TP2_HIT') {
      tp2_c++;
    } else if (st === 'TP1_HIT') {
      tp1_c++;
    } else if (st === 'SL_HIT') {
      sl++;
    } else if (st === 'TSL_HIT') {
      // Categorize TSL based on highest TP reached before the stop
      if (entry > 0) {
        const tp1_pnl = side === 'LONG' ? ((tp1 - entry) / entry * 100) : ((entry - tp1) / entry * 100);
        const tp2_pnl = side === 'LONG' ? ((tp2 - entry) / entry * 100) : ((entry - tp2) / entry * 100);
        if (pnl >= tp2_pnl - 0.5) {
          tp2_c++; 
        } else if (pnl >= tp1_pnl - 0.5) {
          tp1_c++;
        }
      }
    }

    const isWin = pnl > 0 || st.includes('TP');
    if (side === 'LONG') { longTotal++; if (isWin) longWins++; }
    else { shortTotal++; if (isWin) shortWins++; }
  });

  const longWr = longTotal > 0 ? ((longWins / longTotal) * 100).toFixed(0) : '—';
  const shortWr = shortTotal > 0 ? ((shortWins / shortTotal) * 100).toFixed(0) : '—';

  const scoreRows = [['90+',90,999],['80-89',80,89],['70-79',70,79],['60-69',60,69],['<60',0,59]].map(([lbl,mn,mx])=>{
    const g = statsSignals.filter(s=>{ const sc=parseInt(s.score)||0; return sc>=mn && sc<=mx; });
    if (!g.length) return '';
    const gw = g.filter(s=>s.status?.includes('TP')||(s.status?.includes('TSL') && (s.profit_pct == null || s.profit_pct === "" || parseFloat(s.profit_pct) >= 0))).length;
    const gwp = ((gw/g.length)*100).toFixed(0);
    const cls = parseInt(gwp)>=60?'pos':parseInt(gwp)<40?'neg':'';
    return `<tr><td>${lbl}</td><td>${g.length}</td><td class="${cls}">${gwp}%</td></tr>`;
  }).join('');

  let loggedSignals = [...allSignals];

  if (insightFilterStatus === 'running') {
    loggedSignals = loggedSignals.filter(s => !s.status || ['ACTIVE','TP1_HIT','TP2_HIT'].includes(s.status));
  } else if (insightFilterStatus === 'closed') {
    loggedSignals = loggedSignals.filter(s => s.status && !['ACTIVE','TP1_HIT','TP2_HIT'].includes(s.status));
  }
  
  if (insightSortCol === 'score') {
    loggedSignals.sort((a, b) => (parseInt(b.score) || 0) - (parseInt(a.score) || 0));
  } else if (insightSortCol === 'profit') {
    loggedSignals.sort((a, b) => (parseFloat(b.profit_pct) || 0) - (parseFloat(a.profit_pct) || 0));
  } else if (insightSortCol === 'symbol') {
    loggedSignals.sort((a, b) => (a.symbol || '').localeCompare(b.symbol || ''));
  } else {
    loggedSignals.sort((a, b) => new Date(b.sent_at) - new Date(a.sent_at));
  }

  const totalInsightPages = Math.max(1, Math.ceil(loggedSignals.length / INSIGHT_PAGE_SIZE));
  if (currentInsightPage > totalInsightPages) currentInsightPage = totalInsightPages;
  if (currentInsightPage < 1) currentInsightPage = 1;

  const startIdx = (currentInsightPage - 1) * INSIGHT_PAGE_SIZE;
  const pageItems = loggedSignals.slice(startIdx, startIdx + INSIGHT_PAGE_SIZE);

  const recentLogs = pageItems.map(s => {
    const side = (s.signal||'').includes('BUY') ? '<span class="pos">L</span>' : '<span class="neg">S</span>';
    const st = s.status || 'ACTIVE';
    
    let stLabel = '⌛';
    if (st === 'TP1_HIT') stLabel = '🔄 T1';
    else if (st === 'TP2_HIT') stLabel = '🔄 T2';
    else if (st === 'TP3_HIT') stLabel = '🏆 T3';
    else if (st === 'SL_HIT') stLabel = '❌ SL';
    else if (st === 'TSL_HIT') stLabel = '🛡️ TSL';
    else if (st === 'EXPIRED') stLabel = '⌛ EXP';

    const p = parseFloat(s.profit_pct || 0);
    const pnlDisplay = `<span class="${p >= 0 ? 'pos' : 'neg'}">${p >= 0 ? '+' : ''}${p.toFixed(1)}%</span>`;

    return `<tr>
      <td><div style="font-weight:600;">${s.symbol.replace('USDT','')}</div><div class="dim" style="font-size:9px;">${getTimeAgo(s.sent_at)}</div></td>
      <td style="text-align:center;">${side}</td>
      <td style="text-align:center;">${s.score}</td>
      <td style="text-align:center; font-size:10px;">${stLabel}</td>
      <td style="text-align:right; font-weight:700;">${pnlDisplay}</td>
    </tr>`;
  }).join('');

  const sortIcon = (col) => insightSortCol === col ? ' ▾' : '';

  const itc = document.getElementById('insightTablesContent');
  if(itc) {
      itc.innerHTML = `
        <div style="margin-bottom:16px; background:rgba(255,255,255,0.02); border:1px solid var(--border); border-radius:12px; padding:12px;">
          <div style="font-size:10px; color:var(--text-dim); font-weight:700; text-transform:uppercase; margin-bottom:10px; letter-spacing:0.5px;">🎯 Performance Statistics</div>
          <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:8px; margin-bottom:12px;">
            <div style="background:rgba(14,203,129,0.05); border:1px solid rgba(14,203,129,0.1); border-radius:8px; padding:8px; text-align:center;">
              <div style="font-size:16px; font-weight:700; color:var(--buy);">${wr}%</div>
              <div style="font-size:8px; color:var(--text-dim); text-transform:uppercase;">Win Rate</div>
            </div>
            <div style="background:rgba(99,102,241,0.05); border:1px solid rgba(99,102,241,0.1); border-radius:8px; padding:8px; text-align:center;">
              <div style="font-size:16px; font-weight:700; color:var(--accent);">${rr}:1</div>
              <div style="font-size:8px; color:var(--text-dim); text-transform:uppercase;">R:R Ratio</div>
            </div>
            <div style="background:rgba(255,255,255,0.03); border:1px solid var(--border); border-radius:8px; padding:8px; text-align:center;">
              <div style="font-size:16px; font-weight:700; color:var(--text);">${statsSignals.length}</div>
              <div style="font-size:8px; color:var(--text-dim); text-transform:uppercase;">Recapped signals</div>
            </div>
          </div>

          <div style="display:flex; justify-content:space-between; gap:4px;">
            <div style="flex:1; text-align:center;">
              <div style="font-size:12px; font-weight:700; color:#fbbf24;">${tp3}</div>
              <div style="font-size:7px; color:var(--text-dim);">TP3</div>
            </div>
            <div style="flex:1; text-align:center;">
              <div style="font-size:12px; font-weight:700; color:var(--buy);">${tp2_c}</div>
              <div style="font-size:7px; color:var(--text-dim);">TP2</div>
            </div>
            <div style="flex:1; text-align:center;">
              <div style="font-size:12px; font-weight:700; color:#34d399;">${tp1_c}</div>
              <div style="font-size:7px; color:var(--text-dim);">TP1</div>
            </div>
            <div style="flex:1; text-align:center;">
              <div style="font-size:12px; font-weight:700; color:var(--sell);">${sl}</div>
              <div style="font-size:7px; color:var(--text-dim);">SL</div>
            </div>
          </div>

          <div style="display:flex; gap:8px; margin-top:12px; border-top:1px solid rgba(255,255,255,0.05); padding-top:12px;">
            <div style="flex:1; font-size:10px;">
              <span class="dim">Long WR:</span> <span class="pos" style="font-weight:700;">${longWr}%</span>
            </div>
            <div style="flex:1; font-size:10px; text-align:right;">
              <span class="dim">Short WR:</span> <span class="neg" style="font-weight:700;">${shortWr}%</span>
            </div>
          </div>
        </div>

        <div style="margin-bottom:16px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
            <div style="font-size:10px; color:var(--text-dim); font-weight:700; text-transform:uppercase; letter-spacing:0.5px;">📋 Recent Signals Log</div>
            <div style="display:flex; gap:4px;">
              <button class="seg-btn ${insightFilterStatus === 'all' ? 'active' : ''}" style="font-size:8px; padding:2px 6px;" onclick="setInsightFilter('all')">All</button>
              <button class="seg-btn ${insightFilterStatus === 'running' ? 'active' : ''}" style="font-size:8px; padding:2px 6px;" onclick="setInsightFilter('running')">Run</button>
              <button class="seg-btn ${insightFilterStatus === 'closed' ? 'active' : ''}" style="font-size:8px; padding:2px 6px;" onclick="setInsightFilter('closed')">Cls</button>
            </div>
          </div>
          <table class="insight-stats-table">
            <thead>
              <tr>
                <th style="text-align:left; cursor:pointer;" onclick="setInsightSort('symbol')">Signal${sortIcon('symbol')}</th>
                <th style="text-align:center;">S</th>
                <th style="text-align:center; cursor:pointer;" onclick="setInsightSort('score')">Sc${sortIcon('score')}</th>
                <th style="text-align:center; cursor:pointer;" onclick="setInsightSort('newest')">Stat${sortIcon('newest')}</th>
                <th style="text-align:right; cursor:pointer;" onclick="setInsightSort('profit')">P&L${sortIcon('profit')}</th>
              </tr>
            </thead>
            <tbody>
              ${recentLogs}
            </tbody>
          </table>
          
          <div class="pagination" style="padding: 10px 0; gap: 8px;">
            <button class="page-btn" style="padding: 4px 10px; font-size: 10px;" ${currentInsightPage <= 1 ? 'disabled' : ''} onclick="changeInsightPage(-1)">←</button>
            <span style="font-size: 10px; color: var(--text-dim); font-weight: 600;">Page ${currentInsightPage} / ${totalInsightPages}</span>
            <button class="page-btn" style="padding: 4px 10px; font-size: 10px;" ${currentInsightPage >= totalInsightPages ? 'disabled' : ''} onclick="changeInsightPage(1)">→</button>
          </div>
        </div>

        <div>
          <div style="font-size:10px; color:var(--text-dim); font-weight:700; text-transform:uppercase; margin-bottom:8px; letter-spacing:0.5px;">📊 Performance by Score</div>
          <table class="insight-stats-table">
            <thead><tr><th>Bracket</th><th>Total</th><th>Win Rate</th></tr></thead>
            <tbody>${scoreRows}</tbody>
          </table>
        </div>
      `;
  }
  if(ist) ist.style.display = 'block';
  
  if (typeof connectPriceWs === 'function') connectPriceWs();
}

function changeInsightPage(dir) {
  currentInsightPage += dir;
  renderInsightTables();
}

function setInsightSort(col) {
  insightSortCol = col;
  currentInsightPage = 1;
  renderInsightTables();
}

function setInsightFilter(status) {
  insightFilterStatus = status;
  currentInsightPage = 1;
  renderInsightTables();
}

async function triggerDeepAnalysis() {
  const btn = document.getElementById('btnDeepScan');
  const setView = (v) => {
    ['aiIdle','aiLoading','aiResult','aiError'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = id === v ? 'block' : 'none';
    });
  };

  if (allSignals.length < 5) {
    setView('aiError');
    const em = document.getElementById('aiErrorMsg');
    if(em) em.textContent = 'Insufficient data for analysis (min 5 signals). Please wait for more signals to arrive.';
    return;
  }

  if(btn) {
      btn.disabled = true;
      btn.innerHTML = '⏳ Analyzing...';
  }
  setView('aiLoading');

  try {
    const statsSignals = allSignals.filter(s => s.status && !['ACTIVE', '⌛ WAITING', 'EXPIRED'].includes(s.status));
    const active = allSignals.filter(s => !s.status || ['ACTIVE','TP1_HIT','TP2_HIT'].includes(s.status));
    const wins = statsSignals.filter(s => s.status && (s.status.includes('TP') || (s.status.includes('TSL') && (s.profit_pct == null || s.profit_pct === "" || parseFloat(s.profit_pct) >= 0))));
    const losses = statsSignals.filter(s => s.status === 'SL_HIT' && !s.status.includes('TSL') || (s.status.includes('TSL') && parseFloat(s.profit_pct) < 0));
    const overallWR = statsSignals.length > 0 ? ((wins.length / statsSignals.length) * 100).toFixed(1) : '0';

    const winProfits = wins.map(s => parseFloat(s.profit_pct) || 0);
    const lossProfits = losses.map(s => parseFloat(s.profit_pct) || 0);
    const avgWin = winProfits.length ? (winProfits.reduce((a,b) => a+b, 0) / winProfits.length).toFixed(2) : '0';
    const avgLoss = lossProfits.length ? (lossProfits.reduce((a,b) => a+b, 0) / lossProfits.length).toFixed(2) : '0';

    const statsPayload = `=== RAPOR DATA HISTORIS === Total:${allSignals.length} | Scored:${statsSignals.length} | WR:${overallWR}% | AvgW:+${avgWin}% | AvgL:${avgLoss}% | Active:${active.length}`;

    const response = await fetch('/api/ai-insight', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stats: statsPayload, detail: allSignals.slice(0, 50) }) // Simplified for modular script
    });

    if (!response.ok) throw new Error('AI Server error');

    const data = await response.json();
    const aiResponse = data.choices[0].message.content;

    const pr = document.getElementById('proRecommendation');
    if(pr) pr.innerHTML = typeof marked !== 'undefined' ? marked.parse(aiResponse) : aiResponse.replace(/\n/g, '<br>');
    
    const at = document.getElementById('aiTimestamp');
    if(at) at.textContent = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    
    setView('aiResult');

  } catch (e) {
    setView('aiError');
    const em = document.getElementById('aiErrorMsg');
    if(em) em.textContent = 'Failed to generate analyze. Please try again later.';
  } finally {
    if(btn) {
        btn.disabled = false;
        btn.innerHTML = '⚡ Analyze Now';
    }
  }
}
