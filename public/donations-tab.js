let currentDonationPage = 1;
const DONATION_PAGE_SIZE = 5;

async function fetchDonations() {
  try {
    const res = await fetch(SUPA_URL + '/rest/v1/donations?select=*&order=created_at.desc&limit=10000', { 
      headers: { apikey: SUPA_KEY, Authorization: 'Bearer ' + SUPA_KEY } 
    });
    if (!res.ok) return;
    allDonations = await res.json();
    renderDonations();
    renderTopDonators();
  } catch (e) {
    console.error("Donations fetch error:", e);
  }
}

function renderDonations() {
  const container = document.getElementById('donatorsList');
  if(!container) return;

  if (!Array.isArray(allDonations) || allDonations.length === 0) {
    container.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-dim); font-size: 13px;">Be the first to support CryptoSpike! 💛</div>';
    return;
  }

  const totalPages = Math.max(1, Math.ceil(allDonations.length / DONATION_PAGE_SIZE));
  if (currentDonationPage > totalPages) currentDonationPage = totalPages;
  if (currentDonationPage < 1) currentDonationPage = 1;

  const start = (currentDonationPage - 1) * DONATION_PAGE_SIZE;
  const pageItems = allDonations.slice(start, start + DONATION_PAGE_SIZE);

  const dc = document.getElementById('donatorCount');
  if(dc) dc.textContent = `Showing ${pageItems.length} of ${allDonations.length} supporters`;

  let totalToday = 0;
  let totalMonth = 0;
  const now = new Date();
  const formatCurrency = (val) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(val);
  const strOptions = { timeZone: 'Asia/Jakarta' };
  const nowMonth = new Date(now.toLocaleString('en-US', strOptions)).getMonth();
  const nowYear = new Date(now.toLocaleString('en-US', strOptions)).getFullYear();
  const nowDate = new Date(now.toLocaleString('en-US', strOptions)).getDate();

  allDonations.forEach(d => {
    const dDate = new Date(new Date(d.created_at).toLocaleString('en-US', strOptions));
    if (dDate.getMonth() === nowMonth && dDate.getFullYear() === nowYear) {
        totalMonth += Number(d.amount);
        if (dDate.getDate() === nowDate) {
            totalToday += Number(d.amount);
        }
    }
  });
  
  const dts = document.getElementById('donTodayStats'); if(dts) dts.textContent = formatCurrency(totalToday);
  const dms = document.getElementById('donMonthStats'); if(dms) dms.textContent = formatCurrency(totalMonth);

  container.innerHTML = pageItems.map(d => {
    const date = new Date(d.created_at).toLocaleString('en-GB', { timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' }).replace(',', '');
    const amount = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(d.amount);
    return `
      <div style="display:flex; justify-content:space-between; align-items:flex-start; padding: 12px 0; border-bottom: 1px solid var(--border);">
        <div>
          <div style="font-weight:600; font-size:14px; color:var(--text); margin-bottom:4px;">${d.donator_name}</div>
          <div style="font-size:12px; color:var(--text-dim); font-style:italic;">"${d.message || 'No message'}"</div>
        </div>
        <div style="text-align:right;">
          <div style="font-weight:700; font-size:13px; color:#ffb52d;">${amount}</div>
          <div style="font-size:10px; color:var(--text-dim); margin-top:4px;">${date}</div>
        </div>
      </div>
    `;
  }).join('');

  const pag = document.getElementById('donationPagination');
  if(pag) {
      pag.style.display = totalPages > 1 ? 'flex' : 'none';
      const dpi = document.getElementById('donationPageInfo'); if(dpi) dpi.textContent = `${currentDonationPage} / ${totalPages}`;
      const pdp = document.getElementById('prevDonationPage'); if(pdp) pdp.disabled = currentDonationPage <= 1;
      const ndp = document.getElementById('nextDonationPage'); if(ndp) ndp.disabled = currentDonationPage >= totalPages;
  }
}

function changeDonationPage(dir) {
  currentDonationPage += dir;
  renderDonations();
}

function renderTopDonators() {
  const container = document.getElementById('topDonatorsList');
  if (!container) return;

  if (!Array.isArray(allDonations) || allDonations.length === 0) {
    container.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-dim); font-size: 13px;">No data yet.</div>';
    return;
  }

  const grouped = {};
  allDonations.forEach(d => {
    const name = d.donator_name.trim().toUpperCase();
    if(!grouped[name]) grouped[name] = { name: d.donator_name, total: 0, count: 0 };
    grouped[name].total += Number(d.amount);
    grouped[name].count++;
  });

  const top10 = Object.values(grouped).sort((a,b) => b.total - a.total).slice(0, 10);
  const formatCurrency = (val) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(val);
  
  let html = '';
  top10.forEach((d, i) => {
    let badge = `<div style="width:24px; height:24px; border-radius:12px; background:var(--bg); border:1px solid var(--border); display:flex; align-items:center; justify-content:center; font-size:11px; font-weight:700; color:var(--text-dim);">${i+1}</div>`;
    if(i === 0) badge = `<div style="font-size:20px; margin-right:-2px;">👑</div>`;
    if(i === 1) badge = `<div style="font-size:20px; margin-right:-2px;">🥈</div>`;
    if(i === 2) badge = `<div style="font-size:20px; margin-right:-2px;">🥉</div>`;
    
    html += `
      <div style="display:flex; justify-content:space-between; align-items:center; padding: 12px 0; border-bottom: 1px solid var(--border);">
        <div style="display:flex; align-items:center; gap:12px;">
          ${badge}
          <div>
            <div style="font-weight:600; font-size:14px; color:var(--text); margin-bottom:2px;">${d.name}</div>
            <div style="font-size:11px; color:var(--text-dim);">${d.count}x donations</div>
          </div>
        </div>
        <div style="text-align:right; font-weight:700; font-size:14px; color:#ffb52d;">
          ${formatCurrency(d.total)}
        </div>
      </div>
    `;
  });
  container.innerHTML = html;
}

function switchDonationView(view) {
  const brd = document.getElementById('btnRecentDons');
  if(brd) {
      brd.style.background = view === 'recent' ? 'rgba(99,102,241,0.1)' : 'var(--bg)';
      brd.style.color = view === 'recent' ? 'var(--accent)' : 'var(--text-dim)';
      brd.style.border = view === 'recent' ? '1px solid var(--accent)' : '1px solid var(--border)';
  }
  
  const btd = document.getElementById('btnTopDons');
  if(btd) {
      btd.style.background = view === 'top' ? 'rgba(99,102,241,0.1)' : 'var(--bg)';
      btd.style.color = view === 'top' ? 'var(--accent)' : 'var(--text-dim)';
      btd.style.border = view === 'top' ? '1px solid var(--accent)' : '1px solid var(--border)';
  }

  const vrd = document.getElementById('viewRecentDons');
  if(vrd) vrd.style.display = view === 'recent' ? 'block' : 'none';
  const vtd = document.getElementById('viewTopDons');
  if(vtd) vtd.style.display = view === 'top' ? 'block' : 'none';
}
