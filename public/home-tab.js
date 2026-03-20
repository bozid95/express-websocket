function updateRunningStats() {
  const active = allSignals.filter(s => ['ACTIVE', 'TP1_HIT', 'TP2_HIT'].includes(s.status || 'ACTIVE'));
  if (active.length === 0) {
    const rProf = document.getElementById('runProfit'); if(rProf) rProf.textContent = '0';
    const rLoss = document.getElementById('runLoss'); if(rLoss) rLoss.textContent = '0';
    const rAccErr = document.getElementById("runAccuracy"); if(rAccErr) rAccErr.textContent = "—";
    const aFill = document.getElementById('accFill'); if(aFill) aFill.style.width = '0%';
    const rDet = document.getElementById('runDetail'); if(rDet) rDet.textContent = 'No active signals';
    const pCards = document.getElementById('pnlCardsContainer'); if(pCards) pCards.style.display = 'none';
    return;
  }

  let profit = 0, loss = 0, noPrice = 0;
  const pnlData = [];

  active.forEach(s => {
    let price = lastPrices[s.symbol];
    if (!price && s.current_price) {
        price = parseFloat(s.current_price);
        lastPrices[s.symbol] = price;
    }

    const entry = parseFloat(s.entry_price || 0);
    const side = s.signal === 'STRONG BUY' ? 'LONG' : 'SHORT';
    let pnl = 0;
    let hasPrice = false;

    if (price && entry > 0) {
      pnl = ((price - entry) / entry) * 100;
      if (side === 'SHORT') pnl = -pnl;
      if (pnl >= 0) profit++; else loss++;
      hasPrice = true;
    } else {
      noPrice++;
    }
    pnlData.push({ symbol: s.symbol, side, pnl, hasPrice });
  });

  const tracked = profit + loss;
  const acc = tracked > 0 ? ((profit / tracked) * 100).toFixed(0) : '—';

  const rp = document.getElementById('runProfit'); if(rp) rp.textContent = profit;
  const rl = document.getElementById('runLoss'); if(rl) rl.textContent = loss;
  const ra = document.getElementById("runAccuracy"); if(ra) ra.textContent = (acc !== "—" ? acc + "%" : "—");
  const af = document.getElementById('accFill'); if(af) af.style.width = acc !== '—' ? acc + '%' : '0%';

  let detail = `${profit} profit · ${loss} loss`;
  if (noPrice > 0) detail += ` · ${noPrice} waiting for live price`;
  const rd = document.getElementById('runDetail'); if(rd) rd.textContent = detail;

  // Render mini P&L cards
  const container = document.getElementById('pnlCardsContainer');
  const grid = document.getElementById('pnlCardsGrid');

  if (pnlData.length === 0) {
    if(container) container.style.display = 'none';
    return;
  }

  if(container) container.style.display = 'block';
  const pcc = document.getElementById('pnlCardCount');
  if(pcc) pcc.textContent = `${pnlData.length} signals`;

  pnlData.sort((a, b) => {
    if (a.hasPrice && !b.hasPrice) return -1;
    if (!a.hasPrice && b.hasPrice) return 1;
    return b.pnl - a.pnl;
  });

  if(grid) {
      grid.innerHTML = pnlData.map(d => {
        const sym = d.symbol.replace('USDT', '');
        if (!d.hasPrice) {
          return `<div class="pnl-mini" style="border-color:var(--border);">
            <div class="pnl-mini-sym">${sym}</div>
            <div class="pnl-mini-val" style="color:var(--text-dim)">— %</div>
            <div class="pnl-mini-side">${d.side}</div>
          </div>`;
        }
        const cls = d.pnl >= 0 ? 'up' : 'down';
        const color = d.pnl >= 0 ? 'pos' : 'neg';
        const arrow = d.pnl >= 0 ? '▲' : '▼';
        return `<div class="pnl-mini ${cls}">
          <div class="pnl-mini-sym">${sym}</div>
          <div class="pnl-mini-val ${color}">${arrow} ${d.pnl >= 0 ? '+' : ''}${d.pnl.toFixed(2)}%</div>
          <div class="pnl-mini-side">${d.side}</div>
        </div>`;
      }).join('');
  }

  // Net P&L
  const netPnl = pnlData.reduce((s, d) => s + (d.hasPrice ? d.pnl : 0), 0);
  const netEl = document.getElementById('pnlNet');
  const netValEl = document.getElementById('pnlNetVal');
  if(netEl) netEl.style.display = 'block';
  if(netValEl) {
      netValEl.textContent = `${netPnl >= 0 ? '+' : ''}${netPnl.toFixed(2)}%`;
      netValEl.className = 'pnl-net-val ' + (netPnl >= 0 ? 'pos' : 'neg');
  }
  
  updateActiveInsights();
}

