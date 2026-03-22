// ===========================
// CryptoSpike Notification System — Supabase backed
// Notifikasi disimpan di DB, persisten lintas sesi
// ===========================

const NotifManager = (() => {
  // ─── State ──────────────────────────────────────────────────
  let notifications = [];       // local cache dari Supabase
  let lastFetchedAt = null;     // timestamp fetch terakhir (untuk incremental poll)
  let pollTimer = null;
  let panelOpen = false;
  const MAX_LOCAL  = 100;
  const POLL_MS    = 15000;
  const HOURS_BACK = 48;
  const LS_KEY     = 'cs_read_notifs'; // localStorage key for read IDs

  // ─── LocalStorage read tracking ─────────────────────────────
  function getReadIds() {
    try { return new Set(JSON.parse(localStorage.getItem(LS_KEY) || '[]')); }
    catch { return new Set(); }
  }
  function saveReadId(id) {
    const ids = getReadIds();
    ids.add(id);
    // Keep max 500 read IDs to avoid bloat
    const arr = [...ids].slice(-500);
    localStorage.setItem(LS_KEY, JSON.stringify(arr));
  }
  function saveAllReadIds(ids) {
    const existing = getReadIds();
    ids.forEach(id => existing.add(id));
    const arr = [...existing].slice(-500);
    localStorage.setItem(LS_KEY, JSON.stringify(arr));
  }

  // ─── Supabase helpers ──────────────────────────────────────
  function supaHeaders() {
    return { apikey: SUPA_KEY, Authorization: 'Bearer ' + SUPA_KEY, 'Content-Type': 'application/json' };
  }

  // ─── Format helpers ────────────────────────────────────────
  function fmtPrice(v) {
    const n = parseFloat(v) || 0;
    if (!n) return '—';
    return n < 1 ? n.toFixed(6) : n < 100 ? n.toFixed(4) : n.toFixed(2);
  }
  function fmtPct(v) {
    const n = parseFloat(v) || 0;
    return (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function timeAgo(date) {
    const s = Math.floor((Date.now() - new Date(date)) / 1000);
    if (s < 60)  return 'just now';
    const m = Math.floor(s / 60);
    if (m < 60)  return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24)  return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  }

  // ─── Build display data from a raw DB row ──────────────────
  function buildDisplay(row) {
    const type = row.type || '';
    const sym  = row.symbol || '?';
    const side = row.side   || '';
    const pct  = parseFloat(row.profit_pct) || 0;
    const price = parseFloat(row.price) || 0;

    let iconSvg, iconClass, title, subtitle;

    // SVG icon map
    const ICONS = {
      NEW_SIGNAL: `<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>`,
      TP1_HIT:   `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
      TP2_HIT:   `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="16 10 11 15 8 12"/></svg>`,
      TP3_HIT:   `<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>`,
      TSL_HIT:   `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
      SL_HIT:    `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
    };
    iconSvg   = ICONS[type] || ICONS.NEW_SIGNAL;
    iconClass = type === 'NEW_SIGNAL' ? 'ic-new'
      : type === 'TP3_HIT' ? 'ic-tp3'
      : type === 'SL_HIT'  ? 'ic-sl'
      : type.includes('TP') || type === 'TSL_HIT' ? 'ic-tp'
      : 'ic-new';

    switch (type) {
      case 'NEW_SIGNAL': title = `New Signal — ${sym}`; subtitle = `${side} • Entry @ ${fmtPrice(price)}`; break;
      case 'TP1_HIT':   title = `TP1 Hit — ${sym}`;   subtitle = `${side} • TP1 @ ${fmtPrice(price)} • ${fmtPct(pct)} profit`; break;
      case 'TP2_HIT':   title = `TP2 Hit — ${sym}`;   subtitle = `${side} • TP2 @ ${fmtPrice(price)} • ${fmtPct(pct)} profit`; break;
      case 'TP3_HIT':   title = `TP3 Hit — ${sym}`;   subtitle = `${side} • TP3 @ ${fmtPrice(price)} • ${fmtPct(pct)} profit`; break;
      case 'TSL_HIT':   title = `TSL Hit — ${sym}`;   subtitle = pct ? `${side} • Trailing SL • ${fmtPct(pct)}` : `${side} • Trailing SL triggered`; break;
      case 'SL_HIT':    title = `SL Hit — ${sym}`;    subtitle = `${side} • SL @ ${fmtPrice(price)} • ${fmtPct(Math.abs(pct) > 0 ? -Math.abs(pct) : pct)} loss`; break;
      default:          title = `${type} — ${sym}`;   subtitle = side;
    }

    const notifType = type === 'NEW_SIGNAL' ? 'new'
      : type === 'TP3_HIT' ? 'tp3'
      : type.includes('TP') || type === 'TSL_HIT' ? 'tp'
      : 'sl';

    return { ...row, iconSvg, iconClass, title, subtitle, notifType };
  }

  // ─── Fetch: first load (last 48h) ──────────────────────────
  async function fetchInitial() {
    try {
      const since = new Date(Date.now() - HOURS_BACK * 3600 * 1000).toISOString();
      const url = `${SUPA_URL}/rest/v1/notifications?select=*&created_at=gte.${since}&order=created_at.desc&limit=${MAX_LOCAL}`;
      const res = await fetch(url, { headers: supaHeaders() });
      if (!res.ok) throw new Error(await res.text());
      const rows = await res.json();
      const readIds = getReadIds();
      notifications = rows.map(row => buildDisplay({ ...row, read: readIds.has(row.id) }));
      lastFetchedAt = new Date().toISOString();
      renderList();
      updateBadge();

      // Memunculkan popup untuk notif 5 menit terakhir yang belum dibaca
      const fiveMinsAgo = Date.now() - (5 * 60 * 1000);
      const recentUnread = rows.filter(row => {
        const isRecent = new Date(row.created_at).getTime() >= fiveMinsAgo;
        return isRecent && !readIds.has(row.id);
      }).slice(0, 3); // Ambil maks 3 terbaru agar tidak spam
      
      // Delay sedikit agar animasi tidak bertabrakan dengan load utama
      setTimeout(() => {
        // Balik array agar yang paling lama muncul duluan (ditumpuk yang paling baru)
        recentUnread.reverse().forEach((row, idx) => {
          setTimeout(() => {
            showToast(buildDisplay(row));
          }, idx * 600); // 600ms stagger animation
        });
      }, 1000);

    } catch (e) {
      console.warn('[Notif] fetchInitial error:', e);
    }
  }

  // ─── Poll: incremental (only rows newer than lastFetchedAt) ─
  async function pollNew() {
    if (!lastFetchedAt) return;
    try {
      const url = `${SUPA_URL}/rest/v1/notifications?select=*&created_at=gt.${encodeURIComponent(lastFetchedAt)}&order=created_at.asc&limit=50`;
      const res = await fetch(url, { headers: supaHeaders() });
      if (!res.ok) return;
      const rows = await res.json();
      if (!Array.isArray(rows) || rows.length === 0) { lastFetchedAt = new Date().toISOString(); return; }

      const readIds = getReadIds();
      rows.forEach(row => {
        const display = buildDisplay({ ...row, read: readIds.has(row.id) });
        notifications.unshift(display);
      });
      if (notifications.length > MAX_LOCAL) notifications = notifications.slice(0, MAX_LOCAL);
      lastFetchedAt = new Date().toISOString();

      renderList();
      updateBadge();
      ringBell();
      
      // Munculkan popup toast untuk max 3 notifikasi terbaru agar layar tidak spam
      const newToasts = rows.slice(-3);
      newToasts.forEach(row => {
        const display = buildDisplay({ ...row, read: readIds.has(row.id) });
        showToast(display);
      });
    } catch (e) {
      console.warn('[Notif] poll error:', e);
    }
  }

  // ─── Toast Popup ─────────────────────────────────────────────
  function showToast(notif) {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const el = document.createElement('div');
    el.className = `toast-item toast-type-${notif.notifType}`;
    el.innerHTML = `
      <div class="toast-icon notif-${notif.iconClass}" style="cursor:pointer;">${notif.iconSvg}</div>
      <div class="toast-body" style="cursor:pointer;">
        <div class="toast-title">${notif.title}</div>
        <div class="toast-sub">${notif.subtitle}</div>
      </div>
      <button class="toast-close-btn" title="Mark as Read">✕</button>
    `;
    
    // Klik icon atau teks untuk membuka panel notif
    const openAction = (e) => {
      e.stopPropagation();
      openPanel();
      el.classList.add('removing');
      setTimeout(() => el.remove(), 300);
    };
    el.querySelector('.toast-icon').onclick = openAction;
    el.querySelector('.toast-body').onclick = openAction;

    // Klik tombol ✕ merah/close untuk dismiss dan mark as read selamanya
    el.querySelector('.toast-close-btn').onclick = (e) => {
      e.stopPropagation();
      markRead(notif.id); 
      el.classList.add('removing');
      setTimeout(() => el.remove(), 300);
    };

    container.appendChild(el);

    // Otomatis hilang dari layar (TAPI BELUM DIBACA jika tidak diklik) setelah 5 detik
    setTimeout(() => {
      if (el.parentNode) {
        el.classList.add('removing');
        setTimeout(() => {
          if (el.parentNode) el.remove();
        }, 300);
      }
    }, 5000);
  }

  // ─── Mark read — localStorage only, no DB write ────────────
  async function markRead(id) {
    const n = notifications.find(x => x.id === id);
    if (!n || n.read) return;
    n.read = true;
    saveReadId(id);
    renderList();
    updateBadge();
  }

  async function markAllRead() {
    const unread = notifications.filter(n => !n.read);
    if (!unread.length) return;
    unread.forEach(n => n.read = true);
    saveAllReadIds(unread.map(n => n.id));
    renderList();
    updateBadge();
  }

  // ─── Bell ring animation ────────────────────────────────────
  function ringBell() {
    const bell = document.getElementById('notifBell');
    if (!bell) return;
    bell.classList.remove('notif-bell-ring');
    void bell.offsetWidth;
    bell.classList.add('notif-bell-ring');
  }

  // ─── Badge ─────────────────────────────────────────────────
  function updateBadge() {
    const unread = notifications.filter(n => !n.read).length;
    const el = document.getElementById('notifBadge');
    if (!el) return;
    if (unread > 0) {
      el.style.display = 'flex';
      el.textContent = unread > 99 ? '99+' : unread;
      el.classList.remove('badge-pop');
      void el.offsetWidth;
      el.classList.add('badge-pop');
    } else {
      el.style.display = 'none';
    }
  }

  // ─── Render list ───────────────────────────────────────────
  function renderList() {
    const list  = document.getElementById('notifList');
    const empty = document.getElementById('notifEmpty');
    if (!list) return;

    if (notifications.length === 0) {
      list.innerHTML = '';
      if (empty) empty.style.display = 'flex';
      return;
    }
    if (empty) empty.style.display = 'none';

    list.innerHTML = notifications.map(n => {
      const relTime = timeAgo(n.created_at);
      const d       = new Date(n.created_at);
      const absTime = d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
      const absDate = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
      const readClass = n.read ? 'notif-item-read' : '';
      return `
        <div class="notif-item notif-type-${n.notifType} ${readClass}" onclick="NotifManager.markRead('${n.id}')">
          <div class="notif-item-icon notif-${n.iconClass}">${n.iconSvg}</div>
          <div class="notif-item-body">
            <div class="notif-item-title">${n.title}</div>
            <div class="notif-item-sub">${n.subtitle}</div>
            <div class="notif-item-time">
              <span class="notif-abs-time">🕐 ${absDate} ${absTime}</span>
              <span class="notif-rel-time">${relTime}</span>
            </div>
          </div>
          ${!n.read ? '<div class="notif-unread-dot"></div>' : ''}
        </div>`;
    }).join('');
  }

  // ─── Panel toggle ──────────────────────────────────────────
  function togglePanel()  { panelOpen ? closePanel() : openPanel(); }
  function openPanel()  {
    panelOpen = true;
    const p = document.getElementById('notifPanel');
    const o = document.getElementById('notifOverlay');
    if (p) { p.style.display = 'flex'; requestAnimationFrame(() => p.classList.add('notif-panel-open')); }
    if (o) o.style.display = 'block';
  }
  function closePanel() {
    panelOpen = false;
    const p = document.getElementById('notifPanel');
    const o = document.getElementById('notifOverlay');
    if (p) { p.classList.remove('notif-panel-open'); setTimeout(() => { if (!panelOpen) p.style.display = 'none'; }, 300); }
    if (o) o.style.display = 'none';
  }

  // ─── Init ──────────────────────────────────────────────────
  async function init() {
    await fetchInitial();
    // Start polling every 15s for new notifications
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(pollNew, POLL_MS);
  }

  // ─── Test Dummy Toast ──────────────────────────────────────
  function testToast() {
    showToast({
      notifType: 'new',
      iconClass: 'ic-new',
      iconSvg: '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>',
      title: 'New Signal — BTCUSDT',
      subtitle: 'LONG • Entry @ 65000.00'
    });
    setTimeout(() => {
      showToast({
        notifType: 'tp',
        iconClass: 'ic-tp',
        iconSvg: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
        title: 'TP1 Hit — ETHUSDT',
        subtitle: 'LONG • TP1 @ 3500.00 • +2.50% profit'
      });
    }, 800);
  }

  // Public API
  return { init, togglePanel, closePanel, markRead, markAllRead, testToast };
})();

// Global hooks called from HTML onclick
function toggleNotifPanel() { NotifManager.togglePanel(); }
function closeNotifPanel()  { NotifManager.closePanel(); }
function initNotifications() { NotifManager.init(); }

// Global testing hook for user
function testToast() { NotifManager.testToast(); }
