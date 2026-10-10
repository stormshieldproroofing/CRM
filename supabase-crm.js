/* ============================================================
   StormShield CRM — Supabase backend integration
   ------------------------------------------------------------
   HOW TO USE
   1. Put your project URL + anon key below.
   2. Add this to the <head> of your CRM html, BEFORE the main <script>:
        <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
        <script src="supabase-crm.js"></script>
   3. This file overrides saveToStorage / loadFromStorage / saveTeam.
      The app keeps using its in-memory `jobs`, `columns`, `pipelines`,
      and `TEAM` arrays exactly as before — we just sync them to Supabase.
   ============================================================ */

const SUPABASE_URL  = 'https://lqhdhflsgswctdwmojhd.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxxaGRoZmxzZ3N3Y3Rkd21vamhkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5Mzc2NjcsImV4cCI6MjA5NTUxMzY2N30.1FXt_Q88QSg93MAA3GjdoYzfP1eX3ON6-14nz3m8flI';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
window.sb = sb;  // expose for browser-console debugging

/* ---------- AUTH (email / password) ---------------------- */

function authScreenHTML() {
  return `
  <div id="ssAuth" style="position:fixed;inset:0;background:#0F1117;z-index:9999;
       display:flex;align-items:center;justify-content:center;font-family:'Barlow',sans-serif">
    <div style="width:340px;background:#1A1F2E;border:1px solid #2A3145;border-radius:12px;padding:28px">
      <div style="font-family:'Barlow Condensed';font-weight:700;font-size:22px;color:#fff;margin-bottom:4px">StormShield CRM</div>
      <div style="color:#5A6580;font-size:12px;margin-bottom:18px">Sign in to continue</div>
      <input id="ssEmail" type="email" placeholder="Email" autocomplete="username"
        style="width:100%;margin-bottom:8px;padding:10px;border-radius:7px;border:1px solid #2A3145;background:#0F1117;color:#fff;font-size:13px;outline:none">
      <input id="ssPass" type="password" placeholder="Password" autocomplete="current-password"
        style="width:100%;margin-bottom:12px;padding:10px;border-radius:7px;border:1px solid #2A3145;background:#0F1117;color:#fff;font-size:13px;outline:none">
      <button id="ssSignIn" style="width:100%;padding:10px;border:none;border-radius:7px;background:#4D9DE0;color:#fff;font-weight:600;font-size:13px;cursor:pointer">Sign In</button>
      <button id="ssSignUp" style="width:100%;margin-top:8px;padding:10px;border:1px solid #2A3145;border-radius:7px;background:transparent;color:#93B4E0;font-weight:600;font-size:13px;cursor:pointer">Create Account</button>
      <div id="ssAuthMsg" style="color:#F87171;font-size:11px;margin-top:10px;min-height:14px"></div>
    </div>
  </div>`;
}

function showAuthScreen() {
  if (document.getElementById('ssAuth')) return;
  document.body.insertAdjacentHTML('beforeend', authScreenHTML());
  const msg = document.getElementById('ssAuthMsg');
  const signInBtn = document.getElementById('ssSignIn');
  signInBtn.onclick = async () => {
    const email = document.getElementById('ssEmail').value.trim();
    const password = document.getElementById('ssPass').value;
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) { msg.textContent = error.message; return; }
    location.reload();
  };
  // Enter key in either email or password triggers Sign In
  ['ssEmail','ssPass'].forEach(id => {
    document.getElementById(id).addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); signInBtn.click(); }
    });
  });
  document.getElementById('ssSignUp').onclick = async () => {
    const email = document.getElementById('ssEmail').value.trim();
    const password = document.getElementById('ssPass').value;
    const name = email.split('@')[0];
    const { error } = await sb.auth.signUp({ email, password, options:{ data:{ name } } });
    if (error) { msg.textContent = error.message; return; }
    msg.style.color = '#34D399';
    msg.textContent = 'Account created. Check email if confirmation is on, then sign in.';
  };
}

async function ssSignOut() { await sb.auth.signOut(); location.reload(); }
window.ssSignOut = ssSignOut;

/* ---------- LOAD: Supabase -> in-memory arrays ----------- */

