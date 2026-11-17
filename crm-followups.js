/* ============================================================
   StormShield CRM — Summary "Follow-ups" (manual list)
   ------------------------------------------------------------
   The Follow-ups panel only lists jobs somebody put there.
   Nothing is added automatically any more.

   A follow-up is:
     job.nextFollowUp   'YYYY-MM-DD'  — the day to follow up
     job.followUp       { need, note, noteAt, noteBy, by, at, done[] }
       need   what is needed ("Adjuster: supplement")
       note   the latest update, shown under the row
       done   finished follow-ups ({ need, note, at, by }), newest last

   job.followUp is kept in the contract JSON (__followUp), like the
   other small per-job records — no new database column.
   ============================================================ */

(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.crmFollowUps = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  const hasDOM = typeof document !== 'undefined';
  const DONE_KEEP = 30;
  const DEFAULT_NEED = 'Follow up';

  // What a follow-up can need, grouped by who the ball is with.
  const NEEDS = [
    { group: 'Insurance', items: ['Adjuster: loss statement', 'Adjuster: supplement', 'Adjuster: inspection date', 'Carrier: depreciation release', 'Carrier: claim payment'] },
    { group: 'Office', items: ['Submit supplement', 'Submit final invoice', 'Send completion certificate'] },
    { group: 'Homeowner', items: ['Sign packet or contract', 'Collect deductible', 'Collect insurance check', 'Schedule build'] },
  ];

  const pad = n => String(n).padStart(2, '0');
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // ── Pure helpers ─────────────────────────────────────────────

  // Local-date key, "YYYY-MM-DD" (not UTC: 7pm in Houston is still today).
  function dayKey(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function keyDate(key) {
    const p = String(key).split('-').map(Number);
    return new Date(p[0], p[1] - 1, p[2]);
  }
  function validKey(key) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(key || ''))) return false;
    return dayKey(keyDate(key)) === key;
  }
  function addDays(key, n) {
    const d = keyDate(key);
    d.setDate(d.getDate() + n);
    return dayKey(d);
  }
  // Whole days from key a to key b (b later = positive).
  function daysBetween(a, b) {
    return Math.round((keyDate(b) - keyDate(a)) / 86400000);
  }
  function clean(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }

  // What the date badge shows: weekday + day within a week either way, month + day beyond that.
  function badge(key, today) {
    const d = keyDate(key), diff = daysBetween(today, key);
    return {
      top: Math.abs(diff) <= 6 ? DOW[d.getDay()] : MON[d.getMonth()],
      day: d.getDate(),
      late: diff < 0,
      lateDays: diff < 0 ? -diff : 0,
      today: diff === 0,
    };
  }
  function niceDay(key, today) {
    const diff = daysBetween(today, key), d = keyDate(key);
    if (diff === 0) return 'today';
    if (diff === 1) return 'tomorrow';
    return DOW[d.getDay()] + ', ' + MON[d.getMonth()] + ' ' + d.getDate();
  }

  function needOf(job) {
    return clean(job && job.followUp && job.followUp.need) || DEFAULT_NEED;
  }

  // The newest note on the job: the follow-up's own note or the latest logged contact that has one.
  function lastUpdate(job) {
    let best = null;
    const f = job && job.followUp;
    if (f && clean(f.note)) best = { text: clean(f.note), at: f.noteAt || f.at || '', by: f.noteBy || f.by || '' };
    (Array.isArray(job && job.contactLog) ? job.contactLog : []).forEach(e => {
      if (!e || !clean(e.note)) return;
      if (!best || String(e.at || '') > String(best.at || '')) best = { text: clean(e.note), at: e.at || '', by: e.by || '' };
    });
    return best;
  }

  // Sort the jobs into the three lists the panel shows.
  //   todo      due today or earlier, most overdue first
  //   upcoming  due later, soonest first
  //   done      finished today, newest first
  function build(jobs, opts) {
    const o = opts || {};
    const today = o.today || dayKey(new Date());
    const isClosed = o.isClosed || (() => false);
    const todo = [], upcoming = [], done = [];
    (jobs || []).forEach(job => {
      if (!job) return;
      const fu = job.followUp;
      (fu && Array.isArray(fu.done) ? fu.done : []).forEach(entry => {
        if (entry && entry.at && dayKey(new Date(entry.at)) === today) done.push({ job, entry });
      });
      if (!validKey(job.nextFollowUp) || isClosed(job)) return;
      (job.nextFollowUp <= today ? todo : upcoming).push({ job, date: job.nextFollowUp });
    });
    const byDate = (a, b) => a.date.localeCompare(b.date) || String(a.job.name || '').localeCompare(String(b.job.name || ''));
    todo.sort(byDate);
    upcoming.sort(byDate);
    done.sort((a, b) => String(b.entry.at).localeCompare(String(a.entry.at)));
    return { today, todo, upcoming, done };
  }

  function rec(job) {
    if (!job.followUp || typeof job.followUp !== 'object') job.followUp = {};
    return job.followUp;
  }

  // Put a job on the list (or change what it needs / when).
  function setFollowUp(job, o) {
    if (!job || !o || !validKey(o.date)) return false;
    const f = rec(job), now = o.now || new Date().toISOString();
    job.nextFollowUp = o.date;
    if (o.need !== undefined) f.need = clean(o.need) || DEFAULT_NEED;
    else if (!clean(f.need)) f.need = DEFAULT_NEED;
    if (clean(o.note)) { f.note = clean(o.note); f.noteAt = now; f.noteBy = o.by || ''; }
    if (!f.at) { f.at = now; f.by = o.by || ''; }
    return true;
  }

  // Move the follow-up to another day; what it needs stays.
  function reschedule(job, date) {
    if (!job || !validKey(date)) return false;
    job.nextFollowUp = date;
    const f = rec(job);
    if (!clean(f.need)) f.need = DEFAULT_NEED;
    return true;
  }

  // Take the job off the list and remember it under "Done today".
  function complete(job, o) {
    if (!job) return null;
    const opt = o || {}, f = rec(job), now = opt.now || new Date().toISOString();
    const entry = { need: needOf(job), note: clean(opt.note), at: now, by: opt.by || '' };
    if (!Array.isArray(f.done)) f.done = [];
    f.done.push(entry);
    if (f.done.length > DONE_KEEP) f.done = f.done.slice(-DONE_KEEP);
    if (entry.note) { f.note = entry.note; f.noteAt = now; f.noteBy = entry.by; }
    delete f.need; delete f.at; delete f.by;
    delete job.nextFollowUp;
    return entry;
  }

  // Undo a "done": back on today's list with the same need.
  function reopen(job, at, today) {
    const f = job && job.followUp;
    if (!f || !Array.isArray(f.done)) return false;
    const i = f.done.findIndex(e => e && e.at === at);
    if (i < 0) return false;
    const entry = f.done.splice(i, 1)[0];
    job.nextFollowUp = today || dayKey(new Date());
    f.need = entry.need || DEFAULT_NEED;
    return true;
  }

  // ── Browser side ─────────────────────────────────────────────

  const ui = { view: 'todo', pick: null, jobs: [] };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function me() {
    const m = root.currentMember;
    return (m && (m.name || m.id)) || '';
  }
  function stageOf(job) {
    try {
      if (typeof root.columnsForPipeline !== 'function') return null;
      return root.columnsForPipeline(job.pipeline || 'insurance').find(c => c.id === job.col) || null;
    } catch (e) { return null; }
  }
  function isClosed(job) { const c = stageOf(job); return !c || !!c.closed; }
  function findJob(id) {
    const all = Array.isArray(root.jobs) ? root.jobs : ui.jobs;
    return all.find(j => String(j.id) === String(id)) || ui.jobs.find(j => String(j.id) === String(id)) || null;
  }
  function persist(job, label, detail) {
    try { if (typeof root.logActivity === 'function') root.logActivity(job, 'followup', label, detail || ''); } catch (e) {}
    try { if (typeof root.saveToStorage === 'function') root.saveToStorage(); } catch (e) {}
    refresh();
  }
  function refresh() {
    try { if (typeof root.renderBoardSalesSummary === 'function') root.renderBoardSalesSummary(); } catch (e) {}
  }
  function say(msg) { try { if (typeof root.toast === 'function') root.toast(msg); } catch (e) {} }
  function timeOf(iso) {
    const d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }
  function shortDate(iso, today) {
    const d = new Date(iso);
    if (isNaN(d)) return '';
    const key = dayKey(d);
    return key === today ? 'Today' : MON[d.getMonth()] + ' ' + d.getDate();
  }

  function injectCss() {
    if (!hasDOM || document.getElementById('ssFollowUpsCss')) return;
    const st = document.createElement('style');
    st.id = 'ssFollowUpsCss';
    st.textContent = `
.sm-fu2 .sm-panel-head{align-items:flex-start}
.fu2-add{height:40px;padding:0 14px;border-radius:999px;border:none;background:rgba(77,157,224,.14);color:var(--brand-light);font:inherit;font-size:13px;font-weight:600;display:inline-flex;align-items:center;gap:6px;cursor:pointer;flex-shrink:0}
.fu2-add .ti{font-size:16px}
.fu2-item{padding:10px 4px 12px;border-top:1px solid rgba(255,255,255,.05)}
.fu2-list > .fu2-item:first-child{border-top:none}
.fu2-item .sm-fu-row{padding:0;border-top:none;border-radius:8px}
.fu2-item .sm-fu-row:hover{background:none}
.fu2-date{width:44px;height:44px;flex-shrink:0;border-radius:12px;border:1px solid rgba(96,165,250,.33);background:rgba(96,165,250,.1);color:#60A5FA;display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1.1;padding:0;font:inherit;cursor:pointer}
.fu2-date span{font-size:10px;font-weight:700;text-transform:uppercase}
.fu2-date b{font-size:16px;font-weight:700}
.fu2-date.late{border-color:rgba(248,113,113,.33);background:rgba(248,113,113,.1);color:#F87171}
.fu2-date.done{border-color:rgba(52,211,153,.33);background:rgba(52,211,153,.1);color:#34D399;cursor:default}
.fu2-date.done .ti{font-size:20px}
.fu2-date.open{outline:2px solid var(--brand-light);outline-offset:2px}
.fu2-need{font-size:13px;font-weight:500;margin-top:2px;line-height:1.35;color:#60A5FA;overflow-wrap:anywhere}
.fu2-need.late{color:#F87171}
.fu2-need.done{color:var(--muted)}
.fu2-note{margin-top:10px;background:rgba(255,255,255,.05);border-radius:10px;padding:9px 12px 10px}
.fu2-note-h{display:flex;align-items:center;gap:6px;font-size:11.5px;font-weight:600;color:var(--muted)}
.fu2-note-h .ti{font-size:13px}
.fu2-note-t{font-size:13.5px;color:#E8ECF3;line-height:1.45;margin-top:3px;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.fu2-pick{margin-top:10px;background:#0E1219;border:1px solid var(--border);border-radius:12px;padding:10px 12px 12px}
.fu2-pick-h{font-size:11.5px;font-weight:600;color:var(--muted);margin-bottom:8px}
.fu2-pick-c{display:flex;flex-wrap:wrap;gap:8px}
.fu2-pick-c + .fu2-pick-c{margin-top:8px}
.fu2-chip{height:44px;padding:0 12px;border-radius:999px;border:1px solid var(--border);background:#1A1F29;color:#E8ECF3;font:inherit;font-size:13px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px;position:relative}
.fu2-chip.on{border-color:var(--brand-light);background:rgba(77,157,224,.18);color:#fff}
.fu2-chip.ico{width:44px;padding:0;color:var(--brand-light);overflow:hidden}
.fu2-chip.ico .ti{font-size:18px}
.fu2-chip.ok{border-color:rgba(52,211,153,.4);background:rgba(52,211,153,.12);color:#34D399}
.fu2-chip input[type=date]{position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:pointer;border:0;padding:0}
.fu2-foot{display:flex;gap:8px;margin-top:8px}
.fu2-foot .sm-more{margin-top:0}
.fu2-view{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px;font-weight:600;color:var(--muted);padding:2px 4px 6px}
.fu2-bg{position:fixed;inset:0;z-index:700;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:16px}
.fu2-sheet{width:100%;max-width:480px;max-height:90vh;overflow-y:auto;-webkit-overflow-scrolling:touch;background:#12161F;border:1px solid var(--border);border-radius:16px;padding:14px 16px 18px;color:#E8ECF3}
.fu2-top{display:flex;align-items:center;justify-content:space-between;gap:10px}
.fu2-title{font-size:17px;font-weight:700;color:#fff}
.fu2-x{width:44px;height:44px;border-radius:50%;border:none;background:rgba(255,255,255,.06);color:#C4CBD8;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:18px;margin-right:-6px}
.fu2-lab{display:block;font-size:12.5px;font-weight:600;color:var(--muted);margin:16px 0 8px}
.fu2-sub{font-size:12px;color:var(--muted);margin:10px 0 6px}
.fu2-in{width:100%;box-sizing:border-box;border-radius:10px;border:1px solid var(--border);background:#0E1219;color:#E8ECF3;font:inherit;font-size:16px;padding:11px 12px;outline:none;line-height:1.4}
.fu2-in:focus{border-color:var(--brand-light)}
textarea.fu2-in{resize:vertical;min-height:64px}
.fu2-jobs{display:flex;flex-direction:column;gap:6px;margin-top:8px}
.fu2-job{display:flex;flex-direction:column;align-items:flex-start;gap:2px;width:100%;text-align:left;min-height:48px;padding:8px 12px;border-radius:10px;border:1px solid var(--border);background:#1A1F29;color:#E8ECF3;font:inherit;cursor:pointer}
.fu2-job b{font-size:14px;font-weight:600}
.fu2-job span{font-size:12px;color:var(--muted)}
.fu2-picked{display:flex;align-items:center;justify-content:space-between;gap:10px;background:#0E1219;border:1px solid var(--border);border-radius:12px;padding:10px 12px}
.fu2-picked b{font-size:14px;font-weight:600;color:#fff;display:block}
.fu2-picked span{font-size:12px;color:var(--muted)}
.fu2-link{border:none;background:none;color:var(--brand-light);font:inherit;font-size:13px;font-weight:600;cursor:pointer;min-height:44px;padding:0 4px;flex-shrink:0}
.fu2-err{font-size:13px;color:#F87171;margin-top:12px;min-height:18px}
.fu2-save{width:100%;height:48px;margin-top:6px;border-radius:12px;border:none;background:var(--brand-light);color:#fff;font:inherit;font-size:15px;font-weight:700;cursor:pointer}
.fu2-when{font-size:12.5px;color:var(--muted);margin-top:8px}
.fu2-days{gap:6px}
.fu2-days .fu2-chip:not(.ico){padding:0 11px}
@media (max-width:760px){
  .fu2-bg{align-items:flex-end;padding:0}
  .fu2-sheet{max-width:none;border-radius:20px 20px 0 0;border-bottom:none;padding-bottom:calc(22px + env(safe-area-inset-bottom))}
}`;
    document.head.appendChild(st);
  }

  function pickerHtml(job, today) {
    return `
      <div class="fu2-pick">
        <div class="fu2-pick-h">Follow up next</div>
        <div class="fu2-pick-c">
          <button type="button" class="fu2-chip" data-fu="move" data-days="1">Tomorrow</button>
          <button type="button" class="fu2-chip" data-fu="move" data-days="3">3 days</button>
          <button type="button" class="fu2-chip" data-fu="move" data-days="7">1 week</button>
          <label class="fu2-chip ico" title="Pick a date"><i class="ti ti-calendar-event" aria-hidden="true"></i><input type="date" data-fu-date aria-label="Pick a date" min="${today}" value="${esc(job.nextFollowUp || today)}"></label>
        </div>
        <div class="fu2-pick-c">
          <button type="button" class="fu2-chip ok" data-fu="done"><i class="ti ti-check" aria-hidden="true"></i>Done</button>
          <button type="button" class="fu2-chip" data-fu="edit"><i class="ti ti-pencil" aria-hidden="true"></i>Edit</button>
        </div>
      </div>`;
  }

  function noteHtml(head, text) {
    if (!text) return '';
    return `<div class="fu2-note"><div class="fu2-note-h"><i class="ti ti-notes" aria-hidden="true"></i>${esc(head)}</div><div class="fu2-note-t">${esc(text)}</div></div>`;
  }

  function stageHtml(job) {
    const col = stageOf(job);
    return col ? `<div class="sm-fu-stage"><span style="background:${esc(col.color || 'var(--brand-light)')}"></span>${esc(col.name)}</div>` : '';
  }

  function rowHtml(item, today) {
    const job = item.job, b = badge(item.date, today), id = esc(job.id);
    const tel = (job.phone && job.phone !== '—') ? String(job.phone).replace(/[^\d+]/g, '') : '';
    const up = lastUpdate(job), open = String(ui.pick) === String(job.id);
    const when = b.late ? 'Follow-up was due ' + niceDay(item.date, today) : 'Follow up ' + niceDay(item.date, today);
    return `
      <div class="fu2-item" data-fu-job="${id}">
        <div class="sm-fu-row" data-fu="open">
          <button type="button" class="fu2-date${b.late ? ' late' : ''}${open ? ' open' : ''}" data-fu="pick" aria-expanded="${open}" aria-label="${esc(when)}. Change the date for ${esc(job.name || 'this job')}"><span>${b.top}</span><b>${b.day}</b></button>
          <div class="sm-fu-main">
            <div class="sm-fu-name">${esc(job.name || '')}</div>
            <div class="fu2-need${b.late ? ' late' : ''}">${esc(needOf(job))}</div>
            ${stageHtml(job)}
          </div>
          <button type="button" class="sm-fu-btn log" title="Log contact" aria-label="Log contact for ${esc(job.name || 'this job')}" data-fu="log"><i class="ti ti-notes" aria-hidden="true"></i></button>
          ${tel ? `<a class="sm-fu-btn call" href="tel:${tel}" title="Call ${esc(job.name || '')}" aria-label="Call ${esc(job.name || '')}" data-fu="call"><i class="ti ti-phone" aria-hidden="true"></i></a>` : ''}
        </div>
        ${open ? pickerHtml(job, today) : ''}
        ${up ? noteHtml('Last update · ' + shortDate(up.at, today) + (up.by ? ' · ' + up.by : ''), up.text) : ''}
      </div>`;
  }

  function doneRowHtml(item) {
    const job = item.job, e = item.entry, id = esc(job.id);
    return `
      <div class="fu2-item" data-fu-job="${id}" data-fu-at="${esc(e.at)}">
        <div class="sm-fu-row" data-fu="open">
          <div class="fu2-date done" aria-hidden="true"><i class="ti ti-check"></i></div>
          <div class="sm-fu-main">
            <div class="sm-fu-name">${esc(job.name || '')}</div>
            <div class="fu2-need done">${esc(e.need || DEFAULT_NEED)}</div>
            ${stageHtml(job)}
          </div>
          <button type="button" class="fu2-link" data-fu="reopen">Put back</button>
        </div>
        ${noteHtml('Done ' + timeOf(e.at) + (e.by ? ' · ' + e.by : ''), e.note || 'Marked done.')}
      </div>`;
  }

  // The whole Follow-ups panel for the Summary page.
  function panelHtml(jobs) {
    injectCss();
    ui.jobs = Array.isArray(jobs) ? jobs : [];
    const data = build(ui.jobs, { isClosed });
    const today = data.today;
    if (ui.view === 'done' && !data.done.length) ui.view = 'todo';
    if (ui.view === 'upcoming' && !data.upcoming.length) ui.view = 'todo';
    const n = data.todo.length;
    const sub = (n ? `${n} job${n === 1 ? '' : 's'} to contact` : 'Nothing due today') + (data.upcoming.length ? ` · ${data.upcoming.length} upcoming` : '');
    let body;
    if (ui.view === 'done') {
      body = `<div class="fu2-view"><span>Done today</span><button type="button" class="fu2-link" data-fu="view" data-view="todo">Back to the list</button></div>
        <div class="sm-list fu2-list">${data.done.map(doneRowHtml).join('')}</div>`;
    } else if (ui.view === 'upcoming') {
      body = `<div class="fu2-view"><span>Upcoming</span><button type="button" class="fu2-link" data-fu="view" data-view="todo">Back to the list</button></div>
        <div class="sm-list fu2-list">${data.upcoming.map(it => rowHtml(it, today)).join('')}</div>`;
    } else {
      const foot = [
        data.upcoming.length ? `<button type="button" class="sm-more" data-fu="view" data-view="upcoming">Upcoming (${data.upcoming.length})</button>` : '',
        data.done.length ? `<button type="button" class="sm-more" data-fu="view" data-view="done">Done today (${data.done.length})</button>` : '',
      ].join('');
      body = (n
        ? `<div class="sm-list fu2-list">${data.todo.map(it => rowHtml(it, today)).join('')}</div>`
        : `<div class="sm-empty">No follow-ups due. Tap Add to put a job on the list.</div>`)
        + (foot ? `<div class="fu2-foot">${foot}</div>` : '');
    }
    return `
    <section class="sm-panel sm-fu sm-fu2" data-fu-panel>
      <div class="sm-panel-head">
        <div><div class="sm-panel-title"><i class="ti ti-phone-outgoing"></i>Follow-ups</div>
        <div class="sm-panel-sub">${sub}</div></div>
        <button type="button" class="fu2-add" data-fu="add"><i class="ti ti-plus" aria-hidden="true"></i>Add</button>
      </div>
      ${body}
    </section>`;
  }

  // ── Add / edit sheet ─────────────────────────────────────────

  function closeSheet() {
    if (!hasDOM) return;
    document.querySelectorAll('.fu2-bg').forEach(w => w.remove());
  }

  function openAdd(jobId) {
    if (!hasDOM) return;
    injectCss();
    closeSheet();
    const today = dayKey(new Date());
    const known = NEEDS.reduce((a, g) => a.concat(g.items), []);
    const st = { job: jobId ? findJob(jobId) : null, need: '', other: false, date: today, q: '', err: '' };
    const editing = !!(st.job && validKey(st.job.nextFollowUp));
    if (st.job) {
      const cur = clean(st.job.followUp && st.job.followUp.need);
      if (cur && known.indexOf(cur) >= 0) st.need = cur;
      else if (cur && cur !== DEFAULT_NEED) { st.other = true; st.need = cur; }
      if (editing) st.date = st.job.nextFollowUp;
    }
    const bg = document.createElement('div');
    bg.className = 'fu2-bg';

    const pool = () => (ui.jobs.length ? ui.jobs : (Array.isArray(root.jobs) ? root.jobs : [])).filter(j => !isClosed(j));
    const matches = () => {
      const q = st.q.toLowerCase();
      return pool()
        .filter(j => !q || [j.name, j.address, j.phone].filter(Boolean).join(' ').toLowerCase().indexOf(q) >= 0)
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
        .slice(0, 5);
    };
    const jobLine = j => { const c = stageOf(j); return [c && c.name, j.address].filter(Boolean).join(' · '); };
    const chips = (items) => items.map(t => `<button type="button" class="fu2-chip${(!st.other && st.need === t) ? ' on' : ''}" data-need="${esc(t)}">${esc(t)}</button>`).join('');
    const quick = [['Today', 0], ['Tomorrow', 1], ['3 days', 3], ['1 week', 7]];

    function draw(focus) {
      const jobsList = st.job ? '' : `<div class="fu2-jobs">${matches().map(j => `<button type="button" class="fu2-job" data-job="${esc(j.id)}"><b>${esc(j.name || 'Job')}</b><span>${esc(jobLine(j))}</span></button>`).join('') || '<div class="fu2-sub">No open jobs match.</div>'}</div>`;
      bg.innerHTML = `
        <div class="fu2-sheet" role="dialog" aria-modal="true" aria-label="${editing ? 'Edit follow-up' : 'Add follow-up'}">
          <div class="fu2-top"><div class="fu2-title">${editing ? 'Edit follow-up' : 'Add follow-up'}</div><button type="button" class="fu2-x" data-x aria-label="Close"><i class="ti ti-x" aria-hidden="true"></i></button></div>
          <label class="fu2-lab" for="fu2Job">Job</label>
          ${st.job
            ? `<div class="fu2-picked"><div><b>${esc(st.job.name || 'Job')}</b><span>${esc(jobLine(st.job))}</span></div>${editing ? '' : '<button type="button" class="fu2-link" data-change>Change</button>'}</div>`
            : `<input id="fu2Job" class="fu2-in" type="search" autocomplete="off" placeholder="Search name or address" value="${esc(st.q)}">${jobsList}`}
          <div class="fu2-lab">What's needed</div>
          ${NEEDS.map((g, i) => `<div class="fu2-sub"${i ? '' : ' style="margin-top:0"'}>${esc(g.group)}</div><div class="fu2-pick-c">${chips(g.items)}</div>`).join('')}
          <div class="fu2-pick-c" style="margin-top:10px"><button type="button" class="fu2-chip${st.other ? ' on' : ''}" data-other>Other</button></div>
          ${st.other ? `<input id="fu2Other" class="fu2-in" style="margin-top:8px" type="text" maxlength="80" placeholder="Send photos to adjuster" aria-label="What's needed" value="${esc(st.need)}">` : ''}
          <label class="fu2-lab" for="fu2Note">Note (optional)</label>
          <textarea id="fu2Note" class="fu2-in" maxlength="400" placeholder="Supplement sent Monday, adjuster hasn't answered">${esc(st.note || '')}</textarea>
          <div class="fu2-lab">Follow up</div>
          <div class="fu2-pick-c fu2-days">
            ${quick.map(q => `<button type="button" class="fu2-chip${st.date === addDays(today, q[1]) ? ' on' : ''}" data-days="${q[1]}">${q[0]}</button>`).join('')}
            <label class="fu2-chip ico" title="Pick a date"><i class="ti ti-calendar-event" aria-hidden="true"></i><input type="date" data-date aria-label="Pick a date" min="${today}" value="${esc(st.date)}"></label>
          </div>
          <div class="fu2-when">Due ${esc(niceDay(st.date, today))}</div>
          <div class="fu2-err" role="alert">${esc(st.err)}</div>
          <button type="button" class="fu2-save" data-save>${editing ? 'Save changes' : 'Add to follow-ups'}</button>
        </div>`;
      if (focus) { const el = bg.querySelector(focus); if (el) { el.focus(); if (el.setSelectionRange) { const v = el.value.length; try { el.setSelectionRange(v, v); } catch (e) {} } } }
    }
    const keep = () => {
      const n = bg.querySelector('#fu2Note'); if (n) st.note = n.value;
      const o = bg.querySelector('#fu2Other'); if (o) st.need = o.value;
    };

    bg.addEventListener('click', e => {
      e.stopPropagation();
      if (e.target === bg || e.target.closest('[data-x]')) { closeSheet(); return; }
      const t = e.target.closest('button');
      if (!t) return;
      keep(); st.err = '';
      if (t.dataset.job) { st.job = findJob(t.dataset.job); draw(); return; }
      if (t.hasAttribute('data-change')) { st.job = null; draw('#fu2Job'); return; }
      if (t.dataset.need) { st.other = false; st.need = t.dataset.need; draw(); return; }
      if (t.hasAttribute('data-other')) { st.other = !st.other; st.need = ''; draw(st.other ? '#fu2Other' : null); return; }
      if (t.dataset.days != null) { st.date = addDays(today, Number(t.dataset.days)); draw(); return; }
      if (t.hasAttribute('data-save')) {
        const need = clean(st.need);
        if (!st.job) { st.err = 'Pick a job first.'; draw(); return; }
        if (!need) { st.err = st.other ? "Type what's needed." : "Pick what's needed."; draw(st.other ? '#fu2Other' : null); return; }
        if (!validKey(st.date)) { st.err = 'Pick a date.'; draw(); return; }
        setFollowUp(st.job, { date: st.date, need, note: st.note, by: me() });
        closeSheet();
        ui.pick = null;
        persist(st.job, (editing ? 'Follow-up changed — ' : 'Follow-up added — ') + need, 'Due ' + niceDay(st.date, today) + (clean(st.note) ? ' · ' + clean(st.note) : ''));
        say(editing ? 'Follow-up saved' : 'Added to follow-ups');
      }
    });
    bg.addEventListener('input', e => {
      if (e.target.id === 'fu2Job') {
        st.q = e.target.value;
        const box = bg.querySelector('.fu2-jobs');
        if (box) box.innerHTML = matches().map(j => `<button type="button" class="fu2-job" data-job="${esc(j.id)}"><b>${esc(j.name || 'Job')}</b><span>${esc(jobLine(j))}</span></button>`).join('') || '<div class="fu2-sub">No open jobs match.</div>';
      }
    });
    bg.addEventListener('change', e => {
      if (e.target.matches('[data-date]') && validKey(e.target.value)) { keep(); st.date = e.target.value; draw(); }
    });
    document.body.appendChild(bg);
    draw(st.job ? null : '#fu2Job');
  }

  // ── Panel clicks (delegated, installed once) ─────────────────

  function onClick(e) {
    const panel = e.target.closest && e.target.closest('[data-fu-panel]');
    if (!panel) return;
    const hit = e.target.closest('[data-fu]');
    if (!hit) return;
    const act = hit.dataset.fu;
    if (act === 'call') return;                       // let the tel: link work
    if (act === 'add') { openAdd(); return; }
    if (act === 'view') { ui.view = hit.dataset.view || 'todo'; ui.pick = null; refresh(); return; }
    const item = hit.closest('[data-fu-job]');
    const job = item ? findJob(item.dataset.fuJob) : null;
    if (!job) return;
    const today = dayKey(new Date());
    switch (act) {
      case 'pick': ui.pick = String(ui.pick) === String(job.id) ? null : job.id; refresh(); break;
      case 'move': {
        const date = addDays(today, Number(hit.dataset.days) || 1);
        reschedule(job, date); ui.pick = null;
        persist(job, 'Follow-up moved', 'To ' + niceDay(date, today));
        say('Moved to ' + niceDay(date, today));
        break;
      }
      case 'done': complete(job, { by: me() }); ui.pick = null; persist(job, 'Follow-up done', ''); say('Marked done'); break;
      case 'edit': openAdd(job.id); break;
      case 'reopen': reopen(job, item.dataset.fuAt, today); persist(job, 'Follow-up put back', ''); break;
      case 'log': if (typeof root.openLogContact === 'function') root.openLogContact(job.id); break;
      case 'open': if (!e.target.closest('.fu2-pick') && typeof root.openDetail === 'function') root.openDetail(job.id); break;
    }
  }
  function onChange(e) {
    if (!e.target.matches || !e.target.matches('[data-fu-panel] [data-fu-date]')) return;
    const item = e.target.closest('[data-fu-job]');
    const job = item ? findJob(item.dataset.fuJob) : null;
    if (!job || !validKey(e.target.value)) return;
    const today = dayKey(new Date());
    reschedule(job, e.target.value); ui.pick = null;
    persist(job, 'Follow-up moved', 'To ' + niceDay(e.target.value, today));
    say('Moved to ' + niceDay(e.target.value, today));
  }
  if (hasDOM) {
    document.addEventListener('click', onClick);
    document.addEventListener('change', onChange);
  }

  return {
    NEEDS, DEFAULT_NEED, dayKey, addDays, daysBetween, validKey, badge, niceDay, needOf, lastUpdate,
    build, setFollowUp, reschedule, complete, reopen, panelHtml, openAdd,
  };
});
