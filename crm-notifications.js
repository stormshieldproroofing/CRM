/* StormShield CRM — Notifications (bell, list, live pop-ups).

   What creates them (database triggers, see the notifications migration):
   - Someone adds a note to a job assigned to you
   - Someone @mentions you in a note
   - The homeowner opens / signs the claim packet you sent (or on your job)
   - A supplement on your job is approved / partially approved (rep + office)

   Where you see them:
   - A bell with an unread count (top bar on phone/tablet, sidebar on desktop)
   - A pop-up at the top of the screen the moment one arrives
   - Lock-screen alerts (Web Push) on each phone / computer where the person turns
     them on from the bell ("Turn on lock-screen alerts"). iPhone: only from the
     home-screen app (Share → Add to Home Screen). Server side: push-send function.
   Tapping one opens the job (notes for note/mention alerts, Packet tab for packet alerts). */
(function () {
  'use strict';
  if (window.__ssNotif) return;
  window.__ssNotif = true;

  const KIND = {
    note:          { icon: 'ti-notes',        cls: 'note' },
    mention:       { icon: 'ti-at',           cls: 'mention' },
    packet_viewed: { icon: 'ti-eye',          cls: 'viewed' },
    packet_signed: { icon: 'ti-writing-sign', cls: 'signed' },
    test:          { icon: 'ti-bell',         cls: 'note' },
    supplement_approved: { icon: 'ti-file-dollar', cls: 'signed' },
  };
  // Public half of the push signing key (the private half is in Supabase Vault)
  const VAPID_PUBLIC = 'BLRj0hCYCe-5aEHlpstRTFEiH6CVeGYJBplZUM-2oRWIP_o5taZTm_FWU6qmfDApRYZFBcqWt2Ok-rf3GynF0VQ';
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sbc = () => window.sb || null;

  const S = { uid: null, items: [], open: false, filter: 'all', channel: null, started: false, push: 'checking', pushBusy: false };

  // ── Data ────────────────────────────────────────────────────────────────
  async function load() {
    try {
      const { data, error } = await sbc().from('notifications').select('*').order('created_at', { ascending: false }).limit(60);
      if (error) throw error;
      S.items = data || [];
      paint();
    } catch (e) { console.warn('[notifications] load failed', e); }
  }
  function subscribe() {
    if (S.channel || !S.uid) return;
    try {
      S.channel = sbc().channel('notifications:' + S.uid)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: 'recipient=eq.' + S.uid }, p => {
          const n = p.new; if (!n || S.items.some(x => x.id === n.id)) return;
          S.items.unshift(n); paint(); popup(n);
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'notifications', filter: 'recipient=eq.' + S.uid }, p => {
          const i = S.items.findIndex(x => x.id === p.new.id); if (i >= 0) { S.items[i] = p.new; paint(); }
        })
        .subscribe();
    } catch (e) { console.warn('[notifications] live updates off', e); }
  }
  const unread = () => S.items.filter(n => !n.read_at).length;

  async function markRead(ids) {
    ids = (ids || []).filter(Boolean); if (!ids.length) return;
    const now = new Date().toISOString();
    S.items.forEach(n => { if (ids.includes(n.id) && !n.read_at) n.read_at = now; });
    paint();
    try { await sbc().from('notifications').update({ read_at: now }).in('id', ids).is('read_at', null); } catch (e) {}
  }
  function markAllRead() { const ids = S.items.filter(n => !n.read_at).map(n => n.id); if (ids.length) markRead(ids); }

  // ── Opening what a notification is about ───────────────────────────────
  function canOpen(jobId) { try { return !!(window.jobs || jobs).find(j => j.id === jobId); } catch (e) { return false; } }
  function openItem(n) {
    markRead([n.id]);
    closePanel();
    if (!n.job_id) return;
    if (!canOpen(n.job_id)) { toastMsg("That job isn't on your board"); return; }
    if ((n.kind === 'note' || n.kind === 'mention') && typeof window.ssOpenJobNotes === 'function') { window.ssOpenJobNotes(n.job_id); return; }
    if (typeof window.openDetail === 'function') {
      window.openDetail(n.job_id);
      if (n.kind === 'packet_viewed' || n.kind === 'packet_signed') {
        setTimeout(() => { const t = document.querySelector('#detailPanel [data-dptab="packet"]'); if (t) t.click(); }, 60);
      }
    }
  }
  function toastMsg(m) { try { if (typeof window.toast === 'function') return window.toast(m); } catch (e) {} }

  // ── Time label ──────────────────────────────────────────────────────────
  function ago(iso) {
    const d = new Date(iso), s = (Date.now() - d) / 1000;
    if (isNaN(d)) return '';
    if (s < 60) return 'now';
    if (s < 3600) return Math.floor(s / 60) + 'm';
    if (s < 86400 && d.toDateString() === new Date().toDateString()) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    const y = new Date(); y.setDate(y.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return 'Yesterday';
    if (s < 6 * 86400) return d.toLocaleDateString('en-US', { weekday: 'short' });
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  // ── Bell + panel ────────────────────────────────────────────────────────
  function bell() {
    let b = $('ssnBell');
    if (b && document.body.contains(b)) return b;
    const nav = document.querySelector('.topnav');
    if (!nav) return null;
    b = document.createElement('button');
    b.id = 'ssnBell'; b.type = 'button'; b.className = 'ssn-bell';
    b.setAttribute('aria-label', 'Notifications'); b.setAttribute('aria-haspopup', 'dialog');
    b.innerHTML = '<i class="ti ti-bell" aria-hidden="true"></i><span class="ssn-bell-n" hidden></span>';
    b.addEventListener('click', e => { e.stopPropagation(); S.open ? closePanel() : openPanel(); });
    const gs = $('gsBtn');
    if (gs && gs.parentElement === nav) nav.insertBefore(b, gs); else nav.appendChild(b);
    return b;
  }
  function panel() {
    let p = $('ssnNotifPanel');
    if (!p) {
      p = document.createElement('section');
      p.id = 'ssnNotifPanel'; p.className = 'ssn-np'; p.setAttribute('role', 'dialog'); p.setAttribute('aria-label', 'Notifications'); p.hidden = true;
      document.body.appendChild(p);
      p.addEventListener('click', e => {
        e.stopPropagation();
        const it = e.target.closest('[data-nid]');
        if (it) { const n = S.items.find(x => x.id === it.dataset.nid); if (n) openItem(n); return; }
        const f = e.target.closest('[data-filter]'); if (f) { S.filter = f.dataset.filter; paint(); return; }
        const a = e.target.closest('[data-act]'); if (!a) return;
        if (a.dataset.act === 'readall') markAllRead();
        if (a.dataset.act === 'close') closePanel();
        if (a.dataset.act === 'push-on') turnOnPush();
        if (a.dataset.act === 'push-off') turnOffPush();
        if (a.dataset.act === 'push-test') sendTest();
      });
    }
    return p;
  }
  function openPanel() { S.open = true; const pop = $('ssnPop'); if (pop) pop.classList.remove('show'); paint(); const p = panel(); p.hidden = false; const f = p.querySelector('.ssn-np-list'); if (f) f.scrollTop = 0; }
  function closePanel() { if (!S.open) return; S.open = false; const p = $('ssnNotifPanel'); if (p) p.hidden = true; paint(); }
  document.addEventListener('click', e => { if (S.open && !e.target.closest('#ssnNotifPanel,#ssnBell')) closePanel(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && S.open) closePanel(); });

  function itemHTML(n) {
    const k = KIND[n.kind] || KIND.note;
    return `<button type="button" class="ssn-ni${n.read_at ? '' : ' unread'}" data-nid="${esc(n.id)}">
      <span class="ssn-ni-ic ${k.cls}"><i class="ti ${k.icon}" aria-hidden="true"></i></span>
      <span class="ssn-ni-main">
        <span class="ssn-ni-top"><span class="ssn-ni-t">${esc(n.title)}</span><span class="ssn-ni-when">${esc(ago(n.created_at))}</span></span>
        ${n.body ? `<span class="ssn-ni-b">${esc(n.body)}</span>` : ''}
        ${n.job_label ? `<span class="ssn-ni-job">${esc(n.job_label)}</span>` : ''}
      </span>
      ${n.read_at ? '' : '<span class="ssn-ni-dot" aria-label="Unread"></span>'}
    </button>`;
  }
  function paint() {
    const u = unread();
    const b = bell();
    if (b) {
      const c = b.querySelector('.ssn-bell-n');
      c.hidden = !u; c.textContent = u > 99 ? '99+' : String(u);
      b.classList.toggle('on', S.open);
      b.setAttribute('aria-label', u ? 'Notifications, ' + u + ' unread' : 'Notifications');
    }
    try { if (navigator.setAppBadge) { u ? navigator.setAppBadge(u) : navigator.clearAppBadge(); } } catch (e) {}
    if (!S.open) return;
    const list = S.filter === 'mention' ? S.items.filter(n => n.kind === 'mention')
      : S.filter === 'packet' ? S.items.filter(n => n.kind.indexOf('packet') === 0)
      : S.filter === 'supp' ? S.items.filter(n => n.kind === 'supplement_approved') : S.items;
    panel().innerHTML = `
      <div class="ssn-np-h"><div class="ssn-np-title">Notifications</div>
        ${u ? '<button type="button" class="ssn-np-link" data-act="readall">Mark all read</button>' : ''}
        <button type="button" class="ssn-np-x" data-act="close" aria-label="Close"><i class="ti ti-x" aria-hidden="true"></i></button></div>
      <div class="ssn-np-f">
        ${[['all', 'All'], ['mention', 'Mentions'], ['packet', 'Packets'], ['supp', 'Supplements']].map(([k, l]) => `<button type="button" class="ssn-np-chip${S.filter === k ? ' on' : ''}" data-filter="${k}" aria-pressed="${S.filter === k}">${l}</button>`).join('')}
      </div>
      <div class="ssn-np-list">${list.length ? list.map(itemHTML).join('') : '<div class="ssn-np-empty">You\'re all caught up.</div>'}</div>
      ${pushRowHTML() ? `<div class="ssn-np-foot">${pushRowHTML()}</div>` : ''}`;
  }

  // ── Pop-up when one arrives ─────────────────────────────────────────────
  let popTimer = null;
  function popup(n) {
    let el = $('ssnPop');
    if (!el) {
      el = document.createElement('button'); el.id = 'ssnPop'; el.type = 'button'; el.className = 'ssn-pop';
      document.body.appendChild(el);
    }
    const k = KIND[n.kind] || KIND.note;
    el.innerHTML = `<span class="ssn-ni-ic ${k.cls}"><i class="ti ${k.icon}" aria-hidden="true"></i></span>
      <span class="ssn-ni-main"><span class="ssn-ni-t">${esc(n.title)}</span>
      <span class="ssn-ni-b">${esc((n.job_label ? n.job_label + ' · ' : '') + (n.body || ''))}</span></span>`;
    el.onclick = e => { e.stopPropagation(); el.classList.remove('show'); openItem(n); };
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
    clearTimeout(popTimer); popTimer = setTimeout(() => el.classList.remove('show'), 6000);
  }

  // ── Lock-screen alerts (Web Push) ───────────────────────────────────────
  const isIOS = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = () => !!(window.navigator.standalone || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches));
  const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  function keyBytes(b64) {
    const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64.length + 3) % 4));
    return Uint8Array.from(s, c => c.charCodeAt(0));
  }
  let swReg = null;
  async function registerSW() {
    if (!('serviceWorker' in navigator)) return null;
    try { swReg = await navigator.serviceWorker.register('sw.js'); } catch (e) { console.warn('[push] helper not registered', e); }
    return swReg;
  }
  async function saveSub(sub) {
    const j = sub.toJSON();
    const { error } = await sbc().rpc('save_push_subscription', { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_ua: navigator.userAgent });
    if (error) throw error;
  }
  // Work out what the "lock-screen alerts" row should say on this device
  async function checkPush() {
    if (isIOS() && !standalone()) S.push = 'ios-install';
    else if (!pushSupported()) S.push = 'unsupported';
    else if (Notification.permission === 'denied') S.push = 'blocked';
    else {
      const reg = swReg || await registerSW();
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      if (sub && Notification.permission === 'granted') {
        S.push = 'on';
        try { await saveSub(sub); } catch (e) {}          // keep it linked to whoever is signed in now
      } else S.push = 'off';
    }
    paint();
  }
  async function turnOnPush() {
    if (S.pushBusy) return;
    S.pushBusy = true; paint();
    try {
      const perm = await Notification.requestPermission();   // must run straight from the tap
      if (perm !== 'granted') { S.push = perm === 'denied' ? 'blocked' : 'off'; return; }
      const reg = swReg || await registerSW();
      await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC) });
      await saveSub(sub);
      S.push = 'on';
      toastMsg('Lock-screen alerts are on');
    } catch (e) {
      console.warn('[push] turn on failed', e);
      toastMsg("Couldn't turn on alerts. Try again");
    } finally { S.pushBusy = false; paint(); }
  }
  async function turnOffPush() {
    try {
      const reg = swReg || await registerSW();
      const sub = reg && await reg.pushManager.getSubscription();
      if (sub) { try { await sbc().rpc('remove_push_subscription', { p_endpoint: sub.endpoint }); } catch (e) {} await sub.unsubscribe(); }
    } catch (e) {}
    S.push = 'off'; paint();
  }
  async function sendTest() {
    try { const { error } = await sbc().rpc('send_test_notification'); if (error) throw error; toastMsg('Test sent. Lock your phone to see it'); }
    catch (e) { toastMsg("Couldn't send a test"); }
  }
  function pushRowHTML() {
    switch (S.push) {
      case 'on': return `<div class="ssn-np-push on"><i class="ti ti-device-mobile-check" aria-hidden="true"></i><span class="ssn-np-pt">Lock-screen alerts are on for this device</span>
        <button type="button" class="ssn-np-link" data-act="push-test">Send a test</button><button type="button" class="ssn-np-link mute" data-act="push-off">Turn off</button></div>`;
      case 'off': return `<div class="ssn-np-push"><i class="ti ti-device-mobile" aria-hidden="true"></i><span class="ssn-np-pt">Get these on your lock screen</span>
        <button type="button" class="ssn-np-btn" data-act="push-on"${S.pushBusy ? ' disabled' : ''}>${S.pushBusy ? 'Turning on…' : 'Turn on'}</button></div>`;
      case 'ios-install': return `<div class="ssn-np-push col"><span class="ssn-np-pt"><b>Get alerts on your locked iPhone</b></span>
        <span class="ssn-np-ps">In Safari tap <b>Share</b> &rarr; <b>Add to Home Screen</b>, open StormShield from the new icon, then tap the bell and <b>Turn on</b>.</span></div>`;
      case 'blocked': return `<div class="ssn-np-push col"><span class="ssn-np-pt"><b>Alerts are blocked on this device</b></span>
        <span class="ssn-np-ps">${isIOS() ? 'Settings &rarr; Notifications &rarr; StormShield &rarr; Allow Notifications.' : 'Allow notifications for this site in your browser settings.'}</span></div>`;
      default: return '';
    }
  }

  // ── Opening from a lock-screen alert (?job=…&open=notes|packet&nid=…) ─────
  function openFromUrl(href) {
    let u; try { u = new URL(href, location.href); } catch (e) { return; }
    const job = u.searchParams.get('job'), open = u.searchParams.get('open'), nid = u.searchParams.get('nid');
    if (!job && !nid) return;
    if (href === location.href) { try { history.replaceState(null, '', location.pathname); } catch (e) {} }
    if (nid) markRead([nid]);
    if (!job) return;
    let tries = 0;
    const t = setInterval(() => {                      // wait for the jobs to load
      tries++;
      if (canOpen(job)) {
        clearInterval(t);
        const known = nid && S.items.find(x => x.id === nid);   // use the alert's real type when we have it
        const n = { id: nid || '', job_id: job, kind: known ? known.kind : (open === 'packet' ? 'packet_signed' : open === 'job' ? 'supplement_approved' : 'note'), read_at: 1 };
        openItem(n);
      } else if (tries > 40) clearInterval(t);
    }, 500);
  }
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', e => { if (e.data && e.data.type === 'ss-open') openFromUrl(e.data.url); });
  }

  // ── Start once signed in ────────────────────────────────────────────────
  async function start() {
    if (S.started || !sbc()) return;
    let uid = null;
    try { const { data } = await sbc().auth.getUser(); uid = data && data.user ? data.user.id : null; } catch (e) {}
    if (!uid) return;
    S.started = true; S.uid = uid;
    injectCSS(); bell(); await load(); subscribe();
    registerSW().then(checkPush);
    openFromUrl(location.href);
    // Refresh when coming back to the app (phones pause live updates in the background)
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { load(); try { navigator.clearAppBadge && unread() === 0 && navigator.clearAppBadge(); } catch (e) {} } });
    setInterval(() => { if (S.open) paint(); }, 60000);    // keep "5m" labels fresh
  }
  let tries = 0;
  const boot = setInterval(() => { tries++; if (S.started || tries > 120) { clearInterval(boot); return; } start(); }, 1000);
  setTimeout(start, 300);

  function injectCSS() {
    if ($('ssnNotifCSS')) return;
    const s = document.createElement('style'); s.id = 'ssnNotifCSS';
    s.textContent = `
.ssn-bell{position:relative;width:36px;height:36px;flex:none;border-radius:10px;border:1px solid var(--line,#252B38);background:transparent;color:var(--text-2,#C4CBD8);display:flex;align-items:center;justify-content:center;font-size:19px;cursor:pointer}
.ssn-bell:hover,.ssn-bell.on{background:#10283A;color:#7DD3FC;border-color:#38BDF8}
.ssn-bell-n{position:absolute;top:-6px;right:-6px;min-width:18px;height:18px;padding:0 5px;box-sizing:border-box;border-radius:999px;background:#F87171;color:#fff;font-size:11px;font-weight:700;line-height:18px;text-align:center}
.ssn-bell-n[hidden]{display:none}
@media (max-width:760px){
  /* phone top bar: logo · Search · bell · profile, bell matches the Search box */
  html.ui-new .topnav > div[style*="flex:1"]{display:none}
  html.ui-new .topnav #ssnBell{order:1;width:40px;height:40px;border-radius:12px;background:rgba(255,255,255,0.06);border:1px solid var(--border,#252B38);color:var(--brand-light,#7DD3FC);font-size:20px}
  html.ui-new .topnav .agent-view-wrap{order:2}
  html.ui-new .topnav #ssnBell .ssn-bell-n{top:-5px;right:-5px}
}
@media (min-width:1181px){
  html.ui-new .topnav #ssnBell{position:absolute;top:18px;right:12px;order:0}
  html.ui-new .topnav .logo{margin-right:48px!important}
}
.ssn-np{position:fixed;z-index:700;top:58px;right:12px;width:400px;max-width:calc(100vw - 16px);max-height:min(640px,calc(100vh - 80px));display:flex;flex-direction:column;background:#121A23;color:#E6EDF3;border:1px solid #2A3846;border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,.6);overflow:hidden;font-size:13px}
.ssn-np[hidden]{display:none}
@media (min-width:1181px){.ssn-np{top:12px;left:260px;right:auto}}
@media (max-width:760px){.ssn-np{left:8px;right:8px;width:auto;top:calc(56px + env(safe-area-inset-top));max-height:calc(100vh - 170px)}}
.ssn-np *{box-sizing:border-box}
.ssn-np-h{display:flex;align-items:center;gap:8px;padding:14px 12px 8px 16px}
.ssn-np-title{flex:1;font-size:16px;font-weight:700}
.ssn-np-link{border:0;background:transparent;color:#7DD3FC;font:inherit;font-size:12px;cursor:pointer;padding:6px 4px}
.ssn-np-x{width:32px;height:32px;border-radius:8px;border:0;background:transparent;color:#8E9BAA;font-size:17px;cursor:pointer;display:flex;align-items:center;justify-content:center}
.ssn-np-f{display:flex;gap:6px;padding:0 16px 10px;border-bottom:1px solid #1F2A36;overflow-x:auto;scrollbar-width:none}
.ssn-np-f::-webkit-scrollbar{display:none}
.ssn-np-chip{flex:none;padding:5px 11px;border-radius:999px;border:1px solid #253241;background:transparent;color:#9AA3B5;font:inherit;font-size:12px;cursor:pointer}
.ssn-np-chip.on{background:#1F2D3B;border-color:#1F2D3B;color:#E6EDF3;font-weight:600}
.ssn-np-list{overflow-y:auto;-webkit-overflow-scrolling:touch}
.ssn-np-empty{padding:28px 16px;text-align:center;color:#8E9BAA}
.ssn-np-foot{border-top:1px solid #1F2A36;padding:10px 14px;background:#101820}
.ssn-np-push{display:flex;align-items:center;gap:8px;font-size:13px;color:#C4CBD8}
.ssn-np-push > i{font-size:18px;color:#7DD3FC}
.ssn-np-push.on > i{color:#34D399}
.ssn-np-push.col{flex-direction:column;align-items:flex-start;gap:4px}
.ssn-np-pt{flex:1}
.ssn-np-ps{font-size:12px;color:#8E9BAA;line-height:1.45}
.ssn-np-link.mute{color:#8E9BAA}
.ssn-np-btn{height:34px;padding:0 14px;border-radius:9px;border:0;background:#38BDF8;color:#06202E;font:inherit;font-size:13px;font-weight:700;cursor:pointer}
.ssn-np-btn[disabled]{opacity:.6}
@media (max-width:760px){.ssn-np-btn{height:40px;padding:0 16px;font-size:14px}.ssn-np-push{font-size:14px}}
.ssn-ni{width:100%;display:flex;gap:12px;align-items:flex-start;padding:12px 16px;border:0;border-bottom:1px solid #172029;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
.ssn-ni:hover{background:#16212C}
.ssn-ni.unread{background:#152030}
.ssn-ni-ic{width:34px;height:34px;flex:none;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:17px;background:#1A2430;color:#CBD5E1}
.ssn-ni-ic.mention{background:#10283A;color:#7DD3FC}
.ssn-ni-ic.note{background:#1A2430;color:#CBD5E1}
.ssn-ni-ic.viewed{background:#2E2410;color:#FBBF24}
.ssn-ni-ic.signed{background:#0D2918;color:#34D399}
.ssn-ni-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.ssn-ni-top{display:flex;align-items:baseline;gap:8px}
.ssn-ni-t{flex:1;font-weight:600;font-size:13px}
.ssn-ni-when{font-size:11px;color:#6B7686;white-space:nowrap}
.ssn-ni-b{color:#AEB8C5;line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.ssn-ni-job{font-size:11px;color:#7DD3FC}
.ssn-ni-dot{width:8px;height:8px;flex:none;border-radius:999px;background:#38BDF8;margin-top:6px}
@media (max-width:760px){.ssn-ni{padding:14px 16px}.ssn-ni-t{font-size:15px}.ssn-ni-b{font-size:14px}.ssn-np-chip{padding:8px 14px;font-size:13px}}
.ssn-pop{position:fixed;z-index:800;left:50%;top:calc(10px + env(safe-area-inset-top));transform:translate(-50%,-140%);width:min(420px,calc(100vw - 16px));display:flex;gap:12px;align-items:center;padding:12px 14px;border-radius:16px;border:1px solid #2A3846;background:rgba(22,30,40,.97);color:#E6EDF3;box-shadow:0 18px 40px rgba(0,0,0,.55);font:inherit;font-size:13px;text-align:left;cursor:pointer;transition:transform .28s cubic-bezier(.22,.9,.3,1)}
.ssn-pop.show{transform:translate(-50%,0)}
.ssn-pop .ssn-ni-b{-webkit-line-clamp:2}
@media (prefers-reduced-motion:reduce){.ssn-pop{transition:none}}
`;
    document.head.appendChild(s);
  }
})();