async function loadAllFromSupabase() {
  // current auth user (for resolving "who am I")
  const { data:{ user } } = await sb.auth.getUser();
  const myAuthId = user?.id || null;

  // team
  const { data: team, error: teamErr } = await sb.from('team_members').select('*').order('created_at');
  if (teamErr) { console.error('[Supabase] team_members load failed:', teamErr); }
  else {
    // Mutate in place so let-scoped TEAM binding in index.html stays in sync
    const newTeam = (team || []).map(t => ({
      id: t.id, name: t.name, email: t.email, phone: t.phone,
      role: t.role, color: t.color, status: t.status, authId: t.auth_id,
      permissions: t.permissions || [], createdAt: new Date(t.created_at).getTime(),
    }));
    if (Array.isArray(window.TEAM)) {
      window.TEAM.length = 0;
      newTeam.forEach(m => window.TEAM.push(m));
    } else {
      window.TEAM = newTeam;
    }
    // who am I? — resolve current logged-in member by auth_id
    window.currentMember = window.TEAM.find(m => m.authId === myAuthId) || null;
    // keep USERS in sync so the board/filters use Supabase team
    if (Array.isArray(window.USERS)) {
      window.USERS.length = 0;
      window.TEAM.forEach(m => window.USERS.push({ id:m.id, name:m.name, color:m.color }));
    }
    __loadedTeamIds = new Set(newTeam.map(m => m.id));
    console.log('[Supabase] loaded', window.TEAM.length, 'team members; you are:', window.currentMember?.role || 'unknown');
    // Show/hide admin-only nav links now that we know the role
    if (typeof window.updateProfitsNavVisibility === 'function') {
      window.updateProfitsNavVisibility();
    }
  }

  // pipelines + stages
  const { data: pipes, error: pipeErr } = await sb.from('pipelines').select('*').order('position');
  const { data: stages, error: stageErr } = await sb.from('stages').select('*').order('position');
  if (pipeErr || stageErr) console.error('[Supabase] pipelines/stages load failed:', pipeErr || stageErr);
  else if (pipes && pipes.length) {
    const newPipelines = pipes.map(p => ({
      id: p.id, name: p.name,
      columns: (stages || []).filter(s => s.pipeline_id === p.id).map(s => ({
        id: s.id, name: s.name, icon: s.icon, color: s.color, locked: s.locked,
        checklist: Array.isArray(s.checklist) ? s.checklist : [],
      })),
    }));
    if (Array.isArray(window.pipelines)) {
      window.pipelines.length = 0;
      newPipelines.forEach(p => window.pipelines.push(p));
    } else {
      window.pipelines = newPipelines;
    }
    __loadedPipelineIds = new Set(pipes.map(p => p.id));
    __loadedStageIds = new Set((stages || []).map(s => s.id));
  }

  // Stages considered "closed" (completed / lost). These are NOT loaded on boot —
  // they're fetched on demand (when the user toggles "Show Completed/Lost" or searches),
  // so initial load stays fast no matter how many completed jobs accumulate.
  // Stages deferred off boot (loaded on demand): Job Completed, Lost Lead, Closed-Denied.
  // Plain "Denied" loads on boot so it stays visible.
  const CLOSED_STAGE_IDS = ['completed','lost-lead','lost_lead','closed-denied'];
  window.CLOSED_STAGE_IDS = CLOSED_STAGE_IDS;

  // Load jobs + their children for a given set of job rows. Shared by the
  // active-on-boot load and the on-demand closed-jobs load.
  async function buildJobsFromRows(jobRows){
    const ids = (jobRows || []).map(r => r.id);
    if(!ids.length) return [];
    // Fetch children only for THESE jobs (not the whole tables).
    const [{ data: deps }, { data: exps }, { data: files }, { data: chk }] = await Promise.all([
      sb.from('deposits').select('*').in('job_id', ids),
      sb.from('expenses').select('*').in('job_id', ids),
      sb.from('job_files').select('*').in('job_id', ids),
      sb.from('stage_checklist_done').select('*').in('job_id', ids),
    ]);
    // Signed URLs for these files.
    const allPaths = (files || []).map(f => f.storage_path).filter(Boolean);
    const urlMap = {};
    if(allPaths.length){
      try {
        const { data: signed } = await sb.storage.from('job-files').createSignedUrls(allPaths, 60*60*24*7);
        (signed || []).forEach(s => { if(s && s.path && s.signedUrl) urlMap[s.path] = s.signedUrl; });
      } catch(e){ console.warn('signed url batch failed', e); }
    }
    const isPdfName = n => /\.pdf$/i.test(n||'');
    const fileRec = f => ({ name: f.name, path: f.storage_path, _id: f.id, url: urlMap[f.storage_path] || null, isPdf: isPdfName(f.name) });
    return (jobRows || []).map(r => {
      const jobFiles = (files || []).filter(f => f.job_id === r.id);
      const photos = { before:[], during:[], after:[] };
      jobFiles.filter(f => f.kind === 'photo').forEach(f => { (photos[f.section] || photos.before).push(fileRec(f)); });
      const byKind = k => jobFiles.filter(f => f.kind === k).map(fileRec);
      const stageChecklistDone = {};
      (chk || []).filter(c => c.job_id === r.id).forEach(c => {
        const rec = window.crmSync.checklistFromRow(c);
        (stageChecklistDone[c.stage_id] ||= {})[c.item_key] = rec;
      });
      return {
        id: r.id, _sb:true,
        name:r.name, phone:r.phone, email:r.email, address:r.address,
        priority:r.priority, user:r.assigned_to, col:r.stage_id, pipeline:r.pipeline_id,
        source:r.source, potVal:String(r.pot_val ?? '0'), paidVal:String(r.paid_val ?? '0'),
        carrier:r.carrier, claimNum:r.claim_num,
        claimType: r.claim_type || '',
        claimStatus: r.claim_status || '',
        policyNum: r.policy_num || '',
        dateOfLoss: r.date_of_loss || '',
        rcv: r.rcv || '',
        acv: r.acv || '',
        deductible: r.deductible || '',
        recoverableDep: r.recoverable_dep || '',
        nonRecoverableDep: r.non_recoverable_dep || '',
        netClaim: r.net_claim || '',
        insEmail: r.ins_email || '',
        adjName: r.adj_name || '',
        adjPhone: r.adj_phone || '',
        inspDate: r.insp_date || '',
        claimNotes: r.claim_notes || '',
        latitude:r.latitude, longitude:r.longitude,
        roofEstimate: r.roof_estimate || null,
        timeline: Array.isArray(r.timeline) ? r.timeline : [],
        buildDate: r.build_date || null,
        buildConfirmed: !!(r.contract && typeof r.contract === 'object' && r.contract.__buildConfirmed),
        zohoCalEventId: (r.contract && typeof r.contract === 'object' && r.contract.__zohoCalEventId) ? r.contract.__zohoCalEventId : undefined,
        cpNetClaim:     (r.contract && r.contract.__cpNetClaim     != null) ? r.contract.__cpNetClaim     : undefined,
        cpDeductible:   (r.contract && r.contract.__cpDeductible   != null) ? r.contract.__cpDeductible   : undefined,
        cpDepreciation: (r.contract && r.contract.__cpDepreciation != null) ? r.contract.__cpDepreciation : undefined,
        cpSupplement:   (r.contract && r.contract.__cpSupplement   != null) ? r.contract.__cpSupplement   : undefined,
        supplementStatus: (r.contract && r.contract.__supplementStatus) ? r.contract.__supplementStatus : undefined,
        supplements: (r.contract && Array.isArray(r.contract.__supplements)) ? r.contract.__supplements : undefined,
        // Overhead & commission settings (admin/manager-editable), stored in contract JSON
        overheadPct:    (r.contract && r.contract.__overheadPct    != null) ? r.contract.__overheadPct    : undefined,
        overheadFlat:   (r.contract && r.contract.__overheadFlat   != null) ? r.contract.__overheadFlat   : undefined,
        commPctPrimary: (r.contract && r.contract.__commPctPrimary != null) ? r.contract.__commPctPrimary : undefined,
        commissions:    (r.contract && Array.isArray(r.contract.__commissions)) ? r.contract.__commissions : [],
        stageChecklistExtra: (r.stage_checklist_extra && typeof r.stage_checklist_extra === 'object') ? r.stage_checklist_extra : {},
        quote: (r.quote && typeof r.quote === 'object') ? r.quote : null,
        quotes: (r.quote && Array.isArray(r.quote.__list)) ? r.quote.__list
                : (r.quote && typeof r.quote === 'object' ? [r.quote] : undefined),
        activeQuote: (r.quote && typeof r.quote.__active === 'number') ? r.quote.__active : undefined,
        abcOrder: (r.abc_order && typeof r.abc_order === 'object') ? r.abc_order : null,
        subVoucher: (r.sub_voucher && typeof r.sub_voucher === 'object') ? r.sub_voucher : null,
        subVouchers: (r.sub_voucher && Array.isArray(r.sub_voucher.__list)) ? r.sub_voucher.__list
                     : (r.sub_voucher && typeof r.sub_voucher === 'object' ? [r.sub_voucher] : []),
        contract: (r.contract && typeof r.contract === 'object') ? r.contract : null,
        commissionPayouts: Array.isArray(r.commission_payouts) ? r.commission_payouts : [],
        projectManager: r.project_manager || null,
        pmFee: (r.pm_fee != null) ? r.pm_fee : 250,
        pmFeePaid: !!r.pm_fee_paid,
        pmFeePaidDate: r.pm_fee_paid_date || null,
        pmFeePaidMethod: r.pm_fee_paid_method || null,
        pmFeePaidNotes: r.pm_fee_paid_notes || null,
        contactLog: Array.isArray(r.contact_log) ? r.contact_log : [],
        nextFollowUp: r.next_follow_up || undefined,
        zoho: (r.zoho && typeof r.zoho === 'object') ? r.zoho : undefined,
        zohoDeleted: (r.zoho_deleted && typeof r.zoho_deleted === 'object') ? r.zoho_deleted : undefined,
        created:new Date(r.created_at).toLocaleString('en-US',
          {month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}),
        deposits:(deps||[]).filter(d=>d.job_id===r.id).map(d=>window.crmSync.depositFromRow(d)),
        expenses:(exps||[]).filter(e=>e.job_id===r.id).map(e=>window.crmSync.expenseFromRow(e)),
        photos, contracts:byKind('contract'), checks:byKind('check'),
        lossFiles:byKind('loss'), roofFiles:byKind('roof'), otherFiles:byKind('other'),
        signedContractFiles:byKind('signed_contract'),
        stageChecklistDone,
      };
    });
  }
  window.__buildJobsFromRows = buildJobsFromRows;

  // BOOT LOAD: active jobs only (exclude closed stages).
  const { data: jobRows, error: jobErr } = await sb.from('jobs')
    .select('*')
    .not('stage_id', 'in', `(${CLOSED_STAGE_IDS.join(',')})`)
    .order('created_at', { ascending:false });

  if (jobErr) { console.error('[Supabase] jobs load failed:', jobErr); }
  else {
    const newJobs = await buildJobsFromRows(jobRows);
    if (Array.isArray(window.jobs)) {
      window.jobs.length = 0;
      newJobs.forEach(j => window.jobs.push(j));
    } else {
      window.jobs = newJobs;
    }
    // Collapse true id duplicates (same expense eid or deposit did) and remember the
    // rows this session loaded. A later save deletes only keys that were in
    // that snapshot and then removed — never rows it has not seen.
    const _dupRemoved = stampJobBaselines(window.jobs);
    __loadedJobIds = new Set((window.jobs || []).map(j => j.id).filter(isPersistedJobId));
    if(_dupRemoved > 0){
      console.log('[Supabase] removed', _dupRemoved, 'true duplicate expense line(s) by id');
      setTimeout(()=>{ if(window.saveToStorage) window.saveToStorage(); }, 1500);
    }
  }
}

