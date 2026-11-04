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
  const LS = {
    dock: 'ssNotesDock',          // '1' | '0' — docked column shown beside the job (desktop)
    float: 'ssNotesFloat',        // JSON {x,y,jobId} when popped out
    draft: id => 'ssNoteDraft:' + id,
    cache: id => 'ssNotesCache:' + id,
    outbox: 'ssNotesOutbox',
    pad: 'ssScratchpad',
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
  let channel = null, channelJob = null, padTimer = null, draftTimer = null, padLoaded = false;

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
    } catch (e) {
      console.warn('[notes] load failed, showing saved copy', e);
    }
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
          .insert({ job_id: item.job_id, body: item.body, tag: item.tag || null, author_name: item.author_name })
          .select().single();
        if (error) throw error;
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
    if (!jobId || !body) return;
    const tmp = 'tmp-' + Date.now();
    const row = { id: tmp, job_id: jobId, body, tag: state.tag, pinned: false, author_name: myName(), author_id: state.myAuthId, created_at: new Date().toISOString(), _pending: true };
    (state.notes[jobId] = state.notes[jobId] || []).push(row);
    cacheSave(jobId);
    const ob = outbox(); ob.push({ tmp, job_id: jobId, body, tag: state.tag, author_name: myName() }); setOutbox(ob);
    if (ta) { ta.value = ''; const host = ta.closest('.ssn'); if (host) host.dataset.justPosted = '1'; }
    lsSet(LS.draft(jobId), null);
    state.tag = null;
    setStatus(navigator.onLine === false ? 'Offline — will send when you have signal' : 'Posting…', navigator.onLine === false ? 'warn' : 'busy');
    render(true);
    await flushOutbox();
    if (!outbox().some(o => o.tmp === tmp)) setStatus('Posted · saved to job', 'ok');
    render();
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

  // Scratchpad (private)
  async function loadPad() {
    if (padLoaded || !sbc()) return;
    padLoaded = true;
    try {
      const { data } = await sbc().from('user_scratchpads').select('body').maybeSingle();
      const local = lsGet(LS.pad, null);
      if (data && local == null) { lsSet(LS.pad, data.body); render(); }
    } catch (e) {}
  }
  function savePadSoon(text) {
    lsSet(LS.pad, text);
    setStatus('Saving…', 'busy', true);
    clearTimeout(padTimer);
    padTimer = setTimeout(async () => {
      try {
        const { error } = await sbc().from('user_scratchpads').upsert({ auth_id: await myAuth(), body: text, updated_at: new Date().toISOString() });
        if (error) throw error;
        setStatus('Saved · just now', 'ok', true);
      } catch (e) { setStatus('Saved on this device · will sync later', 'warn', true); }
    }, 800);
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
    if (/stage changed/i.test(label) && to) return 'Moved to ' + to;
    if (/build date/i.test(label) && to) return /unscheduled|^$/i.test(to) ? 'Build date cleared' : 'Build set for ' + niceDate(to);
    return label + (to ? ': ' + niceDate(to) : (e.detail ? ': ' + e.detail : ''));
  }

  function feedItems(jobId) {
    const notes = (state.notes[jobId] || []).filter(n => !n.pinned).map(n => ({ kind: 'note', at: n.created_at, n }));
    const j = jobById(jobId);
    const stages = (j && Array.isArray(j.timeline) ? j.timeline : [])
      .filter(e => e && e.type === 'stage' && e.at)
      .slice(-12)
      .map(e => ({ kind: 'sys', at: e.at, text: sysText(e), stage: /stage changed/i.test(e.label || '') }));
    return notes.concat(stages).sort((a, b) => new Date(a.at) - new Date(b.at));
  }

  function count(jobId) { return (state.notes[jobId] || []).length; }

  function monthKey(iso) {
    const d = new Date(iso); if (isNaN(d)) return '';
    const now = new Date();
    return d.toLocaleDateString('en-US', d.getFullYear() === now.getFullYear() ? { month: 'long' } : { month: 'long', year: 'numeric' });
  }
  function shortDate(iso) { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }

  function noteHTML(it) {
    if (it.kind === 'sys') {
      return `<div class="ssn-tl-sys"><span class="ssn-dot${it.stage ? ' stage' : ''}" aria-hidden="true"></span><span class="ssn-tl-d">${esc(shortDate(it.at))}</span><span class="ssn-tl-t">${esc(it.text)}</span></div>`;
    }
    const n = it.n;
    const mine = n._pending || (state.myAuthId && n.author_id === state.myAuthId);
    const who = mine ? 'You' : firstName(n.author_name);
    return `<div class="ssn-tl-note"><span class="ssn-dot note" aria-hidden="true"></span>
      <div class="ssn-card${mine ? ' mine' : ''}${n._pending ? ' pending' : ''}">
        <div class="ssn-text">${esc(n.body)}</div>
        ${n.tag ? `<span class="ssn-tag">${esc(n.tag)}</span>` : ''}
        <div class="ssn-meta"><span>${esc(who)} · ${n._pending ? 'sending…' : esc(timeLabel(n.created_at))}</span>
          <span class="ssn-acts">
            ${n._pending ? '' : `<button type="button" class="ssn-link" data-pin="${esc(n.id)}" aria-label="Pin note"><i class="ti ti-pin" aria-hidden="true"></i>Pin</button>`}
            ${mine ? `<button type="button" class="ssn-link" data-del="${esc(n.id)}" aria-label="Delete note"><i class="ti ti-trash" aria-hidden="true"></i></button>` : ''}
          </span></div>
      </div></div>`;
  }

  function timelineHTML(items) {
    let out = '', month = '';
    items.forEach(it => {
      const m = monthKey(it.at);
      if (m && m !== month) { month = m; out += `<div class="ssn-tl-m">${esc(m)}</div>`; }
      out += noteHTML(it);
    });
    return `<div class="ssn-tl">${out}</div>`;
  }

  function pinnedHTML(jobId) {
    return (state.notes[jobId] || []).filter(n => n.pinned).map(n => `
      <div class="ssn-pin">
        <div class="ssn-pin-h"><i class="ti ti-pin-filled" aria-hidden="true"></i>Pinned · ${esc((n._pending || (state.myAuthId && n.author_id === state.myAuthId)) ? 'You' : firstName(n.author_name))}
          <button type="button" class="ssn-link" data-pin="${esc(n.id)}">Unpin</button></div>
        <div class="ssn-text">${esc(n.body)}</div>
      </div>`).join('');
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
        <div class="ssn-hint">Only you can see this. It follows you across every job.</div>
        <label class="ssn-sr" for="ssnPad">My scratchpad</label>
        <textarea id="ssnPad" class="ssn-pad" placeholder="Reminders, calls to make, anything…">${esc(lsGet(LS.pad, ''))}</textarea>
        <div class="ssn-status ${state.statusKind}">${esc(state.status || 'Saves as you type')}</div></div>`;
    }
    const items = feedItems(jobId);
    const feed = items.length ? timelineHTML(items) : '<div class="ssn-empty">No notes yet. Gate codes, who to call, what the adjuster said: put it here so the whole team knows.</div>';
    const draft = lsGet(LS.draft(jobId), '');
    return head + `
      <div class="ssn-feed">${pinnedHTML(jobId)}${feed}</div>
      <div class="ssn-compose${state.tag || draft ? ' open' : ''}">
        <div class="ssn-chips">${TAGS.map(t => `<button type="button" class="ssn-chip${state.tag === t ? ' on' : ''}" data-tag="${esc(t)}" aria-pressed="${state.tag === t}">${esc(t)}</button>`).join('')}</div>
        <div class="ssn-row">
          <label class="ssn-sr" for="ssnInput-${mode}">New note</label>
          <textarea id="ssnInput-${mode}" class="ssn-input" rows="2" placeholder="${mode === 'sheet' ? 'Add a note…' : 'Write a note… (Enter to post)'}" enterkeyhint="send">${esc(draft)}</textarea>
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
    const pin = list.slice().reverse().find(n => n.pinned);
    const last = list[list.length - 1];
    const show = pin || last;
    const n = count(state.jobId);
    return `<span class="ssn-strip-ic${pin ? ' pin' : ''}"><i class="ti ${pin ? 'ti-pin-filled' : 'ti-notes'}" aria-hidden="true"></i>${n ? `<span class="ssn-strip-n">${n}</span>` : ''}</span>
      <span class="ssn-strip-text${show ? '' : ' empty'}">${esc(show ? show.body : 'No notes yet. Tap to add one')}</span>
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
    const on = lsGet(LS.dock, '1') === '1' && !state.floating;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
    b.innerHTML = '<i class="ti ti-notes" aria-hidden="true"></i>Notes · ' + count(state.jobId);
  }

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
    if (jobInModal && isWide) headerButton();

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
    const oldFeed = el.querySelector('.ssn-feed');
    const atEnd = !oldFeed || oldFeed.scrollTop + oldFeed.clientHeight >= oldFeed.scrollHeight - 30;
    el.innerHTML = bodyHTML(mode);
    el.dataset.job = String(state.jobId);
    if (keepDraft != null && !el.dataset.justPosted) { const ni = el.querySelector('.ssn-input'); if (ni) ni.value = keepDraft; }
    delete el.dataset.justPosted;
    const feed = el.querySelector('.ssn-feed');
    const key = mode + ':' + state.jobId;
    if (feed && (scrollToEnd || atEnd || key !== lastScrollKey)) feed.scrollTop = feed.scrollHeight;
    lastScrollKey = key;
    if (caret) {
      const t = el.querySelector(caret[2].indexOf('ssn-pad') >= 0 ? '.ssn-pad' : '.ssn-input');
      if (t) { t.value = caret[3]; t.focus(); try { t.setSelectionRange(caret[0], caret[1]); } catch (e) {} }
    }
  }

  function switchJob(jobId) {
    state.jobId = jobId;
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
    const b = e.target.closest('[data-act],[data-tab],[data-tag],[data-pin],[data-del]');
    if (!b) return;
    if (b.dataset.tab) { state.tab = b.dataset.tab; state.status = ''; if (state.tab === 'pad') loadPad(); render(); return; }
    if (b.dataset.tag) { state.tag = state.tag === b.dataset.tag ? null : b.dataset.tag; render(); const t = root.querySelector('.ssn-input'); if (t) t.focus(); return; }
    if (b.dataset.pin) { togglePin(b.dataset.pin); return; }
    if (b.dataset.del) { remove(b.dataset.del); return; }
    switch (b.dataset.act) {
      case 'pad': state.tab = state.tab === 'pad' ? 'job' : 'pad'; state.status = ''; if (state.tab === 'pad') loadPad(); render(true); break;
      case 'post': post(root); break;
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

  document.addEventListener('input', e => {
    const t = e.target;
    if (!t || !t.classList) return;
    if (t.classList.contains('ssn-input')) {
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
    if (t && t.classList && t.classList.contains('ssn-input') && e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault(); post(t.closest('.ssn'));
    }
    if (e.key === 'Escape' && state.sheetOpen) { state.sheetOpen = false; render(); }
  });

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
    window.addEventListener('online', flushOutbox);
    myAuth().then(() => render());
    setTimeout(flushOutbox, 3000);
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
.ssn-hbtn{height:36px;padding:0 12px;border-radius:10px;border:1px solid var(--line,#253241);background:transparent;color:var(--text-2,#C4CBD8);display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer;flex-shrink:0}
.ssn-hbtn.on{border-color:#38BDF8;background:#10283A;color:#7DD3FC}
.ssn-strip[hidden]{display:none!important}
.ssn-strip{grid-column:1/-1;display:flex;align-items:center;gap:10px;width:100%;min-height:52px;padding:6px 6px 6px 8px;margin:0 0 4px;border:0;border-bottom:1px solid rgba(255,255,255,0.07);border-radius:12px 12px 0 0;background:transparent;color:#E8ECF3;text-align:left;cursor:pointer;font:inherit}
.ssn-strip-ic{position:relative;width:30px;height:30px;flex:none;border-radius:9px;background:#10283A;color:#38BDF8;display:flex;align-items:center;justify-content:center;font-size:17px}
.ssn-strip-ic.pin{background:#2A2210;color:#FCD34D}
.ssn-strip-n{position:absolute;top:-6px;right:-7px;min-width:17px;height:17px;padding:0 4px;box-sizing:border-box;border-radius:999px;background:#38BDF8;color:#06202E;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;line-height:1}
.ssn-strip-text{flex:1;min-width:0;font-size:14px;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
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
.ssn-tl{position:relative;padding-left:18px}
.ssn-tl:before{content:"";position:absolute;left:4px;top:6px;bottom:6px;width:2px;background:#1F2A36;border-radius:2px}
.ssn-tl-m{font-size:11px;color:#6B7686;text-transform:uppercase;letter-spacing:.08em;margin:14px 0 4px}
.ssn-tl-m:first-child{margin-top:2px}
.ssn-dot{position:absolute;left:-18px;width:10px;height:10px;border-radius:999px;background:#3A4A5A;border:2px solid var(--n-bg);box-sizing:content-box;margin-left:-1px}
.ssn-dot.stage{background:#8B5CF6}
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
@media (min-width:1181px){html.ssn-docked.ui-new .detail-overlay{align-items:stretch}}
@media (max-width:1180px){.ssn-hbtn{display:none}}
`;
    document.head.appendChild(s);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
