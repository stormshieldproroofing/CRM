/* StormShield CRM — Job notes.
   Quick, timestamped notes on every job, saved to Supabase (job_notes table).

   Where they show up:
   - Desktop (wide screens), job open: a Notes column docked beside the job
     screen (to its right). "Notes · N" in the job header shows / hides it. "Pop out" turns it
     into a floating panel you can drag around and keep open after closing the job.
   - Phone / tablet, job open: a notes strip on top of the job's bottom action bar
     (latest or pinned note, + to add). Tap it to open the notes sheet.

   Saving:
   - What you type is kept as a draft on this device as you go (per job), so a
     closed screen or dead signal never loses it. Enter (or the send button) posts it.
   - Posted notes are saved to Supabase. If the phone is offline they wait in an
     outbox on the device and send themselves when the connection comes back.
   - "My scratchpad" is a private note that follows you across jobs (only you see it).
   Other people's new notes appear live (Supabase realtime). */
(function () {
  'use strict';
  if (window.__ssNotes) return;
  window.__ssNotes = true;

  const WIDE = '(min-width:1181px)';
  const TAGS = ['Called HO', 'No answer', 'Adjuster mtg', 'Supplement', 'Follow-up'];

  // ── Contacts (replaces the old "Last contact" card) ─────────────────────
  // Logged from the note box (phone button) into the job's contact log (j.contactLog via
  // logContact), so the follow-up warnings keep working. Shown as green cards in the timeline.
  const C_PARTY = [['client', 'Homeowner'], ['adjuster', 'Adjuster'], ['carrier', 'Carrier']];
  const C_METHOD = [['call', 'Call'], ['text', 'Text'], ['email', 'Email'], ['voicemail', 'Voicemail'], ['in-person', 'In person']];
  const C_NEXT = [['none', 'No follow-up'], ['1', 'Tomorrow'], ['3', '3 days'], ['7', '1 week']];
  const C_DIR = [['out', 'Outbound'], ['in', 'Inbound']];
  // When they reached us: "Homeowner called", "Adjuster left a voicemail"
  const C_VERB_IN = { call: 'called', text: 'texted', email: 'emailed', voicemail: 'left a voicemail', 'in-person': 'stopped by' };
  const C_PARTY_NAME = { client: 'Homeowner', adjuster: 'Adjuster', carrier: 'Carrier' };
  const C_VERB = { call: 'Called', text: 'Texted', email: 'Emailed', voicemail: 'Left voicemail for', 'in-person': 'Met with' };
  const C_WHO = { client: 'homeowner', adjuster: 'adjuster', carrier: 'carrier' };
  const C_SHORT = { client: 'HO', adjuster: 'adjuster', carrier: 'carrier' };
  const C_ICON = { call: 'ti-phone', text: 'ti-message-2', email: 'ti-mail', voicemail: 'ti-phone-pause', 'in-person': 'ti-user-check' };
  function contactHead(e) {
    if (e.dir === 'in') return (C_PARTY_NAME[e.party] || 'They') + ' ' + (C_VERB_IN[e.method] || 'reached out');
    return (C_VERB[e.method] || 'Contacted') + ' ' + (C_WHO[e.party] || e.party || '');
  }
  function contactShort(e) {
    if (e.dir === 'in') return (C_SHORT[e.party] === 'HO' ? 'HO' : (C_PARTY_NAME[e.party] || 'They')) + ' ' + (C_VERB_IN[e.method] || 'reached out');
    return (C_VERB[e.method] || 'Contacted') + ' ' + (C_SHORT[e.party] || '');
  }
  function daysAgoTxt(iso) {
    const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
    return isNaN(d) ? '' : d <= 0 ? 'today' : d + 'd';
  }
  function addDays(n) { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }

  // ── @mentions ─────────────────────────────────────────────────────────
  // People you can mention: team members with a CRM login (they get the alert).
  function team() {
    try { return (window.TEAM || []).filter(m => m && m.name && m.authId && m.status !== 'inactive'); } catch (e) { return []; }
  }
  const reEsc = x => String(x).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Names a note can use for each person: full name, plus first name when nobody else shares it
  function mentionNames() {
    const t = team(), firsts = {};
    t.forEach(m => { const f = m.name.trim().split(/\s+/)[0].toLowerCase(); firsts[f] = (firsts[f] || 0) + 1; });
    const out = [];
    t.forEach(m => {
      out.push({ id: m.id, name: m.name.trim() });
      const f = m.name.trim().split(/\s+/)[0];
      if (firsts[f.toLowerCase()] === 1 && f !== m.name.trim()) out.push({ id: m.id, name: f });
    });
    return out.sort((a, b) => b.name.length - a.name.length);   // longest first: "@Sang Nguyen" before "@Sang"
  }
  function findMentions(text) {
    const ids = new Set();
    mentionNames().forEach(n => { if (new RegExp('(^|[^\\w])@' + reEsc(n.name) + '(?![\\w])', 'i').test(text)) ids.add(n.id); });
    if (state.myMemberId) ids.delete(state.myMemberId);
    return Array.from(ids);
  }
  // Escaped note text with @Name highlighted
  function noteText(raw) {
    let h = esc(raw);
    const names = mentionNames();
    if (!names.length || h.indexOf('@') < 0) return h;
    const re = new RegExp('(^|[^\\w])@(' + names.map(n => reEsc(esc(n.name))).join('|') + ')(?![\\w])', 'gi');
    return h.replace(re, (m, pre, nm) => pre + '<span class="ssn-at">@' + nm + '</span>');
  }
  const LS = {
    dock: 'ssNotesDock',          // '1' | '0' — docked column shown beside the job (desktop)
    float: 'ssNotesFloat',        // JSON {x,y,jobId} when popped out
    draft: id => 'ssNoteDraft:' + id,
    cache: id => 'ssNotesCache:' + id,
    outbox: 'ssNotesOutbox',
  };
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } };
  const lsSet = (k, v) => { try { if (v == null || v === '') localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} };
  const lsJSON = (k, d) => { try { return JSON.parse(lsGet(k, '')) || d; } catch (e) { return d; } };
  const wide = () => window.matchMedia(WIDE).matches;
  const sbc = () => window.sb || null;
  const me = () => window.currentMember || {};
  const myName = () => me().name || 'Me';
  const firstName = n => String(n || 'Team').trim().split(/\s+/)[0] || 'Team';
  const initials = n => String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';

  // ── State ───────────────────────────────────────────────────────────────
  const state = {
    menuFor: null,        // note whose Pin / Edit / Delete row is open
    contact: null,        // { party, method, next } while the phone button is on
    jobId: null,          // job whose notes are showing
    notes: {},            // jobId -> array of rows
    loaded: {},           // jobId -> true once fetched
    tab: 'job',           // 'job' | 'pad'
    tag: null,
    sheetOpen: false,     // phone bottom sheet
    floating: false,      // popped-out floating panel (desktop)
    status: '',
    statusKind: 'ok',
    myAuthId: null,
  };
  let channel = null, channelJob = null, padTimer = null, draftTimer = null;

  function jobById(id) { try { return (window.jobs || jobs).find(x => x.id === id) || null; } catch (e) { return null; } }
  function overlayOpen() { const o = $('detailOverlay'); return !!(o && o.classList.contains('open')); }
  function openJob() { try { return overlayOpen() ? (window.openJobId || openJobId || null) : null; } catch (e) { return null; } }

  // ── Data ────────────────────────────────────────────────────────────────
  function cacheSave(jobId) { lsSet(LS.cache(jobId), JSON.stringify((state.notes[jobId] || []).slice(-200))); }
  function outbox() { return lsJSON(LS.outbox, []); }
  function setOutbox(a) { lsSet(LS.outbox, a.length ? JSON.stringify(a) : null); }

  async function myAuth() {
    if (state.myAuthId) return state.myAuthId;
    try { const { data } = await sbc().auth.getUser(); state.myAuthId = data && data.user ? data.user.id : null; } catch (e) {}
    try { const cm = window.currentMember || (team().find(m => m.authId === state.myAuthId)); state.myMemberId = cm ? cm.id : null; } catch (e) {}
    return state.myAuthId;
  }

  async function load(jobId) {
    if (!jobId) return;
    if (!state.notes[jobId]) state.notes[jobId] = lsJSON(LS.cache(jobId), []);
    if (!sbc()) return;
    try {
      const { data, error } = await sbc().from('job_notes').select('*').eq('job_id', jobId).order('created_at', { ascending: true });
      if (error) throw error;
      const pending = (state.notes[jobId] || []).filter(n => n._pending);
      state.notes[jobId] = (data || []).concat(pending);
      state.loaded[jobId] = true;
      cacheSave(jobId);
      render();
      loadLinks(jobId);
    } catch (e) {
      console.warn('[notes] load failed, showing saved copy', e);
    }
  }

  // Packet signing links: when the homeowner opened / signed the link.
  const linkTimes = {};
  async function loadLinks(jobId) {
    try {
      const { data, error } = await sbc().from('packet_links').select('id,created_at,viewed_at,signed_at').eq('job_id', jobId);
      if (error) throw error;
      linkTimes[jobId] = data || [];
      render();
    } catch (e) { console.warn('[notes] packet links', e); }
  }

  function subscribe(jobId) {
    if (!sbc() || channelJob === jobId) return;
    try { if (channel) sbc().removeChannel(channel); } catch (e) {}
    channel = null; channelJob = jobId;
    if (!jobId) return;
    try {
      channel = sbc().channel('job_notes:' + jobId)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'job_notes', filter: 'job_id=eq.' + jobId }, () => load(jobId))
        .subscribe();
    } catch (e) { console.warn('[notes] live updates off', e); }
  }

  async function flushOutbox() {
    const box = outbox();
    if (!box.length || !sbc() || navigator.onLine === false) return;
    const left = [];
    for (const item of box) {
      try {
        const { data, error } = await sbc().from('job_notes')
          .insert({ job_id: item.job_id, body: item.body, tag: item.tag || null, author_name: item.author_name, mentions: item.mentions || [] })
          .select().single();
        if (error) throw error;
        if (!data || !data.id) throw new Error('note saved but not returned');
        const list = state.notes[item.job_id];
        if (list) {
          const i = list.findIndex(n => n.id === item.tmp);
          if (i >= 0) list[i] = data; else list.push(data);
          cacheSave(item.job_id);
        }
      } catch (e) {
        if (e && e.code && /^(23|42)/.test(e.code)) console.warn('[notes] dropped a note the server refused', e);
        else left.push(item);
      }
    }
    setOutbox(left);
    if (box.length !== left.length) setStatus(left.length ? left.length + ' note(s) waiting to send' : 'All notes sent', left.length ? 'warn' : 'ok');
    render();
  }

  async function post(root) {
    const jobId = state.jobId;
    const ta = (root || document).querySelector('.ssn-input');
    const body = ((ta && ta.value) || '').trim();
    if (state.contact) return postContact(ta, body);
    if (!jobId || !body) return;
    const tmp = 'tmp-' + Date.now();
    const row = { id: tmp, job_id: jobId, body, tag: state.tag, pinned: false, author_name: myName(), author_id: state.myAuthId, created_at: new Date().toISOString(), _pending: true };
    (state.notes[jobId] = state.notes[jobId] || []).push(row);
    cacheSave(jobId);
    const ob = outbox(); ob.push({ tmp, job_id: jobId, body, tag: state.tag, author_name: myName(), mentions: findMentions(body) }); setOutbox(ob);
    if (ta) { ta.value = ''; const host = ta.closest('.ssn'); if (host) host.dataset.justPosted = '1'; }
    lsSet(LS.draft(jobId), null);
    state.tag = null;
    setStatus(navigator.onLine === false ? 'Offline — will send when you have signal' : 'Posting…', navigator.onLine === false ? 'warn' : 'busy');
    render(true);
    await flushOutbox();
    if (!outbox().some(o => o.tmp === tmp)) setStatus('Posted · saved to job', 'ok');
    render();
  }

  function postContact(ta, body) {
    const j = jobById(state.jobId), c = state.contact;
    if (!j || !c || typeof window.logContact !== 'function') return;
    const opts = { dir: c.dir === 'in' ? 'in' : 'out' };
    if (c.next && c.next !== 'none') opts.followUp = addDays(parseInt(c.next, 10));
    try { window.logContact(j, c.party, c.method, body, opts); }
    catch (e) { setStatus('Could not log the contact', 'warn'); return; }
    if (ta) { ta.value = ''; const host = ta.closest('.ssn'); if (host) host.dataset.justPosted = '1'; }
    lsSet(LS.draft(state.jobId), null);
    state.contact = null;
    setStatus(contactHead({ party: c.party, method: c.method, dir: c.dir }) + ' · logged', 'ok');
    render(true);
  }

  async function togglePin(id) {
    const list = state.notes[state.jobId] || [];
    const n = list.find(x => x.id === id);
    if (!n || n._pending) return;
    n.pinned = !n.pinned;
    render();
    try {
      const { error } = await sbc().from('job_notes').update({ pinned: n.pinned }).eq('id', id);
      if (error) throw error;
      cacheSave(state.jobId);
    } catch (e) { n.pinned = !n.pinned; setStatus('Could not pin — check your connection', 'warn'); render(); }
  }

  // Edit your own note (text only). The server only lets the author change it.
  let editDraft = null;
  function startEdit(id) {
    const n = (state.notes[state.jobId] || []).find(x => x.id === id);
    if (!n || n._pending) return;
    state.editing = id; editDraft = n.body;
    render();
    setTimeout(() => { const t = document.querySelector('.ssn:not([hidden]) .ssn-edit, .ssn-sheet-wrap.open .ssn-edit'); if (t) { t.focus({ preventScroll: true }); t.setSelectionRange(t.value.length, t.value.length); const card = t.closest('.ssn-card, .ssn-pin') || t; card.scrollIntoView({ block: 'nearest' }); } }, 20);
  }
  function cancelEdit() { state.editing = null; editDraft = null; render(); }
  async function saveEdit(root) {
    const id = state.editing;
    const n = (state.notes[state.jobId] || []).find(x => x.id === id);
    const t = (root || document).querySelector('.ssn-edit');
    const body = ((t && t.value) || '').trim();
    if (!n) return cancelEdit();
    if (!body) { setStatus('A note can\'t be empty — use the trash icon to delete it', 'warn'); return; }
    if (body === n.body) return cancelEdit();
    const old = { body: n.body, edited_at: n.edited_at };
    n.body = body; n.edited_at = new Date().toISOString();
    state.editing = null; editDraft = null;
    render();
    try {
      const { error } = await sbc().from('job_notes').update({ body }).eq('id', id);
      if (error) throw error;
      cacheSave(state.jobId);
      setStatus('Note updated', 'ok');
    } catch (e) {
      Object.assign(n, old);
      setStatus('Could not save the edit — check your connection', 'warn');
      render();
    }
  }

  async function remove(id) {
    const list = state.notes[state.jobId] || [];
    const n = list.find(x => x.id === id);
    if (!n || !confirm('Delete this note?')) return;
    if (n._pending) {
      setOutbox(outbox().filter(o => o.tmp !== id));
    } else {
      try { const { error } = await sbc().from('job_notes').delete().eq('id', id); if (error) throw error; }
      catch (e) { setStatus('Could not delete — check your connection', 'warn'); render(); return; }
    }
    state.notes[state.jobId] = list.filter(x => x.id !== id);
    cacheSave(state.jobId);
    render();
  }

  // Scratchpad (private, one per user, synced across devices).
  // The saved copy lives in the user's account (user_scratchpads). Each time it
  // opens it shows the latest saved copy. The device only holds typing that
  // hasn't reached the server yet (no signal), under that user's own key, and
  // sends it as soon as it can.
  let padText = null, padSaving = false, padSeq = 0;
  const padPendingKey = uid => 'ssPadUnsaved:' + uid;
  function padPending(uid) { return uid ? lsGet(padPendingKey(uid), null) : null; }

  async function loadPad() {
    if (!sbc()) return;
    const uid = await myAuth();
    if (!uid) return;
    const pend = padPending(uid);
    if (pend != null) { padText = pend; render(); pushPad(pend); return; }   // unsent typing wins, then sync it
    const seq = ++padSeq;
    try {
      const { data, error } = await sbc().from('user_scratchpads').select('body').eq('auth_id', uid).maybeSingle();
      if (error) throw error;
      const ta = document.querySelector('.ssn-pad');
      if (seq !== padSeq || (ta && document.activeElement === ta && padText != null)) return;   // don't overwrite while typing
      padText = data ? data.body : '';
      setStatus('', 'ok');
      render();
    } catch (e) {
      if (padText == null) { padText = ''; setStatus('Offline — showing what\'s on this screen', 'warn'); render(); }
    }
  }
  async function pushPad(text) {
    const uid = await myAuth();
    if (!uid) return;
    padSaving = true;
    try {
      const { error } = await sbc().from('user_scratchpads').upsert({ auth_id: uid, body: text, updated_at: new Date().toISOString() });
      if (error) throw error;
      if (padPending(uid) === text) lsSet(padPendingKey(uid), null);
      setStatus('Saved · syncs to all your devices', 'ok', true);
    } catch (e) {
      setStatus('No signal — will save when you\'re back online', 'warn', true);
    } finally { padSaving = false; }
  }
  function savePadSoon(text) {
    padText = text;
    padSeq++;                                   // a load already in flight won't overwrite this
    if (state.myAuthId) lsSet(padPendingKey(state.myAuthId), text);
    setStatus('Saving…', 'busy', true);
    clearTimeout(padTimer);
    padTimer = setTimeout(() => pushPad(text), 700);
  }
  async function flushPad() {
    const uid = await myAuth();
    const pend = padPending(uid);
    if (pend != null && !padSaving) pushPad(pend);
  }

  // ── Status line ─────────────────────────────────────────────────────────
  function setStatus(text, kind, quiet) {
    state.status = text; state.statusKind = kind || 'ok';
    document.querySelectorAll('.ssn-status').forEach(el => {
      el.className = 'ssn-status ' + state.statusKind;
      el.textContent = text;
    });
  }

  // ── Rendering ───────────────────────────────────────────────────────────
  function timeLabel(iso) {
    const d = new Date(iso); if (isNaN(d)) return '';
    const now = new Date();
    const t = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    if (d.toDateString() === now.toDateString()) return 'Today · ' + t;
    const y = new Date(now); y.setDate(now.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return 'Yesterday · ' + t;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' · ' + t;
  }

  // Short, plain wording for the automatic history lines
  function niceDate(v) {
    const m = String(v || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return String(v || '').trim();
    return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  function sysText(e) {
    const label = String(e.label || '').trim();
    const parts = String(e.detail || '').split(/→|->/);
    const to = parts.length > 1 ? parts[parts.length - 1].trim() : '';
    if (/stage changed/i.test(label) && to) return to;
    if (/build date/i.test(label) && to) return /unscheduled|^$/i.test(to) ? 'Build date cleared' : 'Build set for ' + niceDate(to);
    return label + (to ? ': ' + niceDate(to) : (e.detail ? ': ' + e.detail : ''));
  }

  // Money lines in the notes: supplement approved.
  // Read from the job's activity log (the same place stage changes come from).
  function moneyText(e) {
    const label = String(e.label || ''), detail = String(e.detail || '');
    if (e.type === 'accounting' && /^supplement (added|updated)/i.test(label)) {
      const parts = detail.split(/→|->/);
      const after = parts[parts.length - 1].trim();
      const before = parts.length > 1 ? parts[0].trim() : '';
      const m = after.match(/^(\$[\d,.]+)\s*·\s*(Approved|Partial)\b/i);
      if (!m) return '';
      const st = m[2].toLowerCase();
      // An edit that leaves it approved (e.g. a note change) isn't news.
      if (before && new RegExp('·\\s*' + m[2] + '\\b', 'i').test(before) && before.split('·')[0].trim() === m[1]) return '';
      return (st === 'partial' ? 'Supplement partly approved · ' : 'Supplement approved · ') + m[1];
    }
    return '';
  }

  function packetText(e, haveLinks) {
    if (e.type !== 'file') return '';
    const label = String(e.label || ''), detail = String(e.detail || '');
    if (/^claim packet sent for signature/i.test(label)) return 'Packet sent for signature';
    if (/^claim packet signing link resent/i.test(label)) return 'Packet link resent';
    if (/^claim packet signed/i.test(label)) {
      if (/in person/i.test(detail)) return 'Packet signed in person';
      return haveLinks ? '' : 'Packet signed by homeowner';   // link rows give the exact signing time
    }
    if (/^claim packet uploaded/i.test(label)) return 'Signed packet uploaded';
    return '';
  }

  // Checks come from the job's checks list itself (not the activity log), so a check
  // that was removed or corrected later shows once, as it is now.
  function checkItems(j) {
    const deps = (j && Array.isArray(j.deposits) ? j.deposits : []).filter(d => d && d.date);
    // The log has the time of day a check was added; borrow it when the day matches.
    const logged = (j && Array.isArray(j.timeline) ? j.timeline : [])
      .filter(e => e && e.type === 'deposit_add' && e.at).map(e => e.at);
    const used = new Set();
    return deps.map(d => {
      const day = new Date(d.date + (d.time ? ' ' + d.time : ''));
      if (isNaN(day)) return null;
      let at = d.time ? day : new Date(day.getFullYear(), day.getMonth(), day.getDate(), 12);
      if (!d.time) {
        const hit = logged.find(t => !used.has(t) && new Date(t).toDateString() === day.toDateString());
        if (hit) { used.add(hit); at = new Date(hit); }
      }
      const amt = parseFloat(d.amount) || 0;
      const money = '$' + amt.toLocaleString('en-US', { minimumFractionDigits: amt % 1 ? 2 : 0, maximumFractionDigits: 2 });
      return { kind: 'sys', at: at.toISOString(), text: 'Check collected · ' + money + (d.desc ? ' · ' + d.desc : ''), money: true };
    }).filter(Boolean);
  }

  function feedItems(jobId) {
    const notes = (state.notes[jobId] || []).filter(n => n && !n.pinned).map(n => ({ kind: 'note', at: n.created_at, n }));
    const j = jobById(jobId);
    const stages = (j && Array.isArray(j.timeline) ? j.timeline : [])
      .filter(e => e && e.type === 'stage' && e.at)
      .slice(-12)
      .map(e => ({ kind: 'sys', at: e.at, text: sysText(e), stage: /stage changed/i.test(e.label || '') }));
    const money = (j && Array.isArray(j.timeline) ? j.timeline : [])
      .filter(e => e && e.at).map(e => ({ e, text: moneyText(e) })).filter(x => x.text)
      .slice(-20)
      .map(x => ({ kind: 'sys', at: x.e.at, text: x.text, money: true }))
      .concat(checkItems(j));
    const links = linkTimes[jobId] || [];
    const packet = (j && Array.isArray(j.timeline) ? j.timeline : [])
      .filter(e => e && e.at).map(e => ({ at: e.at, text: packetText(e, links.length > 0) })).filter(x => x.text);
    links.forEach(l => {
      if (l.viewed_at) packet.push({ at: l.viewed_at, text: 'Packet opened by homeowner' });
      if (l.signed_at) packet.push({ at: l.signed_at, text: 'Packet signed by homeowner' });
    });
    const packets = packet.slice(-20).map(x => ({ kind: 'sys', at: x.at, text: x.text, packet: true }));
    const contacts = (j && Array.isArray(j.contactLog) ? j.contactLog : [])
      .filter(e => e && e.at).slice(-30)
      .map(e => ({ kind: 'contact', at: e.at, e }));
    return notes.concat(stages, money, packets, contacts).sort((a, b) => new Date(a.at) - new Date(b.at));
  }

  function count(jobId) { return (state.notes[jobId] || []).length; }

  function monthKey(iso) {
    const d = new Date(iso); if (isNaN(d)) return '';
    const now = new Date();
    return d.toLocaleDateString('en-US', d.getFullYear() === now.getFullYear() ? { month: 'long' } : { month: 'long', year: 'numeric' });
  }
  function shortDate(iso) {
    const d = new Date(iso); if (isNaN(d)) return '';
    return d.toLocaleDateString('en-US', d.getFullYear() === new Date().getFullYear() ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: '2-digit' });
  }

  // Timeline row (version 5): date in the left column (shown once per day), then the box.
  // Box header: label on the left, "time · who" on the right; the text underneath.
  function dayKey(iso) { const d = new Date(iso); return isNaN(d) ? '' : d.toDateString(); }
  function dayLabel(iso) {
    const d = new Date(iso); if (isNaN(d)) return '';
    if (d.toDateString() === new Date().toDateString()) return 'Today';
    return shortDate(iso);
  }
  function timeOnly(iso) { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); }
  function dcol(it) { return `<span class="ssn-tl-d">${it.showDay ? esc(dayLabel(it.at)) : ''}</span>`; }

  function noteHTML(it) {
    if (it.kind === 'sys') {
      return `<div class="ssn-tl-sys"><span class="ssn-dot${it.stage ? ' stage' : ''}${it.money ? ' money' : ''}${it.packet ? ' packet' : ''}" aria-hidden="true"></span>${dcol(it)}<span class="ssn-tl-t${it.money ? ' money' : ''}${it.packet ? ' packet' : ''}">${esc(it.text)}</span></div>`;
    }
    if (it.kind === 'contact') {
      const e = it.e;
      const mine = e.by && (e.by === myName() || (state.myMemberId && e.by === state.myMemberId));
      const who = mine ? 'You' : firstName(e.by && e.by !== 'system' ? e.by : 'Team');
      const icon = e.dir === 'in' && (e.method === 'call' || !e.method) ? 'ti-phone-incoming' : (C_ICON[e.method] || 'ti-phone');
      return `<div class="ssn-tl-note"><span class="ssn-dot contact" aria-hidden="true"></span>${dcol(it)}
        <div class="ssn-card contact">
          <div class="ssn-h"><span class="ssn-h-l"><i class="ti ${icon}" aria-hidden="true"></i>${esc(contactHead(e))}</span><span class="ssn-h-r">${esc(timeOnly(e.at))} · ${esc(who)}</span></div>
          ${e.note ? `<div class="ssn-text">${noteText(e.note)}</div>` : ''}
        </div></div>`;
    }
    const n = it.n;
    const mine = n._pending || (state.myAuthId && n.author_id === state.myAuthId);
    const who = mine ? 'You' : firstName(n.author_name);
    if (state.editing === n.id) {
      return `<div class="ssn-tl-note"><span class="ssn-dot note" aria-hidden="true"></span>${dcol(it)}
        <div class="ssn-card mine editing">${editBoxHTML(n)}</div></div>`;
    }
    const open = state.menuFor === n.id;
    return `<div class="ssn-tl-note"><span class="ssn-dot note" aria-hidden="true"></span>${dcol(it)}
      <div class="ssn-card note${mine ? ' mine' : ''}${n._pending ? ' pending' : ''}">
        <div class="ssn-h"><span class="ssn-h-l"><i class="ti ti-pencil" aria-hidden="true"></i>Note</span>
          <span class="ssn-h-r">${n._pending ? 'sending…' : esc(timeOnly(n.created_at)) + ' · ' + esc(who)}${n.edited_at ? ' · <em class="ssn-edited">edited</em>' : ''}</span>
          ${n._pending ? '' : `<button type="button" class="ssn-more${open ? ' on' : ''}" data-menu="${esc(n.id)}" aria-expanded="${open}" aria-label="Note actions"><i class="ti ti-dots" aria-hidden="true"></i></button>`}</div>
        <div class="ssn-text">${noteText(n.body)}</div>
        ${n.tag ? `<span class="ssn-tag">${esc(n.tag)}</span>` : ''}
        ${open ? `<div class="ssn-acts-row">
            <button type="button" class="ssn-link" data-pin="${esc(n.id)}"><i class="ti ti-pin" aria-hidden="true"></i>Pin</button>
            ${mine ? `<button type="button" class="ssn-link" data-edit="${esc(n.id)}"><i class="ti ti-pencil" aria-hidden="true"></i>Edit</button>
            <button type="button" class="ssn-link danger" data-del="${esc(n.id)}"><i class="ti ti-trash" aria-hidden="true"></i>Delete</button>` : ''}
          </div>` : ''}
      </div></div>`;
  }

  function editBoxHTML(n) {
    return `<label class="ssn-sr" for="ssnEdit">Edit note</label>
      <textarea id="ssnEdit" class="ssn-edit" rows="3">${esc(editDraft != null ? editDraft : n.body)}</textarea>
      <div class="ssn-edit-row"><button type="button" class="ssn-btn" data-act="edit-cancel">Cancel</button>
        <button type="button" class="ssn-btn primary" data-act="edit-save">Save</button></div>`;
  }

  // The job's older "Claim notes" field, shown read-only at the top so everything is in one place
  function claimNotesHTML(jobId) {
    const j = jobById(jobId);
    const t = j && String(j.claimNotes || '').trim();
    if (!t) return '';
    return `<div class="ssn-claim"><div class="ssn-claim-h"><i class="ti ti-notes" aria-hidden="true"></i>Claim notes
      <button type="button" class="ssn-link" data-act="editjob">Edit in job</button></div>
      <div class="ssn-text">${esc(t)}</div></div>`;
  }

  function timelineHTML(items) {
    let prev = '';
    items.forEach(it => { const k = dayKey(it.at); it.showDay = k !== prev; prev = k; });
    const out = items.map(noteHTML).join('');
    return `<div class="ssn-tl">${out}</div>`;
  }

  function pinnedHTML(jobId) {
    return (state.notes[jobId] || []).filter(n => n && n.pinned).map(n => state.editing === n.id ? `<div class="ssn-pin editing">${editBoxHTML(n)}</div>` : `
      <div class="ssn-pin">
        <div class="ssn-pin-h"><i class="ti ti-pin-filled" aria-hidden="true"></i>Pinned · ${esc((n._pending || (state.myAuthId && n.author_id === state.myAuthId)) ? 'You' : firstName(n.author_name))}
          <span class="ssn-acts">${(state.myAuthId && n.author_id === state.myAuthId) ? `<button type="button" class="ssn-link" data-edit="${esc(n.id)}">Edit</button>` : ''}
          <button type="button" class="ssn-link" data-pin="${esc(n.id)}">Unpin</button></span></div>
        <div class="ssn-text">${noteText(n.body)}</div>
        ${n.edited_at ? '<div class="ssn-edited-l">edited</div>' : ''}
      </div>`).join('');
  }

  function contactRowsHTML() {
    const c = state.contact;
    const row = (label, key, opts, cur) => `<div class="ssn-crow"><span class="ssn-clab">${label}</span><div class="ssn-cchips">${opts.map(([v, l]) =>
      `<button type="button" class="ssn-chip${cur === v ? ' on' : ''}${key === 'next' && v !== 'none' && cur === v ? ' fu' : ''}" data-c${key}="${esc(v)}" aria-pressed="${cur === v}">${esc(l)}</button>`).join('')}</div></div>`;
    return `<div class="ssn-contact">${row('Way', 'dir', C_DIR, c.dir || 'out')}${row('Who', 'party', C_PARTY, c.party)}${row('How', 'method', C_METHOD, c.method)}${row('Next', 'next', C_NEXT, c.next)}</div>`;
  }

  function bodyHTML(mode) {
    const jobId = state.jobId;
    const j = jobById(jobId);
    const n = count(jobId);
    const pad = state.tab === 'pad';
    const padBtn = `<button type="button" class="ssn-icon${pad ? ' on' : ''}" data-act="pad" aria-pressed="${pad}" aria-label="My scratchpad (private)" title="My scratchpad (private)"><i class="ti ti-notebook" aria-hidden="true"></i></button>`;
    const title = pad ? 'My scratchpad' : (mode === 'float' && j ? esc(j.name || 'Notes') : 'Notes') + (mode === 'sheet' ? '' : ` <span class="ssn-n">${n}</span>`);
    const head = mode === 'sheet'
      ? `<div class="ssn-grab" aria-hidden="true"></div>
         <div class="ssn-head"><div class="ssn-title"><div>${title}</div></div>${padBtn}
           <button type="button" class="ssn-icon" data-act="close" aria-label="Close notes"><i class="ti ti-x" aria-hidden="true"></i></button></div>`
      : `<div class="ssn-head"${mode === 'float' ? ' data-drag="1"' : ''}>
           ${mode === 'float' ? '<i class="ti ti-grip-vertical ssn-grip" aria-hidden="true"></i>' : ''}
           <div class="ssn-title"><div>${title}</div></div>
           ${padBtn}
           ${mode === 'dock' ? '<button type="button" class="ssn-icon" data-act="popout" aria-label="Pop out" title="Pop out"><i class="ti ti-external-link" aria-hidden="true"></i></button>' : ''}
           ${mode === 'float' ? '<button type="button" class="ssn-icon" data-act="openjob" aria-label="Open job"><i class="ti ti-arrow-up-right" aria-hidden="true"></i></button>' : ''}
           <button type="button" class="ssn-icon" data-act="${mode === 'dock' ? 'hide' : 'closefloat'}" aria-label="${mode === 'dock' ? 'Hide notes' : 'Close notes'}"><i class="ti ${mode === 'dock' ? 'ti-chevron-right' : 'ti-x'}" aria-hidden="true"></i></button>
         </div>`;
    if (pad) {
      return head + `<div class="ssn-padwrap">
        <div class="ssn-hint">Only you can see this. It follows you across every job and every device you sign in on.</div>
        <label class="ssn-sr" for="ssnPad">My scratchpad</label>
        <textarea id="ssnPad" class="ssn-pad" placeholder="${padText == null ? 'Loading…' : 'Reminders, calls to make, anything…'}"${padText == null ? ' disabled' : ''}>${esc(padText || '')}</textarea>
        <div class="ssn-status ${state.statusKind}">${esc(state.status || 'Saves as you type')}</div></div>`;
    }
    const items = feedItems(jobId);
    const feed = items.length || claimNotesHTML(jobId) ? timelineHTML(items) : '<div class="ssn-empty">No notes yet. Gate codes, who to call, what the adjuster said: put it here so the whole team knows.</div>';
    const draft = lsGet(LS.draft(jobId), '');
    return head + `
      <div class="ssn-feed">${claimNotesHTML(jobId)}${pinnedHTML(jobId)}${feed}</div>
      <div class="ssn-compose${state.tag || draft ? ' open' : ''}${state.contact ? ' contact' : ''}">
        ${state.contact ? contactRowsHTML() : `<div class="ssn-chips">${TAGS.map(t => `<button type="button" class="ssn-chip${state.tag === t ? ' on' : ''}" data-tag="${esc(t)}" aria-pressed="${state.tag === t}">${esc(t)}</button>`).join('')}</div>`}
        <div class="ssn-mention" role="listbox" aria-label="Mention someone" hidden></div>
        <div class="ssn-row">
          <button type="button" class="ssn-cbtn${state.contact ? ' on' : ''}" data-act="contact" aria-pressed="${!!state.contact}" aria-label="${state.contact ? 'Back to a plain note' : 'Log a call, text or visit'}" title="Log a call, text or visit"><i class="ti ti-phone" aria-hidden="true"></i></button>
          <label class="ssn-sr" for="ssnInput-${mode}">${state.contact ? 'What happened' : 'New note'}</label>
          <textarea id="ssnInput-${mode}" class="ssn-input" rows="2" placeholder="${state.contact ? 'What happened? (optional)' : mode === 'sheet' ? 'Add a note… (@ to mention)' : 'Write a note… @ to mention, Enter to post'}" enterkeyhint="send">${esc(draft)}</textarea>
          <button type="button" class="ssn-send" data-act="post" aria-label="Post note"><i class="ti ti-send" aria-hidden="true"></i></button>
        </div>
        <div class="ssn-status ${state.statusKind}">${esc(state.status || '')}</div>
      </div>`;
  }

  function dockEl() {
    let el = $('ssnDock');
    const ov = $('detailOverlay'), panel = $('detailPanel');
    if (!ov || !panel) return null;
    if (!el) { el = document.createElement('section'); el.id = 'ssnDock'; el.className = 'ssn ssn-dock'; el.setAttribute('aria-label', 'Job notes'); }
    if (el.parentElement !== ov || el.previousElementSibling !== panel) panel.insertAdjacentElement('afterend', el);
    return el;
  }
  function floatEl() {
    let el = $('ssnFloat');
    if (!el) {
      el = document.createElement('section'); el.id = 'ssnFloat'; el.className = 'ssn ssn-float'; el.setAttribute('aria-label', 'Job notes');
      document.body.appendChild(el);
      const pos = lsJSON(LS.float, null);
      if (pos && typeof pos.x === 'number') placeFloat(el, pos.x, pos.y);
    }
    return el;
  }
  function sheetEl() {
    let el = $('ssnSheetWrap');
    if (!el) {
      el = document.createElement('div'); el.id = 'ssnSheetWrap'; el.className = 'ssn-sheet-wrap';
      el.innerHTML = '<div class="ssn-scrim" data-act="close"></div><section class="ssn ssn-sheet" aria-label="Job notes" role="dialog" aria-modal="true"></section>';
      document.body.appendChild(el);
    }
    return el;
  }
  // Phone / tablet: a notes strip that sits on top of the job's bottom action bar
  // (or on its own at the bottom on tabs that have no bar). Tap it to open the
  // notes sheet; tap + to jump straight to writing a note.
  function openSheet(focus) {
    state.sheetOpen = true; state.tab = 'job'; render(true);
    setTimeout(() => {
      const sh = document.querySelector('.ssn-sheet');
      const f = sh && sh.querySelector('.ssn-feed'); if (f) f.scrollTop = f.scrollHeight;
      const t = sh && sh.querySelector('.ssn-input'); if (focus && t) t.focus();
    }, 30);
  }
  function stripHTML() {
    const list = state.notes[state.jobId] || [];
    const pin = list.slice().reverse().find(n => n && n.pinned);
    // Latest note or logged contact, whichever is newer (a pinned note always wins)
    const items = feedItems(state.jobId).filter(it => it.kind !== 'sys');
    const latest = items[items.length - 1];
    let html;
    if (pin) html = '<b class="ssn-strip-pin">Pinned:</b> ' + esc(pin.body);
    else if (latest && latest.kind === 'contact') html = '<b class="ssn-strip-c">' + esc(contactShort(latest.e)) + (latest.e.note ? ':' : '') + '</b> ' + esc(latest.e.note || '');
    else if (latest) html = esc(latest.n.body);
    const n = count(state.jobId);
    return `<span class="ssn-strip-text${html ? '' : ' empty'}">${html ? (n > 1 ? `<span class="ssn-strip-cnt">${n} ·</span> ` : '') + html : 'No notes yet. Tap to add one'}</span>
      <span class="ssn-strip-add" data-add="1" role="button" aria-label="Add a note"><i class="ti ti-plus" aria-hidden="true"></i></span>`;
  }
  function stripEl(bar) {
    let el = $('ssnStrip');
    if (!el) {
      el = document.createElement('button');
      el.id = 'ssnStrip'; el.type = 'button'; el.className = 'ssn-strip';
      el.setAttribute('aria-label', 'Job notes');
      el.addEventListener('click', e => { e.stopPropagation(); openSheet(!!(e.target.closest && e.target.closest('[data-add]'))); });
    }
    const host = bar || $('detailOverlay');
    if (bar) { if (el.parentElement !== bar || bar.firstElementChild !== el) bar.insertBefore(el, bar.firstElementChild); }
    else if (host && el.parentElement !== host) host.appendChild(el);
    el.classList.toggle('solo', !bar);
    return el;
  }
  function placeFloat(el, x, y) {
    const w = el.offsetWidth || 380, h = el.offsetHeight || 560;
    x = Math.max(8, Math.min(window.innerWidth - w - 8, x));
    y = Math.max(8, Math.min(window.innerHeight - Math.min(h, 120), y));
    el.style.left = x + 'px'; el.style.top = y + 'px'; el.style.right = 'auto';
  }

  function headerButton() {
    const panel = $('detailPanel');
    const edit = panel && panel.querySelector('#dpEdit');
    if (!edit) return;
    let b = panel.querySelector('.ssn-hbtn');
    if (!b) {
      b = document.createElement('button');
      b.type = 'button'; b.className = 'ssn-hbtn';
      b.addEventListener('click', e => { e.stopPropagation(); setDock(lsGet(LS.dock, '1') !== '1'); });
      edit.parentElement.insertBefore(b, edit);
    }
    // Only needed while the notes column is hidden: a small icon (with the count) to bring it back.
    // When the column is showing, its own › button hides it, so the header keeps just Edit / ⋯ / ✕.
    const on = lsGet(LS.dock, '1') === '1' && !state.floating;
    const n = count(state.jobId);
    b.hidden = on;
    b.setAttribute('aria-label', 'Show notes' + (n ? ' (' + n + ')' : ''));
    b.title = 'Show notes';
    b.innerHTML = '<i class="ti ti-notes" aria-hidden="true"></i>' + (n ? '<span class="ssn-hbtn-n">' + n + '</span>' : '');
    fitTitle();
  }
  // Desktop job header: the buttons sit in the top-right corner over a centered name, so pad the
  // name on both sides by the buttons' real width (keeps it centered and never covered).
  function contactLine() {
    const panel = $('detailPanel'); const j = jobById(state.jobId);
    if (!panel || !j) return;
    const anchor = panel.querySelector('.dp-status-group');
    let el = panel.querySelector('.ssn-cline');
    if (!anchor) { if (el) el.remove(); return; }
    if (!el) {
      el = document.createElement('button'); el.type = 'button'; el.className = 'ssn-cline';
      el.addEventListener('click', e => { e.stopPropagation(); openForContact(); });
    }
    if (el.previousElementSibling !== anchor) anchor.insertAdjacentElement('afterend', el);
    const lc = typeof window.lastContact === 'function' ? window.lastContact : null;
    const st = typeof window.followUpStatus === 'function' ? (window.followUpStatus(j) || { due: [] }) : { due: [] };
    const over = p => st.due.some(d => d.party === p);
    const part = (label, party) => {
      const e = lc ? lc(j, party) : null;
      return `<span class="${over(party) ? 'bad' : e ? 'ok' : 'none'}">${label} <b>${e ? daysAgoTxt(e.at) : 'never'}</b></span>`;
    };
    const today = new Date().toISOString().slice(0, 10);
    const fu = j.nextFollowUp ? `<span class="${j.nextFollowUp <= today ? 'bad' : 'fu'}">Follow up ${esc(niceDate(j.nextFollowUp))}</span>` : '';
    const ins = (j.pipeline || 'insurance') === 'insurance';
    el.innerHTML = `<i class="ti ti-phone" aria-hidden="true"></i>${part('Homeowner', 'client')}${ins ? '<i class="sep">·</i>' + part('Insurance', 'insurance') : ''}${fu ? '<i class="sep">·</i>' + fu : ''}`;
    el.setAttribute('aria-label', 'Last contact: ' + el.textContent.replace(/\s+/g, ' ').trim() + '. Tap to log a contact.');
  }
  // Open the notes ready to log a contact (phone: sheet; desktop: notes column)
  function openForContact() {
    state.contact = { dir: 'out', party: 'client', method: 'call', next: 'none' };
    state.tab = 'job';
    if (wide()) { lsSet(LS.dock, '1'); state.floating = false; render(true); setTimeout(() => { const t = document.querySelector('#ssnDock .ssn-input'); if (t) t.focus(); }, 30); }
    else openSheet(false);
  }

  function fitTitle() {
    const panel = $('detailPanel'); if (!panel) return;
    const tg = panel.querySelector('.rd-job .dp-title-group, .dp-title-group');
    const g = panel.querySelector('.dp-name-row > div:last-child');
    if (!tg || !g) return;
    if (!window.matchMedia('(min-width:761px)').matches || getComputedStyle(g).position !== 'absolute') { tg.style.paddingLeft = tg.style.paddingRight = ''; return; }
    const w = Math.ceil(g.getBoundingClientRect().width) + 16;
    tg.style.paddingLeft = tg.style.paddingRight = w + 'px';
  }
  window.addEventListener('resize', () => { try { fitTitle(); } catch (e) {} });

  let lastScrollKey = '';
  function render(scrollToEnd) {
    const jobInModal = openJob();
    if (jobInModal && jobInModal !== state.jobId) switchJob(jobInModal);
    const isWide = wide();
    const dockOn = isWide && !!jobInModal && lsGet(LS.dock, '1') === '1' && !state.floating;
    const floatOn = isWide && state.floating && !!state.jobId;
    const sheetMode = !isWide && !!jobInModal;

    // Dock
    const dock = jobInModal ? dockEl() : $('ssnDock');
    if (dock) {
      dock.hidden = !dockOn;
      if (dockOn) paint(dock, 'dock', scrollToEnd);
    }
    document.documentElement.classList.toggle('ssn-docked', dockOn);
    if (jobInModal) contactLine();
    if (jobInModal && isWide) headerButton(); else if (jobInModal) fitTitle();

    // Floating
    const fl = floatOn ? floatEl() : $('ssnFloat');
    if (fl) { fl.hidden = !floatOn; if (floatOn) paint(fl, 'float', scrollToEnd); }

    // Phone / tablet: notes strip on top of the action bar
    const bar = sheetMode ? document.querySelector('#detailPanel .rd-qa-bar') : null;
    const strip = sheetMode ? stripEl(bar) : $('ssnStrip');
    if (strip) {
      strip.hidden = !sheetMode;
      if (sheetMode) strip.innerHTML = stripHTML();
    }
    document.documentElement.classList.toggle('ssn-strip-solo', !!(sheetMode && !bar));
    const wrap = sheetMode && state.sheetOpen ? sheetEl() : $('ssnSheetWrap');
    if (wrap) {
      const on = sheetMode && state.sheetOpen;
      wrap.classList.toggle('open', on);
      if (on) paint(wrap.querySelector('.ssn-sheet'), 'sheet', scrollToEnd);
    }
  }

  function paint(el, mode, scrollToEnd) {
    const active = document.activeElement;
    const hadFocus = active && el.contains(active) && (active.classList.contains('ssn-input') || active.classList.contains('ssn-pad'));
    const caret = hadFocus ? [active.selectionStart, active.selectionEnd, active.className, active.value] : null;
    const oldInput = el.querySelector('.ssn-input');
    const keepDraft = oldInput && el.dataset.job === String(state.jobId) ? oldInput.value : null;
    const oldEdit = el.querySelector('.ssn-edit');
    if (oldEdit && state.editing) editDraft = oldEdit.value;
    const editFocused = oldEdit && active === oldEdit;
    const oldFeed = el.querySelector('.ssn-feed');
    const oldTop = oldFeed ? oldFeed.scrollTop : 0;
    const atEnd = !oldFeed || oldFeed.scrollTop + oldFeed.clientHeight >= oldFeed.scrollHeight - 30;
    el.innerHTML = bodyHTML(mode);
    el.dataset.job = String(state.jobId);
    if (keepDraft != null && !el.dataset.justPosted) { const ni = el.querySelector('.ssn-input'); if (ni) ni.value = keepDraft; }
    delete el.dataset.justPosted;
    const feed = el.querySelector('.ssn-feed');
    const key = mode + ':' + state.jobId;
    if (feed && state.editing && key === lastScrollKey) feed.scrollTop = oldTop;
    else if (feed && (scrollToEnd || atEnd || key !== lastScrollKey)) feed.scrollTop = feed.scrollHeight;
    if (editFocused) { const ne = el.querySelector('.ssn-edit'); if (ne) ne.focus(); }
    lastScrollKey = key;
    if (caret) {
      const t = el.querySelector(caret[2].indexOf('ssn-pad') >= 0 ? '.ssn-pad' : '.ssn-input');
      if (t) { t.value = caret[3]; t.focus(); try { t.setSelectionRange(caret[0], caret[1]); } catch (e) {} }
    }
  }

  function switchJob(jobId) {
    state.jobId = jobId;
    state.editing = null; editDraft = null; state.contact = null; state.menuFor = null;
    state.tag = null;
    state.status = '';
    if (jobId) { load(jobId); subscribe(jobId); }
  }

  function setDock(on) {
    lsSet(LS.dock, on ? '1' : '0');
    if (on) state.floating = false;
    render(true);
  }

  // ── Events (delegated) ──────────────────────────────────────────────────
  function inNotes(t) { return t && t.closest && t.closest('.ssn, .ssn-sheet-wrap'); }

  document.addEventListener('click', e => {
    const root = inNotes(e.target);
    if (!root) return;
    e.stopPropagation();   // keep clicks from reaching the job overlay (which closes the job)
    const b = e.target.closest('[data-act],[data-tab],[data-tag],[data-pin],[data-del],[data-edit],[data-cparty],[data-cmethod],[data-cnext],[data-cdir],[data-menu]');
    if (!b) return;
    if (b.dataset.tab) { state.tab = b.dataset.tab; state.status = ''; if (state.tab === 'pad') loadPad(); render(); return; }
    if (b.dataset.menu) { state.menuFor = state.menuFor === b.dataset.menu ? null : b.dataset.menu; render(); return; }
    if (b.dataset.pin || b.dataset.edit || b.dataset.del) state.menuFor = null;
    if (b.dataset.cparty || b.dataset.cmethod || b.dataset.cnext || b.dataset.cdir) {
      if (state.contact) {
        if (b.dataset.cdir) state.contact.dir = b.dataset.cdir;
        if (b.dataset.cparty) state.contact.party = b.dataset.cparty;
        if (b.dataset.cmethod) state.contact.method = b.dataset.cmethod;
        if (b.dataset.cnext) state.contact.next = b.dataset.cnext;
      }
      render(); if (wide()) { const t = root.querySelector('.ssn-input'); if (t) t.focus({ preventScroll: true }); } return;
    }
    if (b.dataset.tag) { state.tag = state.tag === b.dataset.tag ? null : b.dataset.tag; render(); const t = root.querySelector('.ssn-input'); if (t) t.focus(); return; }
    if (b.dataset.pin) { togglePin(b.dataset.pin); return; }
    if (b.dataset.del) { remove(b.dataset.del); return; }
    if (b.dataset.edit) { startEdit(b.dataset.edit); return; }
    switch (b.dataset.act) {
      case 'pad': state.tab = state.tab === 'pad' ? 'job' : 'pad'; state.status = ''; if (state.tab === 'pad') loadPad(); render(true); break;
      case 'post': post(root); break;
      case 'contact': {
        state.contact = state.contact ? null : { dir: 'out', party: 'client', method: 'call', next: 'none' }; state.status = '';
        // Phone: keep the keyboard down so Who / How / Next are visible; type after picking.
        if (!wide() && document.activeElement && document.activeElement.blur) document.activeElement.blur();
        render();
        if (wide()) { const t = root.querySelector('.ssn-input'); if (t) t.focus({ preventScroll: true }); }
        break;
      }
      case 'edit-save': saveEdit(root); break;
      case 'edit-cancel': cancelEdit(); break;
      case 'editjob': if (typeof window.openEditJob === 'function' && state.jobId) { state.sheetOpen = false; render(); window.openEditJob(state.jobId); } break;
      case 'close': state.sheetOpen = false; render(); break;
      case 'hide': setDock(false); break;
      case 'popout': {
        state.floating = true; lsSet(LS.dock, '0');
        const d = $('ssnDock'); const r = d ? d.getBoundingClientRect() : null;
        render();
        const f = $('ssnFloat'); if (f && r) { placeFloat(f, r.left, r.top + 40); lsSet(LS.float, JSON.stringify({ x: r.left, y: r.top + 40 })); }
        break;
      }
      case 'closefloat': state.floating = false; render(); break;
      case 'openjob': if (state.jobId && typeof window.openDetail === 'function') { state.floating = false; lsSet(LS.dock, '1'); window.openDetail(state.jobId); } break;
    }
  }, true);

  function mentionQuery(t) {
    const upto = t.value.slice(0, t.selectionStart);
    const m = upto.match(/(^|\s)@([A-Za-z][\w'-]*(?: [A-Za-z][\w'-]*)?)?$/);
    return m ? { q: (m[2] || ''), start: upto.length - (m[2] || '').length - 1 } : null;
  }
  function mentionSuggest(t) {
    const box = t.closest('.ssn-compose') && t.closest('.ssn-compose').querySelector('.ssn-mention');
    if (!box) return;
    const mq = mentionQuery(t);
    const me = state.myMemberId;
    const list = mq ? team().filter(m => m.id !== me && (!mq.q || m.name.toLowerCase().split(/\s+/).some(w => w.startsWith(mq.q.toLowerCase().split(' ')[0])) || m.name.toLowerCase().startsWith(mq.q.toLowerCase()))).slice(0, 6) : [];
    if (!list.length) { box.hidden = true; box.innerHTML = ''; return; }
    box.innerHTML = list.map((m, i) => `<button type="button" role="option" class="ssn-mopt${i === 0 ? ' on' : ''}" data-mention="${esc(m.id)}"><span class="ssn-av">${esc(initials(m.name))}</span>${esc(m.name)}<span class="ssn-mrole">${esc(m.role || '')}</span></button>`).join('');
    box.hidden = false;
  }
  function pickMention(t, memberId) {
    const m = team().find(x => x.id === memberId); if (!m) return;
    const mq = mentionQuery(t); if (!mq) return;
    const before = t.value.slice(0, mq.start), after = t.value.slice(t.selectionStart);
    const ins = '@' + m.name.trim() + ' ';
    t.value = before + ins + after.replace(/^\s+/, '');
    const pos = (before + ins).length;
    t.focus(); t.setSelectionRange(pos, pos);
    const box = t.closest('.ssn-compose').querySelector('.ssn-mention'); if (box) { box.hidden = true; box.innerHTML = ''; }
    t.dispatchEvent(new Event('input', { bubbles: true }));
  }
  // keep the keyboard up and the caret in place when tapping a name
  document.addEventListener('pointerdown', e => {
    const o = e.target.closest && e.target.closest('.ssn-mopt');
    if (!o) return;
    e.preventDefault();
    const t = o.closest('.ssn-compose').querySelector('.ssn-input');
    if (t) pickMention(t, o.dataset.mention);
  }, true);

  document.addEventListener('input', e => {
    const t = e.target;
    if (!t || !t.classList) return;
    if (t.classList.contains('ssn-input')) {
      mentionSuggest(t);
      const id = state.jobId, v = t.value;
      setStatus('Saving draft…', 'busy');
      clearTimeout(draftTimer);
      draftTimer = setTimeout(() => { lsSet(LS.draft(id), v.trim() ? v : null); setStatus(v.trim() ? 'Draft saved on this device' : 'Drafts save as you type', 'ok'); }, 350);
    } else if (t.classList.contains('ssn-pad')) {
      savePadSoon(t.value);
    }
  });

  document.addEventListener('keydown', e => {
    const t = e.target;
    if (t && t.classList && t.classList.contains('ssn-input')) {
      const box = t.closest('.ssn-compose') && t.closest('.ssn-compose').querySelector('.ssn-mention');
      if (box && !box.hidden) {
        const opts = Array.from(box.querySelectorAll('[data-mention]'));
        let i = opts.findIndex(o => o.classList.contains('on'));
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); opts.forEach(o => o.classList.remove('on')); i = (i + (e.key === 'ArrowDown' ? 1 : -1) + opts.length) % opts.length; opts[i].classList.add('on'); return; }
        if ((e.key === 'Enter' || e.key === 'Tab') && opts.length) { e.preventDefault(); pickMention(t, (opts[i] || opts[0]).dataset.mention); return; }
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); box.hidden = true; return; }
      }
    }
    if (t && t.classList && t.classList.contains('ssn-input') && e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault(); post(t.closest('.ssn'));
    }
    if (t && t.classList && t.classList.contains('ssn-edit')) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelEdit(); return; }
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); saveEdit(t.closest('.ssn')); return; }
    }
    if (e.key === 'Escape' && state.sheetOpen) { state.sheetOpen = false; render(); }
  });

  // Phone: swipe the notes sheet down to close it. Starts from the handle / header, or from
  // the list when it's scrolled to the top; the note box and the sideways chip rows are left alone.
  (function sheetSwipe() {
    let sh = null, sy = 0, sx = 0, dy = 0, armed = false, mode = '', samples = [];
    const reset = () => { if (!sh) return; sh.style.transition = ''; sh.style.transform = ''; const sc = document.querySelector('.ssn-sheet-wrap .ssn-scrim'); if (sc) { sc.style.transition = ''; sc.style.opacity = ''; } };
    document.addEventListener('touchstart', e => {
      armed = false; mode = '';
      const t = e.target; sh = t.closest && t.closest('.ssn-sheet');
      if (!sh || e.touches.length !== 1 || !state.sheetOpen) return;
      if (t.closest('.ssn-compose, textarea, input, .ssn-cchips, .ssn-chips, .ssn-edit')) return;
      const feed = sh.querySelector('.ssn-feed');
      const inHead = !!t.closest('.ssn-head, .ssn-grab');
      if (!inHead && feed && feed.contains(t) && feed.scrollTop > 0) return;
      sy = e.touches[0].clientY; sx = e.touches[0].clientX; dy = 0; samples = [[sy, performance.now()]]; armed = true;
    }, { passive: true, capture: true });
    document.addEventListener('touchmove', e => {
      if (!armed) return;
      const t = e.touches[0], my = t.clientY - sy, mx = t.clientX - sx;
      if (!mode) {
        if (Math.abs(my) < 8 && Math.abs(mx) < 8) return;
        const feed = sh.querySelector('.ssn-feed');
        if (my > 0 && my > Math.abs(mx) * 1.2 && (!feed || feed.scrollTop <= 0 || e.target.closest('.ssn-head, .ssn-grab'))) mode = 'down';
        else { armed = false; return; }
      }
      e.preventDefault();
      dy = Math.max(0, my);
      const now = performance.now(); samples.push([t.clientY, now]); while (samples.length > 2 && now - samples[0][1] > 90) samples.shift();
      sh.style.transition = 'none'; sh.style.transform = `translateY(${dy}px)`;
      const sc = document.querySelector('.ssn-sheet-wrap .ssn-scrim'); if (sc) { sc.style.transition = 'none'; sc.style.opacity = String(Math.max(0, 1 - dy / 500)); }
    }, { passive: false, capture: true });
    const end = () => {
      if (!armed) return; armed = false;
      if (mode !== 'down') return;
      const [y0, t0] = samples[0], [y1, t1] = samples[samples.length - 1];
      const v = (y1 - y0) / Math.max(1, t1 - t0);
      const close = dy > Math.min(160, sh.offsetHeight * 0.25) || (v > 0.5 && dy > 40);
      if (!close) { sh.style.transition = 'transform .2s ease'; sh.style.transform = ''; const sc = document.querySelector('.ssn-sheet-wrap .ssn-scrim'); if (sc) { sc.style.transition = 'opacity .2s'; sc.style.opacity = ''; } setTimeout(reset, 220); return; }
      sh.style.transition = 'transform .18s ease-in'; sh.style.transform = `translateY(${sh.offsetHeight}px)`;
      setTimeout(() => { reset(); state.sheetOpen = false; render(); }, 180);
    };
    document.addEventListener('touchend', end, { passive: true, capture: true });
    document.addEventListener('touchcancel', () => { armed = false; reset(); }, { passive: true, capture: true });
  })();

  // Tapping a tag chip keeps the keyboard up (chips only show while writing)
  document.addEventListener('pointerdown', e => {
    if (e.target.closest && e.target.closest('.ssn-chip')) e.preventDefault();
  }, true);

  // Drag the floating panel by its header
  document.addEventListener('pointerdown', e => {
    const h = e.target.closest && e.target.closest('.ssn-float [data-drag]');
    if (!h || e.target.closest('button')) return;
    const f = $('ssnFloat'); const r = f.getBoundingClientRect();
    const dx = e.clientX - r.left, dy = e.clientY - r.top;
    const move = ev => placeFloat(f, ev.clientX - dx, ev.clientY - dy);
    const up = () => {
      document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up);
      lsSet(LS.float, JSON.stringify({ x: parseFloat(f.style.left) || 0, y: parseFloat(f.style.top) || 0 }));
    };
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
    e.preventDefault();
  });

  // ── Hooks into the CRM ──────────────────────────────────────────────────
  function hook() {
    const fn = window.renderDetailPanel;
    if (typeof fn === 'function' && !fn.__ssn) {
      const wrapped = function () {
        const r = fn.apply(this, arguments);
        try { render(); } catch (e) { console.warn('[notes] render skipped', e); }
        return r;
      };
      Object.keys(fn).forEach(k => { wrapped[k] = fn[k]; });
      wrapped.__ssn = true;
      window.renderDetailPanel = wrapped;
    }
  }

  // Open a job with its notes showing (desktop: notes column; phone: notes sheet)
  window.ssOpenJobNotes = function (jobId) {
    if (!jobId || typeof window.openDetail !== 'function' || !jobById(jobId)) return false;
    if (wide()) { lsSet(LS.dock, '1'); state.floating = false; }
    state.tab = 'job';
    window.openDetail(jobId);
    if (!wide()) setTimeout(() => openSheet(false), 60);
    else setTimeout(() => render(true), 60);
    return true;
  };

  function init() {
    injectCSS();
    hook();
    setTimeout(hook, 0);   // after other files wrap it
    const ov = $('detailOverlay');
    if (ov) new MutationObserver(() => {
      if (!overlayOpen()) { state.sheetOpen = false; document.documentElement.classList.remove('ssn-docked'); }
      render();
    }).observe(ov, { attributes: true, attributeFilter: ['class'] });
    window.matchMedia(WIDE).addEventListener('change', () => render());
    window.addEventListener('online', () => { flushOutbox(); flushPad(); });
    // Coming back to the app: pick up scratchpad changes made on another device
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      flushPad();
      if (state.tab === 'pad' && !document.querySelector('.ssn-pad:focus')) loadPad();
    });
    lsSet('ssScratchpad', null);   // old shared-device copy (not tied to a user); the account copy is the real one
    myAuth().then(() => render());
    setTimeout(() => { flushOutbox(); flushPad(); }, 3000);
    render();
  }

  // ── Styles ──────────────────────────────────────────────────────────────
  function injectCSS() {
    if ($('ssnCSS')) return;
    const s = document.createElement('style'); s.id = 'ssnCSS';
    s.textContent = `
.ssn{--n-bg:#121A23;--n-bg2:#0E141B;--n-line:#253241;--n-text:#E6EDF3;--n-mute:#8E9BAA;--n-accent:#38BDF8;--n-accent-soft:#10283A;
  box-sizing:border-box;background:var(--n-bg);color:var(--n-text);display:flex;flex-direction:column;font-size:13px;min-height:0}
.ssn *{box-sizing:border-box}
.ssn[hidden]{display:none!important}
.ssn-dock{width:360px;flex:none;height:100%;margin-left:10px;border:1px solid var(--n-line);border-radius:18px;overflow:hidden;box-shadow:0 24px 70px rgba(0,0,0,.5);animation:ssnIn .18s ease}
@keyframes ssnIn{from{opacity:0;transform:translateX(-12px)}to{opacity:1;transform:none}}
.ssn-float{position:fixed;right:24px;top:80px;width:380px;height:min(640px,calc(100vh - 100px));z-index:120;border:1px solid #2A3846;border-radius:14px;overflow:hidden;box-shadow:0 24px 60px rgba(0,0,0,.6)}
.ssn-head{display:flex;align-items:center;gap:8px;padding:14px 14px 10px;border-bottom:1px solid var(--n-line)}
.ssn-float .ssn-head{cursor:move;background:#141E28;touch-action:none}
.ssn-grip{color:#5B6B7B;font-size:16px}
.ssn-title{flex:1;min-width:0;font-size:15px;font-weight:600}
.ssn-title>div{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ssn-n{color:var(--n-mute);font-weight:400}
.ssn-sub{font-size:12px;color:var(--n-mute);font-weight:400;margin-top:2px}
.ssn-icon{width:32px;height:32px;border-radius:8px;border:0;background:transparent;color:var(--n-mute);display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:17px;flex:none}
.ssn-icon:hover,.ssn-text-btn:hover{background:#1A2430;color:var(--n-text)}
.ssn-text-btn{height:30px;padding:0 8px;border-radius:8px;border:0;background:transparent;color:var(--n-mute);display:flex;align-items:center;gap:5px;cursor:pointer;font-size:12px}
.ssn-tabs{display:flex;gap:2px;padding:0 12px;border-bottom:1px solid var(--n-line)}
.ssn-tab{padding:9px 10px;border:0;border-bottom:2px solid transparent;background:transparent;color:var(--n-mute);font-size:13px;cursor:pointer}
.ssn-tab.on{color:var(--n-text);border-bottom-color:var(--n-accent);font-weight:600}
.ssn-feed{flex:1;min-height:0;overflow-y:auto;padding:12px 14px;display:flex;flex-direction:column;gap:12px;-webkit-overflow-scrolling:touch}
.ssn-empty{color:var(--n-mute);font-size:13px;line-height:1.5;padding:18px 4px;text-align:center}
.ssn-pin{padding:10px 12px;border-radius:10px;background:#2A2210;border:1px solid #5A4614}
.ssn-pin-h{display:flex;align-items:center;gap:6px;font-size:11px;color:#FCD34D;font-weight:600;letter-spacing:.02em}
.ssn-pin .ssn-link{margin-left:auto;color:#FCD34D}
.ssn-pin .ssn-text{color:#FEF3C7;margin-top:4px}
.ssn-item{display:flex;gap:10px}
.ssn-item.pending{opacity:.65}
.ssn-av{width:28px;height:28px;flex:none;border-radius:999px;background:#1F3A4F;color:#7DD3FC;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700}
.ssn-av.me{background:#233240;color:#CBD5E1}
.ssn-av.sys{background:#1A2430;color:var(--n-mute);font-size:13px}
.ssn-main{flex:1;min-width:0}
.ssn-meta{display:flex;align-items:baseline;gap:6px;font-size:12px;color:var(--n-mute)}
.ssn-meta b{color:var(--n-text);font-weight:600}
.ssn-acts{margin-left:auto;display:flex;gap:2px;opacity:.85}
.ssn-link{border:0;background:transparent;color:var(--n-mute);font-size:11px;padding:2px 5px;border-radius:5px;cursor:pointer}
.ssn-link:hover{color:var(--n-text);background:#1A2430}
.ssn-text{font-size:13px;line-height:1.45;margin-top:2px;white-space:pre-wrap;word-wrap:break-word}
.ssn-item.sys .ssn-text{color:var(--n-mute)}
.ssn-tag{display:inline-block;margin-top:5px;padding:2px 7px;border-radius:999px;background:var(--n-accent-soft);color:#7DD3FC;font-size:11px}
.ssn-compose{border-top:1px solid var(--n-line);padding:10px 14px 12px;background:#101820;display:flex;flex-direction:column;gap:8px}
.ssn-chips{display:flex;gap:6px;flex-wrap:wrap}
.ssn-chip{padding:4px 9px;border-radius:999px;font-size:11px;cursor:pointer;border:1px solid var(--n-line);background:transparent;color:var(--n-mute)}
.ssn-chip.on{border-color:var(--n-accent);background:var(--n-accent-soft);color:#7DD3FC}
.ssn-row{display:flex;gap:8px;align-items:flex-end}
.ssn-input,.ssn-pad{flex:1;resize:none;padding:10px 12px;border-radius:10px;border:1px solid var(--n-line);background:var(--n-bg2);color:var(--n-text);font:inherit;font-size:13px;line-height:1.45}
.ssn-input{height:62px}
.ssn-input:focus,.ssn-pad:focus{outline:2px solid var(--n-accent);outline-offset:-2px}
.ssn-send{width:38px;height:38px;flex:none;border-radius:10px;border:0;background:var(--n-accent);color:#06202E;font-size:17px;display:flex;align-items:center;justify-content:center;cursor:pointer}
.ssn-status{font-size:11px;color:#4ADE80;display:flex;align-items:center;gap:6px}
.ssn-status:before{content:"";width:6px;height:6px;border-radius:999px;background:currentColor}
.ssn-status.busy{color:#FBBF24}.ssn-status.warn{color:#FB923C}
.ssn-padwrap{flex:1;min-height:0;display:flex;flex-direction:column;gap:8px;padding:12px 14px}
.ssn-hint{font-size:12px;color:var(--n-mute)}
.ssn-pad{min-height:0;height:100%}
.ssn-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.ssn-hbtn{position:relative;width:36px;height:36px;padding:0;border-radius:10px;border:1px solid var(--line,#253241);background:var(--panel-2,#181D27);color:#7DD3FC;display:flex;align-items:center;justify-content:center;font-size:18px;cursor:pointer;flex-shrink:0}
.ssn-hbtn[hidden]{display:none!important}
.ssn-hbtn:hover{background:#10283A;border-color:#38BDF8}
.ssn-hbtn-n{position:absolute;top:-6px;right:-6px;min-width:17px;height:17px;padding:0 4px;box-sizing:border-box;border-radius:999px;background:#38BDF8;color:#06202E;font-size:10px;font-weight:700;line-height:17px;text-align:center}
.ssn-strip[hidden]{display:none!important}
.ssn-strip{grid-column:1/-1;display:flex;align-items:center;gap:10px;width:100%;min-height:52px;padding:6px 6px 6px 8px;margin:0 0 4px;border:0;border-bottom:1px solid rgba(255,255,255,0.07);border-radius:12px 12px 0 0;background:transparent;color:#E8ECF3;text-align:left;cursor:pointer;font:inherit}
.ssn-strip-ic{position:relative;width:30px;height:30px;flex:none;border-radius:9px;background:#10283A;color:#38BDF8;display:flex;align-items:center;justify-content:center;font-size:17px}
.ssn-strip-ic.pin{background:#2A2210;color:#FCD34D}
.ssn-strip-n{position:absolute;top:-6px;right:-7px;min-width:17px;height:17px;padding:0 4px;box-sizing:border-box;border-radius:999px;background:#38BDF8;color:#06202E;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;line-height:1}
.ssn-strip-text{flex:1;min-width:0;padding-left:4px;font-size:14px;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.ssn-strip-text.empty{color:#8B94A7}
.ssn-strip-add{width:40px;height:40px;flex:none;border-radius:999px;background:#38BDF8;color:#06202E;display:flex;align-items:center;justify-content:center;font-size:20px}
.ssn-strip.solo{position:fixed;left:10px;right:10px;bottom:calc(10px + env(safe-area-inset-bottom));z-index:130;width:auto;margin:0;padding:8px 8px 8px 10px;border:1px solid rgba(255,255,255,0.07);border-radius:18px;background:rgba(18,22,30,0.96);box-shadow:0 10px 30px rgba(0,0,0,0.45);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px)}
html.ssn-strip-solo .dp-body{padding-bottom:calc(90px + env(safe-area-inset-bottom))!important}
.ssn-sheet-wrap{position:fixed;inset:0;z-index:140;display:none}
.ssn-sheet-wrap.open{display:block}
.ssn-scrim{position:absolute;inset:0;background:rgba(0,0,0,.55)}
.ssn-sheet{position:absolute;left:0;right:0;bottom:0;margin:0 auto;max-width:560px;height:min(82vh,680px);border-top:1px solid #2A3846;border-radius:20px 20px 0 0;padding-bottom:env(safe-area-inset-bottom);box-shadow:0 -20px 50px rgba(0,0,0,.5);animation:ssnUp .2s ease}
@keyframes ssnUp{from{transform:translateY(40px);opacity:.4}to{transform:none;opacity:1}}
.ssn-grab{width:38px;height:5px;border-radius:999px;background:#3A4A5A;margin:8px auto 0}
.ssn-sheet .ssn-head{padding:8px 16px 10px}
.ssn-sheet .ssn-icon{width:44px;height:44px;border-radius:12px;background:#1A2430;color:#CBD5E1;font-size:20px}
.ssn-sheet .ssn-tab{padding:11px 12px;font-size:14px}
.ssn-sheet .ssn-feed{padding:12px 16px}
.ssn-sheet .ssn-text{font-size:14px}
.ssn-sheet .ssn-link{font-size:12px;padding:6px 8px}
.ssn-sheet .ssn-compose{padding:10px 16px 14px}
.ssn-sheet .ssn-chips{flex-wrap:nowrap;overflow-x:auto;-webkit-overflow-scrolling:touch}
.ssn-sheet .ssn-chip{flex:none;height:34px;padding:0 12px;font-size:13px}
.ssn-sheet .ssn-input{height:48px;font-size:16px;border-radius:24px;padding:12px 16px}
.ssn-sheet .ssn-send{width:48px;height:48px;border-radius:999px;font-size:20px}
.ssn-sheet .ssn-pad{font-size:16px}
.ssn-icon.on{background:#10283A;color:#7DD3FC}
.ssn-compose .ssn-chips{display:none}
.ssn-compose:focus-within .ssn-chips,.ssn-compose.open .ssn-chips{display:flex}
.ssn-compose .ssn-status:empty,.ssn-compose .ssn-status.ok{display:none}
.ssn-tl{position:relative;padding-left:18px;padding-top:2px}
.ssn-tl:before{content:"";position:absolute;left:4px;top:6px;bottom:6px;width:2px;background:#1F2A36;border-radius:2px}
.ssn-tl-m{font-size:11px;color:#6B7686;text-transform:uppercase;letter-spacing:.08em;margin:14px 0 4px}
.ssn-tl-m:first-child{margin-top:2px}
.ssn-dot{position:absolute;left:-18px;width:10px;height:10px;border-radius:999px;background:#3A4A5A;border:2px solid var(--n-bg);box-sizing:content-box;margin-left:-1px}
.ssn-dot.stage{background:#8B5CF6}
.ssn-dot.money{background:#F59E0B}
.ssn-tl-t.money{color:#FCD34D;font-weight:600}
.ssn-dot.packet{background:#2DD4BF}
.ssn-tl-t.packet{color:#5EEAD4;font-weight:600}
.ssn-dot.note{background:#38BDF8;top:14px}
.ssn-tl-sys{position:relative;display:flex;gap:10px;align-items:baseline;padding:4px 0;font-size:13px;color:#8E9BAA}
.ssn-tl-sys .ssn-dot{top:7px}
.ssn-tl-d{width:46px;flex:none;font-size:12px;color:#6B7686}
.ssn-tl-t{min-width:0}
.ssn-tl-note{position:relative;margin:6px 0 8px}
.ssn-card{padding:10px 12px 8px;border-radius:12px;background:#172230;border:1px solid #22344A}
.ssn-card.mine{background:#14202C;border-color:#1E3A52}
.ssn-card.pending{opacity:.65}
.ssn-card .ssn-text{font-size:14px;margin:0}
.ssn-card .ssn-meta{margin-top:6px;align-items:center}
.ssn-card .ssn-tag{margin-top:6px}
.ssn-link i{font-size:13px;margin-right:2px;vertical-align:-2px}
.ssn-pin{margin-bottom:6px}
.ssn-sheet .ssn-tl-sys{font-size:14px}
.ssn-sheet .ssn-card .ssn-text{font-size:15px}
.ssn-edit{width:100%;min-height:72px;resize:vertical;padding:9px 11px;border-radius:9px;border:1px solid var(--n-accent);background:var(--n-bg2);color:var(--n-text);font:inherit;font-size:14px;line-height:1.45}
.ssn-edit:focus{outline:none}
.ssn-edit-row{display:flex;justify-content:flex-end;gap:8px;margin-top:8px}
.ssn-btn{height:32px;padding:0 14px;border-radius:8px;border:1px solid var(--n-line);background:transparent;color:var(--n-text);font-size:13px;cursor:pointer}
.ssn-btn.primary{border-color:var(--n-accent);background:var(--n-accent);color:#06202E;font-weight:600}
.ssn-edited{font-style:normal;color:#6B7686}
.ssn-edited-l{font-size:11px;color:#A38A4A;margin-top:4px}
.ssn-pin.editing{background:#14202C;border-color:#1E3A52}
.ssn-pin-h .ssn-acts{margin-left:auto}
.ssn-pin-h .ssn-acts .ssn-link{color:#FCD34D;margin-left:0}
.ssn-claim{padding:10px 12px;border-radius:10px;background:#141A22;border:1px dashed #2A3846;margin-bottom:6px}
.ssn-claim-h{display:flex;align-items:center;gap:6px;font-size:11px;color:#8E9BAA;font-weight:600;text-transform:uppercase;letter-spacing:.06em}
.ssn-claim-h .ssn-link{margin-left:auto;text-transform:none;letter-spacing:0;font-weight:500}
.ssn-claim .ssn-text{color:#C4CBD8;margin-top:4px}
.ssn-sheet .ssn-btn{height:40px;padding:0 18px;font-size:15px}
.ssn-sheet .ssn-edit{font-size:16px}
.ssn-at{color:#7DD3FC;font-weight:600}
.ssn-compose{position:relative}
.ssn-mention{position:absolute;left:12px;right:12px;bottom:calc(100% - 4px);z-index:5;background:#1A2430;border:1px solid #2A3846;border-radius:12px;box-shadow:0 12px 30px rgba(0,0,0,.5);padding:4px;display:flex;flex-direction:column}
.ssn-mention[hidden]{display:none}
.ssn-mopt{display:flex;align-items:center;gap:10px;min-height:40px;padding:6px 8px;border:0;border-radius:8px;background:transparent;color:var(--n-text);font:inherit;font-size:14px;text-align:left;cursor:pointer}
.ssn-mopt.on,.ssn-mopt:hover{background:#22344A}
.ssn-mopt .ssn-av{width:26px;height:26px}
.ssn-mrole{margin-left:auto;font-size:11px;color:var(--n-mute);text-transform:capitalize}
.ssn-sheet .ssn-mopt{min-height:48px;font-size:16px}
.ssn-cbtn{width:38px;height:38px;flex:none;border-radius:999px;border:1px solid var(--n-line);background:#1A2430;color:#CBD5E1;font-size:18px;display:flex;align-items:center;justify-content:center;cursor:pointer}
.ssn-cbtn.on{border-color:#34D399;background:#0E1A14;color:#34D399}
.ssn-contact{display:flex;flex-direction:column;gap:7px}
.ssn-crow{display:flex;align-items:center;gap:8px}
.ssn-clab{width:36px;flex:none;font-size:10px;color:var(--n-mute);text-transform:uppercase;letter-spacing:.06em}
.ssn-cchips{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;flex:1;min-width:0}
.ssn-cchips::-webkit-scrollbar{display:none}
.ssn-cchips .ssn-chip{flex:none}
.ssn-compose.contact .ssn-chip.on{border-color:#34D399;background:#0E1A14;color:#A7F3D0}
.ssn-compose.contact .ssn-chip.on.fu{border-color:#FBBF24;background:#2A2210;color:#FCD34D}
.ssn-dot.contact{background:#10B981}
.ssn-card.contact{background:#0E1A14;border-color:#1F4A33}
.ssn-c-head{display:flex;align-items:center;gap:6px;font-size:13px;font-weight:600;color:#A7F3D0}
.ssn-c-head i{font-size:14px;color:#34D399}
.ssn-card.contact .ssn-text{margin-top:3px}
.ssn-strip-cnt{color:#8B94A7;font-weight:600}
.ssn-strip-pin{color:#FCD34D;font-weight:600}
.ssn-strip-c{color:#A7F3D0;font-weight:600}
.ssn-cline{display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:6px;margin:8px auto 2px;padding:6px 12px;border-radius:999px;border:1px solid var(--line,#253241);background:rgba(14,20,27,.7);color:#C4CBD8;font:inherit;font-size:12px;cursor:pointer;max-width:100%}
.ssn-cline:hover{border-color:#34D399}
.ssn-cline > .ti{color:#34D399;font-size:14px}
.ssn-cline .sep{font-style:normal;color:#3A4A5A}
.ssn-cline .ok b{color:#A7F3D0}.ssn-cline .bad b,.ssn-cline span.bad{color:#FCA5A5}.ssn-cline .none b{color:#8B94A7;font-weight:500}.ssn-cline .fu{color:#FBBF24}
.ssn-sheet .ssn-cbtn{width:46px;height:46px;font-size:20px}
.ssn-sheet .ssn-crow .ssn-chip{height:34px}
@media (max-width:760px){.ssn-cline{font-size:13px;padding:7px 12px}}
.ssn-tl-note{display:flex;gap:10px;align-items:flex-start}
.ssn-dot.contact,.ssn-dot.note{top:14px}
.ssn-tl-note > .ssn-tl-d{padding-top:10px}
.ssn-tl-note > .ssn-card{flex:1;min-width:0}
.ssn-tl-d{width:46px;flex:none;font-size:12px;color:#6B7686;white-space:nowrap}
.ssn-card.note{background:#14202C;border-color:#1E3A52}
.ssn-card.note.mine{background:#14202C}
.ssn-h{display:flex;align-items:center;gap:6px;min-width:0}
.ssn-h-l{display:flex;align-items:center;gap:6px;min-width:0;font-size:13px;font-weight:600;color:#7DD3FC;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ssn-card.contact .ssn-h-l{color:#A7F3D0}
.ssn-h-l .ti{font-size:14px;flex:none}
.ssn-card.contact .ssn-h-l .ti{color:#34D399}
.ssn-card.note .ssn-h-l .ti{color:#38BDF8}
.ssn-h-l .ssn-tag{margin:0 0 0 2px;font-weight:500}
.ssn-h-r{margin-left:auto;flex:none;font-size:12px;color:#8E9BAA;white-space:nowrap}
.ssn-more{width:28px;height:24px;margin-right:-6px;flex:none;border:0;border-radius:6px;background:transparent;color:#8E9BAA;display:flex;align-items:center;justify-content:center;font-size:16px;cursor:pointer}
.ssn-more:hover,.ssn-more.on{background:#1F2D3B;color:#E6EDF3}
.ssn-card .ssn-text{margin-top:4px}
.ssn-acts-row{display:flex;gap:4px;margin-top:8px;padding-top:6px;border-top:1px solid #22344A}
.ssn-acts-row .ssn-link{font-size:12px;padding:5px 8px}
.ssn-acts-row .ssn-link.danger{color:#FCA5A5}
.ssn-sheet .ssn-acts-row .ssn-link{font-size:14px;padding:8px 10px}
.ssn-sheet .ssn-more{width:34px;height:26px;margin:-3px -6px -3px 0;font-size:18px}
.ssn-sheet .ssn-tl-d{font-size:13px;width:50px}
@media (min-width:1181px){html.ssn-docked.ui-new .detail-overlay{align-items:stretch}}
@media (max-width:1180px){.ssn-hbtn{display:none}}
`;
    document.head.appendChild(s);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