// On-demand loader for CLOSED (completed/lost) jobs. Called when the user toggles
// "Show Completed/Lost". Loads them once, merges into window.jobs, and skips if
// already loaded. Keeps boot fast regardless of how many completed jobs exist.
let __closedJobsLoaded = false;
async function loadClosedJobs(force){
  if(__closedJobsLoaded && !force) return true;
  const ids = window.CLOSED_STAGE_IDS || ['completed','denied','closed-denied'];
  try {
    const { data: rows, error } = await sb.from('jobs')
      .select('*')
      .in('stage_id', ids)
      .order('created_at', { ascending:false });
    if(error){ console.error('[Supabase] closed jobs load failed:', error); return false; }
    const closedJobs = await window.__buildJobsFromRows(rows);
    const closedDupes = stampJobBaselines(closedJobs);
    if (__loadedJobIds) {
      closedJobs.forEach(j => { if (isPersistedJobId(j.id)) __loadedJobIds.add(j.id); });
    }
    if (closedDupes > 0) {
      setTimeout(()=>{ if(window.saveToStorage) window.saveToStorage(); }, 1500);
    }
    // Merge: remove any existing copies of these ids, then add.
    const closedIds = new Set(closedJobs.map(j => j.id));
    if(Array.isArray(window.jobs)){
      for(let i = window.jobs.length - 1; i >= 0; i--){
        if(closedIds.has(window.jobs[i].id)) window.jobs.splice(i, 1);
      }
      closedJobs.forEach(j => window.jobs.push(j));
    }
    __closedJobsLoaded = true;
    console.log('[Supabase] loaded', closedJobs.length, 'closed jobs on demand');
    return true;
  } catch(e){
    console.error('[Supabase] loadClosedJobs error', e);
    return false;
  }
}
window.loadClosedJobs = loadClosedJobs;

/* ---------- SAVE: in-memory arrays -> Supabase ----------- */
/* Debounced full upsert. Simple and robust for a small team. */

let saveTimer = null;
let savePending = false;
// SAVE LOCK: overlapping pushes used to each insert a full copy of a job's
// expenses. Only one push may run; extra requests collapse into a single
// follow-up run after the current one finishes.
let __pushRunning = null;
let __pushQueued = false;
function runPushSerialized() {
  if (__pushRunning) { __pushQueued = true; return __pushRunning; }
  __pushRunning = (async () => {
    try {
      do {
        __pushQueued = false;
        // A stalled network request must never block every future save.
        await Promise.race([
          pushAllToSupabase(),
          new Promise(res => setTimeout(() => { console.warn('[Supabase] save took >45s — releasing save lock'); res(); }, 45000)),
        ]);
      } while (__pushQueued);
    } finally {
      __pushRunning = null;
      window.__lastLocalPushAt = Date.now();   // our own echoes land after the push ends
    }
  })();
  return __pushRunning;
}
function scheduleSave() {
  savePending = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { savePending = false; runPushSerialized(); }, 600);
}
// Save right now and wait for it (used by invoice import).
window.flushSaveNow = async function () {
  savePending = false;
  clearTimeout(saveTimer);
  await runPushSerialized();
  if (__pushRunning) await __pushRunning;
};
window.isSaveRunning = () => !!__pushRunning;

// Mobile Safari suspends backgrounded tabs, which can kill a debounced save
// before it fires — leaving a change on the phone that never reaches the cloud.
// When the app is hidden or navigated away, flush any pending save immediately.
function flushPendingSave() {
  if (savePending) {
    savePending = false;
    clearTimeout(saveTimer);
    runPushSerialized();
  }
}
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushPendingSave();
  });
  window.addEventListener('pagehide', flushPendingSave);
  window.addEventListener('blur', flushPendingSave);
}

// Ids this browser has actually loaded. A save may delete only these, and
// only when the user has since removed them from memory. Null until the
// first successful load so a save during boot cannot wipe the database.
let __loadedJobIds = null;
let __loadedPipelineIds = null;
let __loadedStageIds = null;
let __loadedTeamIds = null;

function isPersistedJobId(id) {
  return typeof id === 'string' && id.length > 20;
}

// Normalize legacy categories, collapse id-duplicates, and snapshot the
// child rows this session is allowed to delete later.
function stampJobBaselines(jobs) {
  const S = window.crmSync;
  let removed = 0;
  (jobs || []).forEach(j => {
    if (!Array.isArray(j.expenses)) j.expenses = [];
    // Snapshot before renaming legacy "Labor" → "Roofing Labor", so that
    // rename is a local edit (updated in place) rather than looking like a
    // newer server value we should copy back.
    const expBase = S.captureBaseline(j.expenses, {
      keyOf: e => e._eid, rowIdOf: e => e._rowId, fingerprint: S.expenseFingerprint,
    });
    j.expenses.forEach(e => {
      if (e && (e.cat === 'Labor' || e.cat === 'labor')) e.cat = 'Roofing Labor';
    });
    const expDeduped = S.dedupeExpenses(j.expenses);
    removed += j.expenses.length - expDeduped.kept.length;
    j.expenses = expDeduped.kept;
    S.noteRemovals(expBase, expDeduped.removedKeys, expDeduped.kept, e => e._eid);

    if (!Array.isArray(j.deposits)) j.deposits = [];
    const depBase = S.captureBaseline(j.deposits, {
      keyOf: d => d._did, rowIdOf: d => d._rowId, fingerprint: S.depositFingerprint,
    });
    const depDeduped = S.dedupeByKey(j.deposits, d => d._did);
    removed += j.deposits.length - depDeduped.kept.length;
    j.deposits = depDeduped.kept;
    S.noteRemovals(depBase, depDeduped.removedKeys, depDeduped.kept, d => d._did);

    const flat = S.flattenChecklist(j.stageChecklistDone);
    const chkBase = S.captureBaseline(flat, {
      keyOf: r => S.checklistKey(r.stageId, r.itemKey),
      rowIdOf: r => r._rowId,
      fingerprint: S.checklistFingerprint,
    });
    const chkDeduped = S.dedupeByKey(flat, r => S.checklistKey(r.stageId, r.itemKey));
    removed += flat.length - chkDeduped.kept.length;
    if (chkDeduped.removedKeys.length) {
      j.stageChecklistDone = {};
      chkDeduped.kept.forEach(rec => {
        (j.stageChecklistDone[rec.stageId] ||= {})[rec.itemKey] = rec;
      });
    }
    S.noteRemovals(chkBase, chkDeduped.removedKeys, chkDeduped.kept, r => S.checklistKey(r.stageId, r.itemKey));

    j.__childSync = { expenses: expBase, deposits: depBase, checklist: chkBase };
  });
  return removed;
}