function updateActiveInsights() {
  const active = allSignals.filter(s => {
    const st = s.status || '';
    return st.includes('⌛ WAITING') || st.includes('🔄 RUNNING') || st==='ACTIVE' || st==='TP1_HIT' || st==='TP2_HIT';
  });
  
  const panel = document.getElementById('liveIntelPanel');
  if (active.length === 0) {
    if(panel) panel.style.display = 'none';
    return;
  }
  
  if(panel) panel.style.display = 'block';

  const longs = active.filter(s => (s.signal||'').includes('BUY')).length;
  const shorts = active.filter(s => (s.signal||'').includes('SELL')).length;
  const total = longs + shorts;
  
  if (total > 0) {
    const lPerc = (longs / total) * 100;
    const sPerc = 100 - lPerc;
    
    // Home Tab Elements
    const hLBar = document.getElementById("homeSentLongBar"); if(hLBar) hLBar.style.width = lPerc + "%";
    const hSBar = document.getElementById("homeSentShortBar"); if(hSBar) hSBar.style.width = sPerc + "%";
    const hLText = document.getElementById("homeSentLongText"); if(hLText) hLText.textContent = lPerc.toFixed(0) + "%";
    const hSText = document.getElementById("homeSentShortText"); if(hSText) hSText.textContent = sPerc.toFixed(0) + "%";

    // Insights Tab Elements
    const iLBar = document.getElementById("sentLongBar"); if(iLBar) iLBar.style.width = lPerc + "%";
    const iSBar = document.getElementById("sentShortBar"); if(iSBar) iSBar.style.width = sPerc + "%";
    const iLText = document.getElementById("sentLongText"); if(iLText) iLText.textContent = lPerc.toFixed(0) + "%";
    const iSText = document.getElementById("sentShortText"); if(iSText) iSText.textContent = sPerc.toFixed(0) + "%";

    const homeTip = document.getElementById('homeTip');
    if (homeTip) {
      if (lPerc > 60) {
        homeTip.textContent = "Market Pulse shows a strong BULLISH bias (L > 60%). This is an ideal time to look for LONG setups with high volume confirmation at Support areas.";
      } else if (sPerc > 60) {
        homeTip.textContent = "Market Pulse shows a dominant BEARISH bias (S > 60%). Be careful of short pullbacks; SHORT setups at Resistance areas look more promising.";
      } else {
        homeTip.textContent = "The market is currently Neutral/Balanced. Avoid FOMO and wait for breakout confirmation or signals with score > 85 for high probability.";
      }
    }
  }

  // Score Consistency
  const recent = allSignals.slice(0, 40);
  const highScorers = recent.filter(s => (parseFloat(s.score) || 0) >= 80);
  const lowScorers = recent.filter(s => (parseFloat(s.score) || 0) < 80);
  
  const getWr = (set) => {
    if (set.length === 0) return 0;
    const wins = set.filter(s => s.status && (s.status.includes('✅ TP') || s.status.includes('🏆 TP'))).length;
    return (wins / set.length) * 100;
  };

  const highWr = getWr(highScorers);
  const lowWr = getWr(lowScorers);
  
  const scorePerfEl = document.getElementById('intelScorePerf');
  const scoreSubEl = document.getElementById('intelScoreSub');
  
  if (scorePerfEl && scoreSubEl) {
    if (highWr > lowWr + 5) {
      scorePerfEl.innerHTML = '<span class="badge-safe action-badge">High Score Valid</span>';
      scoreSubEl.textContent = `High-Score Winrate: ${highWr.toFixed(0)}% (Strong Correlation)`;
    } else if (lowWr > highWr) {
      scorePerfEl.innerHTML = '<span class="badge-warn action-badge">Score Anomaly</span>';
      scoreSubEl.textContent = `Warning: Low scores are more accurate today (${lowWr.toFixed(0)}% WR).`;
    } else {
      scorePerfEl.textContent = 'Stable';
      scoreSubEl.textContent = 'Score & profit correlation is normal.';
    }
  }

  let guidance = "";
  if (longs > shorts * 2) guidance = "Sentiment: OVERBOUGHT. Be cautious about new LONG entries, the market is saturated.";
  else if (shorts > longs * 2) guidance = "Sentiment: OVERSOLD. SHORT signals dominate, look for Grade A signals only.";
  else guidance = "Balanced Market. Focus on individual coin signals with score >75.";
  
  if (lowWr > highWr) guidance += " [System Note: Historical data shows low scores are currently outliers/accurate today.]";
  
  const iGui = document.getElementById('intelGuidance');
  if(iGui) iGui.textContent = guidance;
}
