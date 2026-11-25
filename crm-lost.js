/* ============================================================
   StormShield CRM — lost leads
   ------------------------------------------------------------
   A job that isn't going ahead (the check was too low, the
   deductible too high, they went with someone else, they stopped
   answering …) is moved to the pipeline's "Lost Lead" stage.
   Moving a job there, by any route, opens "Mark as lost":
     • why it was lost — one tap from a short list
     • "Was a supplement tried?" when the check was too low
     • an optional note
     • when to try again — never, 3 months, 6 months or a date.
       That date becomes the job's follow-up date, so the job
       shows in Follow-ups when the day comes.
   The job's Overview then shows a "Lost" card with all of that
   and a Reopen button, which puts the job back in the stage it
   was lost from. "Lost leads" lists every lost job, with a count
   per reason.
   Nothing is deleted: photos, notes and paperwork stay on the job.
   Saved on the job as job.lost (kept in the contract JSON, see
   supabase-crm.js).
   ============================================================ */

(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.crmLost = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const REASONS = [
    { id: 'check-low', label: 'Check too low / didn’t want to do the roof', short: 'Check too low' },
    { id: 'deductible', label: 'Deductible too high', short: 'Deductible too high' },
    { id: 'other-roofer', label: 'Went with another roofer', short: 'Another roofer' },
    { id: 'not-interested', label: 'Not interested', short: 'Not interested' },
    { id: 'no-response', label: 'Stopped responding', short: 'Stopped responding' },
    { id: 'other', label: 'Other', short: 'Other' },
  ];
  const SUPPLEMENT_REASON = 'check-low';   // the one reason a supplement can fix

  /* ---------- pure helpers (unit tested) ---------- */

  const reason = id => REASONS.find(r => r.id === id) || null;
  const reasonLabel = id => (reason(id) || { label: 'No reason given' }).label;

  // Is this stage a pipeline's "Lost Lead" stage?
  function isLostStage(col) {
    if (!col) return false;
    const n = String(col.name || '').toLowerCase(), id = String(col.id || '').toLowerCase();
    return n.includes('lost lead') || n.includes('lost-lead') || id === 'lost-lead' || id === 'lost_lead' || id.indexOf('lost-lead-') === 0;
  }
  const lostStageOf = cols => (cols || []).find(isLostStage) || null;

  const pad = n => String(n).padStart(2, '0');
  const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  // 'never' | '3m' | '6m' | 'YYYY-MM-DD' → the date to try again ('YYYY-MM-DD'), or null.
  // Months are calendar months; the 31st of a short month lands on its last day.
  function tryAgainDate(choice, today) {
    if (!choice || choice === 'never') return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(choice)) return choice;
    const m = choice === '3m' ? 3 : choice === '6m' ? 6 : 0;
    if (!m) return null;
    const t = today || new Date();
    const d = new Date(t.getFullYear(), t.getMonth() + m, 1);
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(t.getDate(), last));
    return ymd(d);
  }

  // 'YYYY-MM-DD' → "May 24, 2027" (or "May 24" with short).
  function niceDate(s, short) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
    if (!m) return '';
    const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+m[2] - 1];
    return mon + ' ' + (+m[3]) + (short ? '' : ', ' + m[1]);
  }

  // The record saved on a job when it is marked lost.
  function makeRecord(o) {
    const r = reason(o.reason) ? o.reason : 'other';
    return {
      reason: r,
      note: String(o.note || '').trim(),
      from: o.from || null,                    // stage it was lost from (id) …
      fromName: o.fromName || '',              // … and its name then, in case the stage is renamed or removed
      at: o.at || new Date().toISOString(),
      by: o.by || '',
      supplementTried: r === SUPPLEMENT_REASON && typeof o.supplementTried === 'boolean' ? o.supplementTried : null,
      tryAgain: o.tryAgain || null,
    };
  }

  // Lost jobs, soonest try-again date first, then the ones with no date (newest lost first).
  function sortLost(list) {
    return list.slice().sort((a, b) => {
      const x = (a.lost && a.lost.tryAgain) || '', y = (b.lost && b.lost.tryAgain) || '';
      if (x && y) return x < y ? -1 : x > y ? 1 : 0;
      if (x || y) return x ? -1 : 1;
      return String((b.lost && b.lost.at) || '').localeCompare(String((a.lost && a.lost.at) || ''));
    });
  }
  // How many lost jobs per reason: [{ id, short, n }], reasons with none left out.
  // A job moved to Lost Lead before this existed has no reason: counted under 'none'.
  function countReasons(list) {
    const n = {};
    list.forEach(j => { const k = (j.lost && reason(j.lost.reason)) ? j.lost.reason : 'none'; n[k] = (n[k] || 0) + 1; });
    const out = REASONS.filter(r => n[r.id]).map(r => ({ id: r.id, short: r.short, n: n[r.id] }));
    if (n.none) out.push({ id: 'none', short: 'No reason', n: n.none });
    return out;
  }

  const api = { REASONS, SUPPLEMENT_REASON, reason, reasonLabel, isLostStage, lostStageOf, tryAgainDate, niceDate, makeRecord, sortLost, countReasons };

  const hasDOM = typeof document !== 'undefined';
  if (!hasDOM) return api;

  /* ---------- the CRM around us ---------- */

  const jobsArr = () => root.jobs || [];
  const jobById = id => jobsArr().find(j => j.id === id) || null;
  const colsFor = j => (typeof root.columnsForPipeline === 'function' ? root.columnsForPipeline(j.pipeline || 'insurance') : []) || [];
  const isLostJob = j => !!j && isLostStage(colsFor(j).find(c => c.id === j.col));
  const say = m => { if (typeof root.toast === 'function') root.toast(m); };
  const save = () => { if (typeof root.saveToStorage === 'function') root.saveToStorage(); };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const me = () => (root.currentMember && root.currentMember.name) || '';
  const repName = j => { try { return typeof root.jobRep === 'function' ? (root.jobRep(j.user).name || '') : ''; } catch (e) { return ''; } };
  function redraw() {
    ['renderBoard', 'renderDetailPanel'].forEach(fn => { if (typeof root[fn] === 'function') { try { root[fn](); } catch (e) {} } });
    try { const pg = document.getElementById('jobsPage'); if (pg && pg.style.display !== 'none' && typeof root.renderJobsPage === 'function') root.renderJobsPage(); } catch (e) {}
  }

  const X = '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';

  let styled = false;
  function injectStyles() {
    if (styled) return;
    styled = true;
    const s = document.createElement('style');
    s.textContent = `
.lst-bg{position:fixed;inset:0;z-index:100000;background:rgba(5,7,11,.72);display:flex;align-items:flex-end;justify-content:center;font-family:Inter,system-ui,sans-serif}
.lst-sheet{width:100%;max-width:480px;max-height:100%;overflow:auto;box-sizing:border-box;background:#0A0D13;color:#E8ECF3;border:1px solid #252B38;border-radius:16px 16px 0 0;padding:12px 16px calc(18px + env(safe-area-inset-bottom));display:flex;flex-direction:column;gap:14px;-webkit-overflow-scrolling:touch}
.lst-sheet:focus{outline:none}
@media(min-width:761px){.lst-bg{align-items:center}.lst-sheet{border-radius:16px;max-height:92vh}}
.lst-h{display:flex;align-items:center;justify-content:space-between;gap:10px}
.lst-h b{display:block;font-size:18px;font-weight:700}
.lst-h span{display:block;font-size:13px;color:#8B94A7;margin-top:2px}
.lst-x{width:44px;height:44px;border-radius:22px;border:0;background:rgba(255,255,255,.12);color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;flex:none}
.lst-lbl{font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:#8B94A7;margin-bottom:8px;display:block}
.lst-box{background:#131822;border:1px solid #252B38;border-radius:12px;display:flex;flex-direction:column}
.lst-r{display:flex;align-items:center;gap:12px;min-height:48px;padding:0 14px;border-bottom:1px solid #252B38;font-size:15px;color:#E8ECF3;cursor:pointer}
.lst-r:last-child{border-bottom:0}
.lst-r input{position:absolute;opacity:0;width:1px;height:1px}
.lst-r i{width:22px;height:22px;box-sizing:border-box;border-radius:50%;border:2px solid #4A5468;display:flex;align-items:center;justify-content:center;flex:none}
.lst-r input:checked+i{border-color:#2F6FEB}
.lst-r input:checked+i::after{content:"";width:10px;height:10px;border-radius:50%;background:#2F6FEB}
.lst-r input:checked~span{font-weight:700;color:#fff}
.lst-r input:focus-visible+i{outline:2px solid #8FB4FF;outline-offset:2px}
.lst-sup{background:#2A2110;border:1px solid #6B5417;border-radius:12px;padding:12px 14px;display:flex;flex-direction:column;gap:10px}
.lst-sup[hidden]{display:none}
.lst-sup b{font-size:14px;font-weight:600;color:#fff}
.lst-sup small{font-size:12px;line-height:1.4;color:#E5D5A3}
.lst-two{display:flex;gap:8px}
.lst-two button{flex:1;min-height:44px;border-radius:10px;border:1px solid #6B5417;background:transparent;color:#E5D5A3;font:600 14px Inter,system-ui,sans-serif;cursor:pointer}
.lst-two button[aria-pressed="true"]{background:#2F6FEB;border-color:#2F6FEB;color:#fff;font-weight:700}
.lst-ta{width:100%;box-sizing:border-box;background:#161B24;border:1px solid #33405A;border-radius:10px;padding:10px 12px;color:#E8ECF3;font:400 16px/1.4 Inter,system-ui,sans-serif;resize:none}
.lst-chips{display:flex;flex-wrap:wrap;gap:8px}
.lst-chip{min-height:44px;padding:0 14px;border-radius:22px;border:1px solid #33405A;background:transparent;color:#C4CBD8;font:600 13px Inter,system-ui,sans-serif;cursor:pointer;display:flex;align-items:center;gap:6px}
.lst-chip[aria-pressed="true"]{background:#2F6FEB;border-color:#2F6FEB;color:#fff;font-weight:700}
.lst-chip b{font-weight:700;color:#E8ECF3}
.lst-chip[aria-pressed="true"] b{color:#fff}
.lst-date{background:#161B24;border:1px solid #33405A;border-radius:10px;padding:10px 12px;color:#E8ECF3;font:600 16px Inter,system-ui,sans-serif;min-height:44px;box-sizing:border-box}
.lst-date[hidden]{display:none}
.lst-hint{font-size:12px;line-height:1.4;color:#8B94A7;margin:8px 0 0}
.lst-btns{display:flex;gap:12px}
.lst-btn{flex:1;min-height:50px;border-radius:12px;background:#1A1F29;color:#E8ECF3;border:1px solid #252B38;font:700 15px Inter,system-ui,sans-serif;cursor:pointer}
.lst-btn.main{flex:2;background:#2F6FEB;border:0;color:#fff}
.lst-btn:disabled{opacity:.5;cursor:default}
.lst-kv{display:flex;justify-content:space-between;gap:12px;padding:11px 14px;border-bottom:1px solid #252B38;font-size:14px}
.lst-kv:last-child{border-bottom:0}
.lst-kv span{color:#8B94A7;flex:none}
.lst-kv b{font-weight:600;color:#fff;text-align:right}
.lst-card{display:flex;flex-direction:column;gap:10px}
.lst-note{font-size:13px;line-height:1.45;color:#C4CBD8;margin:0;white-space:pre-wrap}
.lst-link{background:transparent;border:0;color:#8FB4FF;font:600 13px Inter,system-ui,sans-serif;min-height:44px;padding:0;cursor:pointer;align-self:flex-start}
.lst-row{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:64px;padding:10px 14px;background:transparent;border:0;border-bottom:1px solid #252B38;text-align:left;font-family:Inter,system-ui,sans-serif;color:#E8ECF3;cursor:pointer;width:100%}
.lst-row:last-child{border-bottom:0}
.lst-row>span:first-child{display:flex;flex-direction:column;gap:2px;min-width:0}
.lst-row b{font-size:15px;font-weight:600;color:#fff}
.lst-row em{font-style:normal;font-size:13px;color:#C4CBD8}
.lst-row small{font-size:12px;color:#8B94A7}
.lst-again{font-size:12px;font-weight:600;color:#FDBA74;white-space:nowrap}
.lst-again.none{font-weight:400;color:#8B94A7}
.lst-again.due{color:#FCA5A5}
.lst-empty{padding:22px 14px;font-size:14px;color:#8B94A7;text-align:center}`;
    document.head.appendChild(s);
  }

  function sheet(html, label) {
    injectStyles();
    const bg = document.createElement('div');
    bg.className = 'lst-bg';
    bg.innerHTML = `<div class="lst-sheet" role="dialog" aria-modal="true" aria-label="${esc(label)}" tabindex="-1">${html}</div>`;
    const close = () => { bg.remove(); document.removeEventListener('keydown', onKey, true); };
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(bg);
    setTimeout(() => { const s = bg.querySelector('.lst-sheet'); if (s) s.focus({ preventScroll: true }); }, 50);
    return { bg, close };
  }

  /* ---------- Mark as lost ---------- */

  // Open the sheet for a job about to go to its pipeline's Lost Lead stage
  // (targetColId), or for a job already there (edit).
  function open(jobId, targetColId) {
    const j = jobById(jobId);
    if (!j) return;
    const cols = colsFor(j);
    const target = cols.find(c => c.id === targetColId) || lostStageOf(cols);
    if (!target) { say('This pipeline has no Lost Lead stage — add one in Edit board'); return; }
    const editing = j.col === target.id;
    const was = (j.lost && typeof j.lost === 'object') ? j.lost : null;
    const fromCol = editing ? null : cols.find(c => c.id === j.col);
    const fromName = editing ? ((was && was.fromName) || '') : ((fromCol && fromCol.name) || '');
    const st = {
      reason: was ? was.reason : '',
      sup: was ? was.supplementTried : null,
      again: was && was.tryAgain ? 'date' : (was ? 'never' : ''),
      date: (was && was.tryAgain) || '',
    };
    const { bg, close } = sheet(`
      <div class="lst-h"><div><b>${editing ? 'Lost lead' : 'Mark as lost'}</b><span>${esc(j.name || 'Job')}${fromName ? ' · lost from ' + esc(fromName) : ''}</span></div><button type="button" class="lst-x" data-a="close" aria-label="Close">${X}</button></div>
      <div><span class="lst-lbl" id="lstWhy">Why was it lost?</span>
        <div class="lst-box" role="radiogroup" aria-labelledby="lstWhy">${REASONS.map(r => `<label class="lst-r"><input type="radio" name="lstReason" value="${r.id}"${st.reason === r.id ? ' checked' : ''}><i aria-hidden="true"></i><span>${esc(r.label)}</span></label>`).join('')}</div></div>
      <div class="lst-sup" data-sup hidden><b>Was a supplement tried?</b>
        <div class="lst-two"><button type="button" data-sup-v="yes" aria-pressed="false">Yes</button><button type="button" data-sup-v="no" aria-pressed="false">No</button></div>
        <small data-sup-hint hidden>A supplement can sometimes close the gap. Worth a try before this one is closed out.</small></div>
      <div><label class="lst-lbl" for="lstNote">Note (optional)</label>
        <textarea class="lst-ta" id="lstNote" rows="2" maxlength="600">${esc(was ? was.note : '')}</textarea></div>
      <div><span class="lst-lbl">Try again</span>
        <div class="lst-chips">${[['never', 'Never'], ['3m', '3 months'], ['6m', '6 months'], ['date', 'Pick a date']].map(([v, l]) => `<button type="button" class="lst-chip" data-again="${v}" aria-pressed="false">${l}</button>`).join('')}
          <input type="date" class="lst-date" data-date aria-label="Try again on" value="${esc(st.date)}" min="${ymd(new Date())}" hidden></div>
        <p class="lst-hint" data-again-hint></p></div>
      <div class="lst-btns"><button type="button" class="lst-btn" data-a="close">Cancel</button><button type="button" class="lst-btn main" data-a="ok" disabled>${editing ? 'Save' : 'Mark as lost'}</button></div>`,
      editing ? 'Lost lead' : 'Mark as lost');

    const q = s => bg.querySelector(s);
    const againDate = () => st.again === 'date' ? (st.date || null) : tryAgainDate(st.again);
    function paint() {
      q('[data-sup]').hidden = st.reason !== SUPPLEMENT_REASON;
      bg.querySelectorAll('[data-sup-v]').forEach(b => b.setAttribute('aria-pressed', String((b.dataset.supV === 'yes') === st.sup && st.sup !== null)));
      q('[data-sup-hint]').hidden = st.sup !== false;
      bg.querySelectorAll('[data-again]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.again === st.again)));
      q('[data-date]').hidden = st.again !== 'date';
      const d = againDate();
      q('[data-again-hint]').textContent = d ? 'Shows in Follow-ups on ' + niceDate(d) + '.' : st.again === 'never' ? 'It won’t come up in Follow-ups.' : st.again === 'date' ? 'Pick the date.' : '';
      q('[data-a="ok"]').disabled = !st.reason || !st.again || (st.again === 'date' && !st.date);
    }
    paint();
    bg.addEventListener('change', e => {
      if (e.target.name === 'lstReason') { st.reason = e.target.value; if (st.reason !== SUPPLEMENT_REASON) st.sup = null; }
      if (e.target.hasAttribute('data-date')) st.date = e.target.value;
      paint();
    });
    bg.addEventListener('click', e => {
      const sv = e.target.closest('[data-sup-v]'); if (sv) { st.sup = sv.dataset.supV === 'yes'; paint(); return; }
      const ag = e.target.closest('[data-again]'); if (ag) { st.again = ag.dataset.again; paint(); return; }
      const a = e.target.closest('[data-a]'); if (!a || a.disabled) return;
      if (a.dataset.a === 'close') { close(); return; }
      const note = q('#lstNote').value;
      close();
      commit(jobId, target.id, { reason: st.reason, supplementTried: st.sup, note, tryAgain: againDate() });
    });
  }

  function commit(jobId, targetColId, o) {
    const j = jobById(jobId);   // looked up again: a sync may have reloaded the jobs while the sheet was open
    if (!j) return;
    const cols = colsFor(j), target = cols.find(c => c.id === targetColId);
    if (!target) return;
    const editing = j.col === target.id;
    const was = (j.lost && typeof j.lost === 'object') ? j.lost : null;
    const fromCol = cols.find(c => c.id === j.col);
    const rec = makeRecord(Object.assign({}, o, editing
      ? { from: was && was.from, fromName: was && was.fromName, at: was && was.at, by: (was && was.by) || me() }
      : { from: j.col, fromName: (fromCol && fromCol.name) || '', by: me() }));
    const wasFollow = j.nextFollowUp;
    j.lost = rec;
    if (rec.tryAgain) j.nextFollowUp = rec.tryAgain; else delete j.nextFollowUp;
    const detail = reasonLabel(rec.reason) + (rec.tryAgain ? ' · try again ' + niceDate(rec.tryAgain) : '') + (rec.note ? ' · ' + rec.note : '');
    if (editing) {
      if (typeof root.logActivity === 'function') root.logActivity(j, 'stage', 'Lost lead updated', detail);
      save(); redraw(); say('Saved');
      return;
    }
    // The move itself goes the CRM's usual way, so the stage change is logged like any other.
    if (typeof root.moveJobToStage === 'function') root.moveJobToStage(j.id, target.id, { lostConfirmed: true });
    if (j.col !== target.id) {   // the move was refused (locked stage, …): leave the job as it was
      j.lost = was;
      if (wasFollow) j.nextFollowUp = wasFollow; else delete j.nextFollowUp;
      return;
    }
    if (typeof root.logActivity === 'function') root.logActivity(j, 'stage', 'Marked lost', detail);
    save(); redraw();
  }

  /* ---------- Reopen ---------- */

  function reopen(jobId) {
    const j = jobById(jobId);
    if (!j || !isLostJob(j)) return;
    const cols = colsFor(j);
    const back = (j.lost && cols.find(c => c.id === j.lost.from && !isLostStage(c))) || cols.find(c => !isLostStage(c) && !c.locked);
    if (!back) { say('No stage to reopen into'); return; }
    const from = (cols.find(c => c.id === j.col) || {}).name || 'Lost Lead';
    const again = j.lost && j.lost.tryAgain;
    j.col = back.id;
    if (again && j.nextFollowUp === again) delete j.nextFollowUp;   // it's live again: the try-again date has done its job
    j.lost = null;
    if (typeof root.logActivity === 'function') root.logActivity(j, 'stage', 'Stage changed', from + ' → ' + back.name + ' (reopened)');
    save(); redraw();
    say('Reopened in ' + back.name);
  }

  // The day it was lost, on this device's calendar (the record keeps the exact time).
  const lostOn = (L, short) => { const d = new Date(L.at); return isNaN(d) ? '' : niceDate(ymd(d), short); };

  /* ---------- the "Lost" card on a job's Overview ---------- */

  function card(j) {
    if (!isLostJob(j)) return null;
    injectStyles();
    const L = (j.lost && typeof j.lost === 'object') ? j.lost : null;
    const el = document.createElement('div');
    el.className = 'lst-card';
    const cols = colsFor(j);
    const back = L && cols.find(c => c.id === L.from && !isLostStage(c));
    const kv = (k, v) => v ? `<div class="lst-kv"><span>${k}</span><b>${esc(v)}</b></div>` : '';
    el.innerHTML = L
      ? `<div class="lst-box">${kv('Reason', reasonLabel(L.reason))}${kv('Lost from', L.fromName)}${kv('Lost on', lostOn(L))}${L.supplementTried == null ? '' : kv('Supplement tried', L.supplementTried ? 'Yes' : 'No')}${kv('Try again', L.tryAgain ? niceDate(L.tryAgain) : 'Never')}</div>
         ${L.note ? `<p class="lst-note">${esc(L.note)}</p>` : ''}
         <div class="lst-btns"><button type="button" class="lst-btn" data-a="edit">Edit</button><button type="button" class="lst-btn main" data-a="reopen">Reopen${back ? ' in ' + esc(back.name) : ''}</button></div>`
      : `<p class="lst-note">No reason was recorded for this one.</p>
         <div class="lst-btns"><button type="button" class="lst-btn" data-a="reopen">Reopen</button><button type="button" class="lst-btn main" data-a="edit">Add the reason</button></div>`;
    el.insertAdjacentHTML('beforeend', '<button type="button" class="lst-link" data-a="list">See all lost leads</button>');
    el.addEventListener('click', e => {
      const a = e.target.closest('[data-a]'); if (!a) return;
      e.stopPropagation();
      if (a.dataset.a === 'edit') open(j.id, j.col);
      else if (a.dataset.a === 'reopen') reopen(j.id);
      else openList();
    });
    return el;
  }

  /* ---------- Lost leads list ---------- */

  async function openList() {
    // Lost jobs in some pipelines are only loaded when asked for.
    if (typeof root.loadClosedJobs === 'function') { try { await root.loadClosedJobs(); } catch (e) {} }
    let filter = 'all';
    const { bg, close } = sheet('<div data-list></div>', 'Lost leads');
    const today = ymd(new Date());
    function paint() {
      const all = sortLost(jobsArr().filter(isLostJob));
      const counts = countReasons(all);
      if (filter !== 'all' && !counts.some(c => c.id === filter)) filter = 'all';
      const rows = filter === 'all' ? all : all.filter(j => ((j.lost && reason(j.lost.reason)) ? j.lost.reason : 'none') === filter);
      bg.querySelector('[data-list]').innerHTML = `
        <div class="lst-h" style="margin-bottom:14px"><div><b>Lost leads</b><span>${all.length} job${all.length === 1 ? '' : 's'}</span></div><button type="button" class="lst-x" data-a="close" aria-label="Close">${X}</button></div>
        ${all.length ? `<div class="lst-chips" style="margin-bottom:14px"><button type="button" class="lst-chip" data-f="all" aria-pressed="${filter === 'all'}">All <b>${all.length}</b></button>${counts.map(c => `<button type="button" class="lst-chip" data-f="${c.id}" aria-pressed="${filter === c.id}">${esc(c.short)} <b>${c.n}</b></button>`).join('')}</div>` : ''}
        <span class="lst-lbl">Try again soonest first</span>
        <div class="lst-box">${rows.length ? rows.map(j => {
          const L = j.lost || {}, rep = repName(j);
          const sub = [L.fromName ? 'Lost from ' + L.fromName : '', L.at ? lostOn(L, true) : '', rep].filter(Boolean).join(' · ');
          const again = L.tryAgain ? `<span class="lst-again${L.tryAgain <= today ? ' due' : ''}">${L.tryAgain <= today ? 'Due ' : 'Try '}${esc(niceDate(L.tryAgain, L.tryAgain.slice(0, 4) === today.slice(0, 4)))}</span>` : '<span class="lst-again none">No date</span>';
          return `<button type="button" class="lst-row" data-job="${esc(j.id)}"><span><b>${esc(j.name || 'Job')}</b><em>${esc(L.reason ? reasonLabel(L.reason) : 'No reason recorded')}</em>${sub ? `<small>${esc(sub)}</small>` : ''}</span>${again}</button>`;
        }).join('') : '<div class="lst-empty">No lost leads yet. Move a job to Lost Lead and it shows here.</div>'}</div>
        <p class="lst-hint">Tap a job to open it. A job with a try-again date also shows in Follow-ups on that day.</p>`;
    }
    paint();
    bg.addEventListener('click', e => {
      if (e.target.closest('[data-a="close"]')) { close(); return; }
      const f = e.target.closest('[data-f]'); if (f) { filter = f.dataset.f; paint(); return; }
      const r = e.target.closest('[data-job]');
      if (r) { close(); if (typeof root.openDetail === 'function') root.openDetail(r.dataset.job); }
    });
  }

  Object.assign(api, { open, reopen, card, openList, isLostJob });
  return api;
});