async function selectAllIds(table) {
  const out = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from(table).select('id').range(from, from + PAGE - 1);
    if (error) return { data: null, error };
    out.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return { data: out, error: null };
}

async function selectByJobIds(table, jobIds) {
  if (!jobIds.length) return { data: [], error: null };
  const out = [];
  const CHUNK = 50;
  const PAGE = 1000;
  for (let i = 0; i < jobIds.length; i += CHUNK) {
    const slice = jobIds.slice(i, i + CHUNK);
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await sb.from(table).select('*').in('job_id', slice).range(from, from + PAGE - 1);
      if (error) return { data: null, error };
      out.push(...(data || []));
      if (!data || data.length < PAGE) break;
    }
  }
  return { data: out, error: null };
}

function groupByJobId(rows) {
  const map = new Map();
  for (const row of rows || []) {
    if (!map.has(row.job_id)) map.set(row.job_id, []);
    map.get(row.job_id).push(row);
  }
  return map;
}

function applyKeyedPlan(list, plan, keyOf) {
  const drop = new Set(plan.dropKeys);
  const next = (list || []).filter(item => item && !drop.has(keyOf(item)));
  for (const rep of plan.replace) {
    const idx = next.findIndex(item => keyOf(item) === rep.key);
    if (idx >= 0) next[idx] = rep.item;
    else next.push(rep.item);
  }
  const have = new Set(next.map(keyOf));
  for (const item of plan.adopt) {
    const k = keyOf(item);
    if (k && !have.has(k)) { next.push(item); have.add(k); }
  }
  return next;
}

function applyChecklistPlan(done, plan) {
  const S = window.crmSync;
  const next = (done && typeof done === 'object') ? done : {};
  for (const key of plan.dropKeys) {
    const { stageId, itemKey } = S.splitChecklistKey(key);
    if (next[stageId]) delete next[stageId][itemKey];
  }
  for (const rep of plan.replace) {
    const { stageId, itemKey } = S.splitChecklistKey(rep.key);
    (next[stageId] ||= {})[itemKey] = rep.item;
  }
  for (const item of plan.adopt) {
    (next[item.stageId] ||= {})[item.itemKey] = item;
  }
  return next;
}

async function writeKeyedRows(table, jobId, plan, toRow, matchInsert, findExisting) {
  let ok = true;
  const inserts = plan.writes.filter(w => !w.existingId);
  const updates = plan.writes.filter(w => w.existingId);
  if (inserts.length) {
    const rows = inserts.map(w => ({ ...toRow(w.item), job_id: jobId }));
    const { data, error } = await sb.from(table).insert(rows).select('*');
    if (!error && data) {
      inserts.forEach((w, i) => {
        const match = (matchInsert && matchInsert(data, w.item)) || (data.length === inserts.length ? data[i] : null);
        if (match && match.id) w.item._rowId = w.item._id = match.id;
      });
    } else {
      console.error('[Supabase] ' + table + ' insert failed, retrying row by row:', error);
      for (let i = 0; i < inserts.length; i++) {
        const row = rows[i];
        let { data: one, error: oneErr } = await sb.from(table).insert(row).select('id').maybeSingle();
        if (oneErr && findExisting && /duplicate|unique/i.test((oneErr.message || '') + ' ' + (oneErr.details || ''))) {
          try {
            const existing = await findExisting(row);
            if (existing && existing.id) {
              const payload = { ...row };
              delete payload.job_id;
              const { error: updErr } = await sb.from(table).update(payload).eq('id', existing.id);
              if (updErr) { ok = false; console.error('[Supabase] ' + table + ' conflict update failed:', updErr); }
              else inserts[i].item._rowId = inserts[i].item._id = existing.id;
              continue;
            }
          } catch (e) { console.error(e); }
        }
        if (oneErr) {
          ok = false;
          console.error('[Supabase] ' + table + ' row rejected:', row, oneErr);
        } else if (one) {
          inserts[i].item._rowId = inserts[i].item._id = one.id;
        }
      }
    }
  }
  for (const w of updates) {
    const { error } = await sb.from(table).update(toRow(w.item)).eq('id', w.existingId);
    if (error) {
      ok = false;
      console.error('[Supabase] ' + table + ' update failed:', w.existingId, error);
    } else {
      w.item._rowId = w.item._id = w.existingId;
    }
  }
  if (ok && plan.deleteIds.length) {
    for (let i = 0; i < plan.deleteIds.length; i += 100) {
      const chunk = plan.deleteIds.slice(i, i + 100);
      const { error } = await sb.from(table).delete().in('id', chunk);
      if (error) {
        ok = false;
        console.error('[Supabase] ' + table + ' delete failed:', error);
      }
    }
  }
  return ok;
}

// Merge one child table for one job. Patches in-memory rows either way so a
// stale tab drops keys the server deleted and picks up keys it never loaded.
// The baseline (what this session is allowed to overwrite or delete) advances
// only after the writes succeed.
async function syncKeyedCollection(j, slot, localList, serverRows, spec, toRow, keyOf, fingerprint, baselineSpec, patch, findExisting) {
  const S = window.crmSync;
  if (!j.__childSync) j.__childSync = {};
  if (!j.__childSync[slot]) j.__childSync[slot] = S.emptyBaseline();
  const plan = S.planKeyedSync(Object.assign({
    local: localList,
    server: serverRows || [],
    baseline: j.__childSync[slot],
  }, spec));
  const table = slot === 'checklist' ? 'stage_checklist_done' : slot;
  const matchInsert = (data, item) => {
    if (table === 'expenses') return data.find(r => r.eid && r.eid === item._eid) || null;
    if (table === 'deposits') return data.find(r => r.did && r.did === item._did) || null;
    if (table === 'stage_checklist_done') {
      return data.find(r => r.stage_id === item.stageId && r.item_key === item.itemKey) || null;
    }
    return null;
  };
  const ok = await writeKeyedRows(table, j.id, plan, toRow, matchInsert, findExisting);
  patch(plan);
  if (ok) {
    j.__childSync[slot] = S.captureBaseline(baselineSpec.items(), baselineSpec);
  } else {
    const b = j.__childSync[slot];
    for (const k of plan.dropKeys.concat(plan.deleteKeys)) {
      if (k && !b.removedKeys.includes(k)) b.removedKeys.push(k);
      if (k) delete b.fingerprints[k];
    }
    if (!window.__childSyncFailureToasted && window.toast) {
      window.__childSyncFailureToasted = true;
      window.toast('Some ' + slot + ' changes did not save — they will retry');
    }
  }
  const notable = plan.conflicts.filter(c => c.reason === 'both-changed' || c.reason === 'deleted-on-server');
  if (plan.adopt.length || plan.dropKeys.length || plan.deleteIds.length || plan.writes.length) {
    console.log('[Supabase] merged ' + slot, j.name || j.id, {
      insert: plan.writes.filter(w => !w.existingId).length,
      update: plan.writes.filter(w => w.existingId).length,
      delete: plan.deleteIds.length,
      keptFromServer: plan.adopt.length,
      droppedStale: plan.dropKeys.length,
    });
  }
  return notable.length > 0;
}

