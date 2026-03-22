// ===========================
// CryptoSpike — Online Presence Tracker
// Heartbeat every 30s, shows count of users active in last 60s
// ===========================

const PresenceManager = (() => {
  // Parse dari browser local storage, agar stabil meski direfresh / buka tab baru
  let savedSession = localStorage.getItem('PresenceSessionID');
  if (!savedSession) {
    savedSession = crypto.randomUUID();
    localStorage.setItem('PresenceSessionID', savedSession);
  }
  const SESSION_ID  = savedSession;
  
  const INTERVAL_MS = 30000; // 30 seconds
  const WINDOW_MS   = 60000; // count sessions active in last 60s
  const BASE_OFFSET = 5;     // Di-set ke 0 agar murni menghitung data asli
  let timer = null;

  function headers() {
    return {
      apikey: SUPA_KEY,
      Authorization: 'Bearer ' + SUPA_KEY,
      'Content-Type': 'application/json'
    };
  }

  // Upsert this session's heartbeat
  async function heartbeat() {
    try {
      await fetch(`${SUPA_URL}/rest/v1/user_presence`, {
        method: 'POST',
        headers: { ...headers(), 'Prefer': 'resolution=merge-duplicates' },
        body: JSON.stringify({ session_id: SESSION_ID, last_seen: new Date().toISOString() })
      });
    } catch (_) {}
  }

  // Fetch count of active sessions
  async function fetchCount() {
    try {
      const since = new Date(Date.now() - WINDOW_MS).toISOString();
      const res = await fetch(
        `${SUPA_URL}/rest/v1/user_presence?last_seen=gte.${encodeURIComponent(since)}&select=session_id`,
        { headers: headers() }
      );
      if (!res.ok) return;
      const rows = await res.json();
      if (Array.isArray(rows)) updateUI(rows.length);
    } catch (_) {}
  }

  function updateUI(count) {
    const countEl = document.getElementById('onlineCount');
    const pill    = document.getElementById('onlinePill');
    if (countEl) countEl.textContent = count + BASE_OFFSET;
    if (pill)    pill.style.display  = 'flex';
  }

  async function tick() {
    await heartbeat();
    await fetchCount();
  }

  function init() {
    tick(); // immediate on load
    timer = setInterval(tick, INTERVAL_MS);
    // Remove session when tab closes
    window.addEventListener('beforeunload', () => {
      navigator.sendBeacon &&
        navigator.sendBeacon(`${SUPA_URL}/rest/v1/user_presence?session_id=eq.${SESSION_ID}`, '');
      // Fallback: keepalive fetch DELETE
      fetch(`${SUPA_URL}/rest/v1/user_presence?session_id=eq.${SESSION_ID}`, {
        method: 'DELETE', headers: headers(), keepalive: true
      }).catch(() => {});
    });
  }

  return { init };
})();