async function pushAllToSupabase() {
  window.__lastLocalPushAt = Date.now();
  window.__childSyncFailureToasted = false;
  try {
    // Build base rows without id, then categorize
    const newJobs = [];        // no real UUID yet — needs insert without id
    const newJobIndices = [];  // their index in window.jobs for writeback
    const existingJobs = [];   // has UUID — safe to upsert with id
    // Jobs this session loaded and the user has removed. Applied after the
    // upsert so a failed upsert cannot delete them first. Jobs this session
    // never loaded (closed jobs, jobs created in another tab) are left alone.
    // Jobs deleted on the server are dropped locally so this tab does not
    // upsert them back into existence.
    let jobIdsToDelete = [];
    if (__loadedJobIds) {
      const { data: remoteJobRows, error: idErr } = await selectAllIds('jobs');
      if (idErr) console.error('[Supabase] could not list job ids — skipping job delete/resurrection check:', idErr);
      else {
        const plan = window.crmSync.planIdDeletes(
          __loadedJobIds,
          (window.jobs || []).map(j => j.id),
          (remoteJobRows || []).map(r => r.id),
        );
        jobIdsToDelete = plan.deleteIds;
        if (plan.dropLocalIds.length) {
          const drop = new Set(plan.dropLocalIds);
          console.warn('[Supabase] not resurrecting jobs deleted elsewhere:', plan.dropLocalIds);
          if (window.toast) window.toast('A job was deleted in another session and was not restored');
          for (let i = window.jobs.length - 1; i >= 0; i--) {
            if (drop.has(window.jobs[i].id)) window.jobs.splice(i, 1);
          }
          // Forget these ids. If the same row shows up again (the other save
          // was still in flight), the next save must not treat it as a job
          // this user deleted — that delete cascades to expenses and files.
          plan.dropLocalIds.forEach(id => __loadedJobIds.delete(id));
          try { if (typeof window.renderBoard === 'function') window.renderBoard(); } catch (e) { console.warn(e); }
        }
      }
    }

    (window.jobs || []).forEach((j, i) => {
      const base = {
        pipeline_id: j.pipeline || 'insurance',
        stage_id: j.col,
        assigned_to: j.user || null,
        name: j.name, phone: j.phone, email: j.email, address: j.address,
        priority: j.priority, source: j.source,
        pot_val: parseFloat(j.potVal || 0), paid_val: parseFloat(j.paidVal || 0),
        carrier: j.carrier || null, claim_num: j.claimNum || null,
        claim_type: j.claimType || null,
        claim_status: j.claimStatus || null,
        policy_num: j.policyNum || null,
        date_of_loss: j.dateOfLoss || null,
        rcv: j.rcv || null,
        acv: j.acv || null,
        deductible: j.deductible || null,
        recoverable_dep: j.recoverableDep || null,
        non_recoverable_dep: j.nonRecoverableDep || null,
        net_claim: j.netClaim || null,
        ins_email: j.insEmail || null,
        adj_name: j.adjName || null,
        adj_phone: j.adjPhone || null,
        insp_date: j.inspDate || null,
        claim_notes: j.claimNotes || null,
        latitude: j.latitude ?? null, longitude: j.longitude ?? null,
        roof_estimate: j.roofEstimate ?? null,
        timeline: Array.isArray(j.timeline) ? j.timeline : [],
        build_date: j.buildDate || null,
        stage_checklist_extra: (j.stageChecklistExtra && typeof j.stageChecklistExtra === 'object') ? j.stageChecklistExtra : {},
        quote: (() => {
          // Persist the full quotes array + active index (multi-quote). Wrapped
          // so a legacy single-quote reader still finds the active quote.
          const list = Array.isArray(j.quotes) ? j.quotes
            : (j.quote && typeof j.quote==='object' ? [j.quote] : []);
          if(!list.length) return null;
          const active = (typeof j.activeQuote==='number') ? j.activeQuote : 0;
          return { __list: list, __active: active, ...(list[active] || list[0]) };
        })(),
        abc_order: (j.abcOrder && typeof j.abcOrder === 'object') ? j.abcOrder : null,
        sub_voucher: (() => {
          // Persist the full vouchers array (multi-vendor). Wrapped so the
          // single legacy voucher still loads for older readers.
          const list = Array.isArray(j.subVouchers) ? j.subVouchers
            : (j.subVoucher && typeof j.subVoucher==='object' ? [j.subVoucher] : []);
          if(!list.length) return null;
          return { __list: list, ...(j.subVoucher && typeof j.subVoucher==='object' ? j.subVoucher : list[list.length-1]) };
        })(),
        contract: (() => {
          const base = (j.contract && typeof j.contract === 'object') ? { ...j.contract } : {};
          base.__buildConfirmed = !!j.buildConfirmed;
          if(j.zohoCalEventId) base.__zohoCalEventId = j.zohoCalEventId;
          // Contract-price breakdown (Net Claim / Deductible / Depreciation /
          // Supplements). These aren't their own columns, so persist them here
          // in the contract JSON so they survive syncs.
          base.__cpNetClaim    = (j.cpNetClaim != null) ? j.cpNetClaim : null;
          base.__cpDeductible  = (j.cpDeductible != null) ? j.cpDeductible : null;
          base.__cpDepreciation= (j.cpDepreciation != null) ? j.cpDepreciation : null;
          base.__cpSupplement  = (j.cpSupplement != null) ? j.cpSupplement : null;
          base.__supplementStatus = j.supplementStatus || null;
          base.__supplements = Array.isArray(j.supplements) ? j.supplements : null;
          // Overhead & commission settings (no dedicated columns — persisted here)
          base.__overheadPct    = (j.overheadPct    != null && j.overheadPct    !== '') ? parseFloat(j.overheadPct)    : null;
          base.__overheadFlat   = (j.overheadFlat   != null && j.overheadFlat   !== '') ? parseFloat(j.overheadFlat)   : null;
          base.__commPctPrimary = (j.commPctPrimary != null && j.commPctPrimary !== '') ? parseFloat(j.commPctPrimary) : null;
          base.__commissions    = Array.isArray(j.commissions)
            ? j.commissions.map(c => ({ name: c.name || '', pct: parseFloat(c.pct || 0) || 0 }))
            : [];
          return base;
        })(),
        commission_payouts: Array.isArray(j.commissionPayouts) ? j.commissionPayouts : [],
        project_manager: j.projectManager || null,
        pm_fee: (j.pmFee != null) ? j.pmFee : 250,
        pm_fee_paid: !!j.pmFeePaid,
        pm_fee_paid_date: j.pmFeePaidDate || null,
        pm_fee_paid_method: j.pmFeePaidMethod || null,
        pm_fee_paid_notes: j.pmFeePaidNotes || null,
        contact_log: Array.isArray(j.contactLog) ? j.contactLog : [],
        next_follow_up: j.nextFollowUp || null,
        zoho: (j.zoho && typeof j.zoho === 'object') ? j.zoho : null,
        zoho_deleted: (j.zohoDeleted && typeof j.zohoDeleted === 'object') ? j.zohoDeleted : null,
      };
      if (typeof j.id === 'string' && j.id.length > 20) {
        existingJobs.push({ ...base, id: j.id });
      } else {
        newJobs.push(base);
        newJobIndices.push(i);
      }
    });

    // Insert new ones (no id column → database default generates UUIDs)
    if (newJobs.length) {
      const { data, error } = await sb.from('jobs').insert(newJobs).select();
      if (error) throw error;
      data.forEach((row, k) => {
        const localIdx = newJobIndices[k];
        if (window.jobs[localIdx]) window.jobs[localIdx].id = row.id;
      });
    }
    // Upsert existing ones (id column present and valid)
    if (existingJobs.length) {
      const { error } = await sb.from('jobs').upsert(existingJobs);
      if (error) {
        // Surface a missing-column error clearly so it's obvious which migration to run
        const msg = (error.message || '') + ' ' + (error.details || '') + ' ' + (error.hint || '');
        console.error('[Supabase] jobs upsert failed:', error);
        if (/column .* does not exist|could not find the .* column|schema cache/i.test(msg)) {
          const col = (msg.match(/'([a-z_]+)'/) || msg.match(/column "?([a-z_]+)"?/i) || [])[1];
          const banner = `Supabase is missing a column${col ? `: "${col}"` : ''}. Run the pending SQL migration in Supabase, then refresh.`;
          if (typeof window !== 'undefined' && window.toast) window.toast(banner);
          console.error('[Supabase] ' + banner);
        }
        throw error;
      }
    }

    if (jobIdsToDelete.length) {
      const { error: delErr } = await sb.from('jobs').delete().in('id', jobIdsToDelete);
      if (delErr) console.error('[Supabase] delete jobs failed:', delErr);
      else if (__loadedJobIds) jobIdsToDelete.forEach(id => __loadedJobIds.delete(id));
    }
    if (__loadedJobIds) {
      (window.jobs || []).forEach(j => { if (isPersistedJobId(j.id)) __loadedJobIds.add(j.id); });
    }

    // Child rows are merged by stable key (expense eid, deposit did, checklist
    // item). A stale tab updates only rows it changed, deletes only rows it
    // removed, and leaves rows it never loaded in place. created_at is not
    // written on update, so saving a job no longer resets it.
    // job_files are not rewritten here — uploads and deletes go through
    // uploadJobFile / deleteJobFile — so an expense merge cannot drop invoices.
    if (!__loadedJobIds) {
      console.warn('[Supabase] initial load has not finished — skipping child-row sync');
    } else {
    const persistedIds = (window.jobs || []).map(j => j.id).filter(isPersistedJobId);
    const [expRes, depRes, chkRes] = await Promise.all([
      selectByJobIds('expenses', persistedIds),
      selectByJobIds('deposits', persistedIds),
      selectByJobIds('stage_checklist_done', persistedIds),
    ]);
    if (expRes.error) console.error('[Supabase] expense read failed — leaving expense rows untouched:', expRes.error);
    if (depRes.error) console.error('[Supabase] deposit read failed — leaving deposit rows untouched:', depRes.error);
    if (chkRes.error) console.error('[Supabase] checklist read failed — leaving checklist rows untouched:', chkRes.error);
    const expByJob = groupByJobId(expRes.data);
    const depByJob = groupByJobId(depRes.data);
    const chkByJob = groupByJobId(chkRes.data);
    const conflictJobs = [];
    const S = window.crmSync;
    for (const j of (window.jobs || [])) {
      if (!isPersistedJobId(j.id)) continue;
      if (!j.__childSync) {
        j.__childSync = {
          expenses: S.emptyBaseline(),
          deposits: S.emptyBaseline(),
          checklist: S.emptyBaseline(),
        };
      }
      if (!expRes.error) {
        const hit = await syncKeyedCollection(
          j, 'expenses', j.expenses || [], expByJob.get(j.id) || [],
          S.expenseSyncSpec(), S.expenseToRow, e => e._eid, S.expenseFingerprint,
          { keyOf: e => e._eid, rowIdOf: e => e._rowId, fingerprint: S.expenseFingerprint, items: () => j.expenses || [] },
          (plan) => { j.expenses = applyKeyedPlan(j.expenses, plan, e => e._eid); },
          async (row) => {
            if (!row.eid) return null;
            const { data } = await sb.from('expenses').select('id').eq('eid', row.eid).limit(1);
            return data && data[0];
          },
        );
        if (hit) conflictJobs.push(j.name || 'a job');
      }
      if (!depRes.error) {
        const hit = await syncKeyedCollection(
          j, 'deposits', j.deposits || [], depByJob.get(j.id) || [],
          S.depositSyncSpec(), S.depositToRow, d => d._did, S.depositFingerprint,
          { keyOf: d => d._did, rowIdOf: d => d._rowId, fingerprint: S.depositFingerprint, items: () => j.deposits || [] },
          (plan) => { j.deposits = applyKeyedPlan(j.deposits, plan, d => d._did); },
          async (row) => {
            if (!row.did) return null;
            const { data } = await sb.from('deposits').select('id').eq('did', row.did).limit(1);
            return data && data[0];
          },
        );
        if (hit) conflictJobs.push(j.name || 'a job');
      }
      j._depsCleared = false;
      if (!chkRes.error) {
        const flat = S.flattenChecklist(j.stageChecklistDone);
        const hit = await syncKeyedCollection(
          j, 'checklist', flat, chkByJob.get(j.id) || [],
          S.checklistSyncSpec(), S.checklistToRow,
          r => S.checklistKey(r.stageId, r.itemKey), S.checklistFingerprint,
          {
            keyOf: r => S.checklistKey(r.stageId, r.itemKey),
            rowIdOf: r => r._rowId,
            fingerprint: S.checklistFingerprint,
            items: () => S.flattenChecklist(j.stageChecklistDone),
          },
          (plan) => { j.stageChecklistDone = applyChecklistPlan(j.stageChecklistDone, plan); },
          async (row) => {
            const { data } = await sb.from('stage_checklist_done').select('id')
              .eq('job_id', j.id).eq('stage_id', row.stage_id).eq('item_key', row.item_key).limit(1);
            return data && data[0];
          },
        );
        if (hit) conflictJobs.push(j.name || 'a job');
      }
    }
    if (conflictJobs.length && window.toast) {
      const names = [...new Set(conflictJobs)].slice(0, 3).join(', ');
      window.toast('Kept newer changes from another session on ' + names);
    }
    }

    // ── Pipelines & stages: upsert current, delete what's gone ──
    // Only admins and managers can write to these tables (per RLS).
    // Skip the sync for salesmen to avoid 403 errors filling the console.
    // List remote ids BEFORE the upsert so a pipeline or stage deleted in
    // another session is dropped locally instead of written back.
    const myRole = window.currentMember?.role;
    const canManageBoards = (myRole === 'admin' || myRole === 'manager');
    if (canManageBoards && __loadedPipelineIds) {
      const { data: remotePipes, error: rpErr } = await selectAllIds('pipelines');
      if (rpErr) console.error('[Supabase] pipelines list failed — leaving pipeline rows untouched:', rpErr);
      else {
        const plan = window.crmSync.planIdDeletes(
          __loadedPipelineIds,
          (window.pipelines || []).map(p => p.id),
          (remotePipes || []).map(r => r.id),
        );
        if (plan.dropLocalIds.length && Array.isArray(window.pipelines)) {
          const drop = new Set(plan.dropLocalIds);
          console.warn('[Supabase] not resurrecting pipelines deleted elsewhere:', plan.dropLocalIds);
          for (let i = window.pipelines.length - 1; i >= 0; i--) {
            if (!drop.has(window.pipelines[i].id)) continue;
            (window.pipelines[i].columns || []).forEach(c => {
              if (c && c.id && __loadedStageIds) __loadedStageIds.delete(c.id);
            });
            window.pipelines.splice(i, 1);
          }
          plan.dropLocalIds.forEach(id => __loadedPipelineIds.delete(id));
        }
        const localPipelines = window.pipelines || [];
        if (localPipelines.length) {
          const pipeRows = localPipelines.map((p, i) => ({
            id: p.id, name: p.name, position: i,
          }));
          const { error: pipeErr } = await sb.from('pipelines').upsert(pipeRows);
          if (pipeErr) console.error('[Supabase] pipelines upsert failed:', pipeErr);
        }
        let pipeDeleteOk = true;
        if (plan.deleteIds.length) {
          const { error: pdErr } = await sb.from('pipelines').delete().in('id', plan.deleteIds);
          if (pdErr) { pipeDeleteOk = false; console.error('[Supabase] pipelines delete failed:', pdErr); }
          else plan.deleteIds.forEach(id => __loadedPipelineIds.delete(id));
        }
        if (pipeDeleteOk) {
          (window.pipelines || []).forEach(p => { if (p && p.id) __loadedPipelineIds.add(p.id); });
        }
      }

      if (__loadedStageIds) {
        const { data: remoteStages, error: rsErr } = await selectAllIds('stages');
        if (rsErr) console.error('[Supabase] stages list failed — leaving stage rows untouched:', rsErr);
        else {
          const stagePayload = () => {
            const rows = [];
            (window.pipelines || []).forEach(p => {
              (p.columns || []).forEach((c, i) => {
                rows.push({
                  id: c.id, pipeline_id: p.id, name: c.name,
                  icon: c.icon || null, color: c.color || null,
                  locked: !!c.locked, position: i,
                  checklist: Array.isArray(c.checklist) ? c.checklist : [],
                });
              });
            });
            return rows;
          };
          const plan = window.crmSync.planIdDeletes(
            __loadedStageIds,
            stagePayload().map(s => s.id),
            (remoteStages || []).map(r => r.id),
          );
          if (plan.dropLocalIds.length) {
            const drop = new Set(plan.dropLocalIds);
            console.warn('[Supabase] not resurrecting stages deleted elsewhere:', plan.dropLocalIds);
            (window.pipelines || []).forEach(p => {
              if (Array.isArray(p.columns)) p.columns = p.columns.filter(c => c && !drop.has(c.id));
            });
            plan.dropLocalIds.forEach(id => __loadedStageIds.delete(id));
          }
          const liveStageRows = stagePayload();
          if (liveStageRows.length) {
            const { error: stageErr } = await sb.from('stages').upsert(liveStageRows);
            if (stageErr) console.error('[Supabase] stages upsert failed:', stageErr);
          }
          let stageDeleteOk = true;
          if (plan.deleteIds.length) {
            const { error: sdErr } = await sb.from('stages').delete().in('id', plan.deleteIds);
            if (sdErr) { stageDeleteOk = false; console.error('[Supabase] stages delete failed:', sdErr); }
            else plan.deleteIds.forEach(id => __loadedStageIds.delete(id));
          }
          if (stageDeleteOk) {
            (window.pipelines || []).forEach(p => {
              (p.columns || []).forEach(c => { if (c && c.id) __loadedStageIds.add(c.id); });
            });
          }
        }
      }
    }
  } catch (e) {
    console.error('Supabase save failed', e);
    if (typeof toast === 'function') toast('Sync failed — changes saved locally');
  }
}

/* ---------- TEAM save ------------------------------------ */
async function pushTeamToSupabase() {
  try {
    const teamRows = () => (window.TEAM || []).map(t => ({
      id: t.id, name: t.name, email: t.email, phone: t.phone,
      role: t.role, color: t.color, status: t.status, permissions: t.permissions || [],
    }));
    // Delete members this session loaded and the user has since removed.
    // A member added in another session is not in __loadedTeamIds and stays.
    // Members deleted on the server are dropped before the upsert so this
    // tab does not recreate them.
    if (__loadedTeamIds) {
      const { data: remote, error: remoteErr } = await selectAllIds('team_members');
      if (remoteErr) {
        console.error('[Supabase] team list failed — leaving team rows untouched:', remoteErr);
        return;
      }
      const plan = window.crmSync.planIdDeletes(__loadedTeamIds, teamRows().map(r => r.id), (remote || []).map(r => r.id));
        if (plan.dropLocalIds.length && Array.isArray(window.TEAM)) {
          const drop = new Set(plan.dropLocalIds);
          console.warn('[Supabase] not resurrecting team members deleted elsewhere:', plan.dropLocalIds);
          for (let i = window.TEAM.length - 1; i >= 0; i--) {
            if (drop.has(window.TEAM[i].id)) window.TEAM.splice(i, 1);
          }
          if (Array.isArray(window.USERS)) {
            for (let i = window.USERS.length - 1; i >= 0; i--) {
              if (drop.has(window.USERS[i].id)) window.USERS.splice(i, 1);
            }
          }
          plan.dropLocalIds.forEach(id => __loadedTeamIds.delete(id));
        }
        const rows = teamRows();
        if (rows.length) {
          const { error } = await sb.from('team_members').upsert(rows);
          if (error) console.error('[Supabase] team upsert failed:', error);
        }
        let teamDeleteOk = true;
        if (plan.deleteIds.length) {
          const { error: delErr } = await sb.from('team_members').delete().in('id', plan.deleteIds);
          if (delErr) { teamDeleteOk = false; console.error('[Supabase] team delete failed:', delErr); }
          else plan.deleteIds.forEach(id => __loadedTeamIds.delete(id));
        }
        if (teamDeleteOk) {
          (window.TEAM || []).forEach(t => { if (t && t.id) __loadedTeamIds.add(t.id); });
        }
        return;
    }
    const rows = teamRows();
    if (rows.length) {
      const { error } = await sb.from('team_members').upsert(rows);
      if (error) console.error('[Supabase] team upsert failed:', error);
    }
  } catch (e) { console.error('team sync failed', e); }
}

/* ---------- Fetch the public-safe map view (all jobs, addresses only) */
async function fetchMapView() {
  const { data, error } = await sb.from('jobs_map_view').select('*');
  if (error) { console.error('[Supabase] jobs_map_view load failed:', error); return []; }
  return data || [];
}
window.fetchMapView = fetchMapView;

/* ---------- FILE upload helper (use in photo/contract tabs) */
async function uploadJobFile(jobId, kind, section, file) {
  const safeName = (file.name||'file').replace(/[^\w.\-]+/g,'_');
  const path = `${jobId}/${kind}/${Date.now()}-${safeName}`;
  console.log('[uploadJobFile] uploading to', path, 'size', file.size, 'type', file.type);
  const { error } = await sb.storage.from('job-files').upload(path, file, { contentType: file.type || undefined });
  if (error) { console.error('[Supabase] file upload failed:', error.message || error); return null; }
  const { data: row, error: insErr } = await sb.from('job_files').insert({
    job_id: jobId, kind, section: section || null, name: file.name, storage_path: path,
  }).select().maybeSingle();
  if (insErr) { console.error('[Supabase] job_files insert failed:', insErr.message || insErr); }
  const { data } = await sb.storage.from('job-files').createSignedUrl(path, 60*60*24*7);
  console.log('[uploadJobFile] success', { path, hasUrl: !!data?.signedUrl, rowId: row?.id });
  return { name:file.name, path, url:data?.signedUrl, _id: row?.id, isPdf: /\.pdf$/i.test(file.name) || file.type==='application/pdf' };
}
window.uploadJobFile = uploadJobFile;

/* ---------- COMPANY DOCUMENTS storage ---------- */
// Files for the Company Documents page aren't tied to a job, so they upload
// straight to the storage bucket (no job_files row). Refs are stored in the
// company_docs app_settings jsonb instead.
async function uploadCompanyDocFile(sectionId, file){
  const safeName = (file.name||'file').replace(/[^\w.\-]+/g,'_');
  const path = `company-docs/${sectionId}/${Date.now()}-${safeName}`;
  const { error } = await sb.storage.from('job-files').upload(path, file, { contentType: file.type || undefined });
  if(error){ console.error('[company-docs] upload failed:', error.message || error); return null; }
  const { data } = await sb.storage.from('job-files').createSignedUrl(path, 60*60*24*7);
  return { name:file.name, path, url:data?.signedUrl, isPdf: /\.pdf$/i.test(file.name) || file.type==='application/pdf' };
}
window.uploadCompanyDocFile = uploadCompanyDocFile;

async function deleteCompanyDocFile(path){
  if(!path) return;
  try { await sb.storage.from('job-files').remove([path]); }
  catch(e){ console.warn('[company-docs] delete failed', e); }
}
window.deleteCompanyDocFile = deleteCompanyDocFile;

// Re-sign a stored path (signed URLs expire after 7 days).
async function signCompanyDocFile(path){
  if(!path) return null;
  try {
    const { data } = await sb.storage.from('job-files').createSignedUrl(path, 60*60*24*7);
    return data?.signedUrl || null;
  } catch(e){ return null; }
}
window.signCompanyDocFile = signCompanyDocFile;
// Same bucket — used to re-sign job files (e.g. commission check copies) on demand
window.signJobFilePath = signCompanyDocFile;

// Load + save the company_docs sections array (notes + file refs) via app_settings.
async function loadCompanyDocs(){
  if(!window.sb) return null;
  try {
    const { data, error } = await window.sb.from('app_settings').select('value').eq('key', 'company_docs').maybeSingle();
    if(error){ console.warn('company_docs load failed', error); return null; }
    return (data?.value && Array.isArray(data.value.sections)) ? data.value : null;
  } catch(e){ console.warn('company_docs load error', e); return null; }
}
window.loadCompanyDocs = loadCompanyDocs;

async function saveCompanyDocs(docObj){
  if(!window.sb) return;
  try {
    await window.sb.from('app_settings').upsert({
      key: 'company_docs', value: docObj, updated_at: new Date().toISOString(),
    }, { onConflict: 'key' });
  } catch(e){ console.warn('company_docs save error', e); }
}
window.saveCompanyDocs = saveCompanyDocs;

/* ---------- FILE delete helper */
async function deleteJobFile(rec){
  if(!rec) return;
  try {
    if(rec.path) await sb.storage.from('job-files').remove([rec.path]);
    if(rec._id) await sb.from('job_files').delete().eq('id', rec._id);
    else if(rec.path) await sb.from('job_files').delete().eq('storage_path', rec.path);
  } catch(e){ console.warn('file delete failed', e); }
}
window.deleteJobFile = deleteJobFile;

/* ---------- OVERRIDE the app's storage functions --------- */
function installOverrides() {
  window.saveToStorage = scheduleSave;
  window.loadFromStorage = () => {};   // no-op; we load async at boot
  window.saveTeam = function () {
    // keep the app's USERS-sync behavior, then push to Supabase
    pushTeamToSupabase();
  };
}

/* ---------- BOOT ----------------------------------------- */
async function bootSupabase() {
  const { data:{ session } } = await sb.auth.getSession();
  if (!session) { showAuthScreen(); return false; }
  console.log('[Supabase] signed in as', session.user.email);
  installOverrides();
  await loadAllFromSupabase();
  console.log('[Supabase] boot complete. jobs:', (window.jobs||[]).length, 'team:', (window.TEAM||[]).length);
  // Data has arrived — re-render whatever page the user is currently on so it
  // populates (fixes blank pages when navigating during the initial load).
  if (typeof window.rerenderActivePage === 'function') {
    window.rerenderActivePage();
  }
  // Start live cross-user updates.
  try { startRealtime(); } catch(e){ console.warn('[Realtime] start failed', e); }
  return true;
}
window.bootSupabase = bootSupabase;

/* ---------- REALTIME (Option 1): live updates across users ----------
 * Subscribes to changes on jobs/expenses/deposits/stages/team. When another
 * user changes something, we re-pull in the background so every client stays
 * current WITHOUT a manual refresh.
 *
 * Safety rules (learned from prior data-loss issues):
 *  - Suppress echoes of our OWN just-pushed writes (5s window) so we don't
 *    fight our own debounced save.
 *  - NEVER refresh while the user is actively editing a job detail panel or
 *    has a modal open — queue it and apply when they're done, so an incoming
 *    change can't clobber what they're typing.
 *  - Debounce bursts of changes into a single re-pull.
 */
let __rtChannel = null;
let __rtPullTimer = null;
let __rtPendingPull = false;
window.__lastLocalPushAt = 0;   // set by pushAllToSupabase on every write

function __userIsBusyEditing(){
  // Don't yank data out from under an active edit.
  if (document.querySelector('.modal.open, #addJobModal.open')) return true;
  // A job detail panel is open AND focused input/textarea is inside it.
  const ae = document.activeElement;
  if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT' || ae.isContentEditable)) return true;
  // An inline add form (expense / deposit) is open — a re-render would close
  // it and throw away what's been entered, even if focus is on a button/dropdown.
  const openForm = ['expAddForm', 'depAddForm'].some(id => {
    const el = document.getElementById(id);
    return el && el.style.display !== 'none' && el.offsetParent !== null;
  });
  if (openForm) return true;
  // Invoice import preview is showing.
  if (document.getElementById('abcConfirm')) return true;
  return false;
}

async function __rtDoPull(){
  // If the user is mid-edit, defer — try again shortly.
  if (__userIsBusyEditing()) { __rtPendingPull = true; scheduleRtPull(1500); return; }
  if (window.isSaveRunning && window.isSaveRunning()) { scheduleRtPull(1500); return; }
  __rtPendingPull = false;
  try {
    // Remember what's open so we can restore the view after re-pull.
    const openId = window.openJobId || null;
    await loadAllFromSupabase();
    if (typeof window.rerenderActivePage === 'function') window.rerenderActivePage();
    // If a job detail was open, refresh it in place (it's still in window.jobs).
    if (openId && window.openJobId === openId && typeof window.renderDetailPanel === 'function') {
      window.renderDetailPanel();
    }
    console.log('[Realtime] pulled latest changes');
  } catch(e){ console.warn('[Realtime] pull failed', e); }
}

function scheduleRtPull(delay){
  clearTimeout(__rtPullTimer);
  __rtPullTimer = setTimeout(__rtDoPull, delay != null ? delay : 800);
}

function onRealtimeChange(payload){
  // Ignore changes we just made ourselves (echo of our own push).
  // While our own save is running, these events are its echoes — ignore them
  // (re-pulling here re-rendered the job panel and closed open forms).
  if (window.isSaveRunning && window.isSaveRunning()) return;
  if (Date.now() - window.__lastLocalPushAt < 5000) {
    console.log('[Realtime] ignoring self-echo');
    return;
  }
  console.log('[Realtime] change on', payload?.table, payload?.eventType);
  scheduleRtPull();
}

function startRealtime(){
  if (!sb || !sb.channel) { console.warn('[Realtime] client has no channel()'); return; }
  if (__rtChannel) { try { sb.removeChannel(__rtChannel); } catch(e){} }
  __rtChannel = sb.channel('crm-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, onRealtimeChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses' }, onRealtimeChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'deposits' }, onRealtimeChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'stages' }, onRealtimeChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'pipelines' }, onRealtimeChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'job_files' }, onRealtimeChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'team_members' }, onRealtimeChange)
    .subscribe((status) => { console.log('[Realtime] channel status:', status); });

  // Belt-and-suspenders: also pull when the tab regains focus, in case a
  // realtime event was missed while backgrounded.
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') scheduleRtPull(300);
  });
}
window.startRealtime = startRealtime;
