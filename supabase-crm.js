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
  }

  // jobs + children
  const { data: jobRows, error: jobErr } = await sb.from('jobs').select('*').order('created_at', { ascending:false });
  const { data: deps }    = await sb.from('deposits').select('*');
  const { data: exps }    = await sb.from('expenses').select('*');
  const { data: files }   = await sb.from('job_files').select('*');
  const { data: chk }     = await sb.from('stage_checklist_done').select('*');

  if (jobErr) { console.error('[Supabase] jobs load failed:', jobErr); }
  else {
    // Batch-generate signed URLs for all file paths so previews work after reload.
    const allPaths = (files || []).map(f => f.storage_path).filter(Boolean);
    const urlMap = {};
    if(allPaths.length){
      try {
        const { data: signed } = await sb.storage.from('job-files').createSignedUrls(allPaths, 60*60*24*7); // 7 days
        (signed || []).forEach(s => { if(s && s.path && s.signedUrl) urlMap[s.path] = s.signedUrl; });
      } catch(e){ console.warn('signed url batch failed', e); }
    }
    const isPdfName = n => /\.pdf$/i.test(n||'');
    const fileRec = f => ({
      name: f.name, path: f.storage_path, _id: f.id,
      url: urlMap[f.storage_path] || null,
      isPdf: isPdfName(f.name),
    });
    const newJobs = (jobRows || []).map(r => {
      const jobFiles = (files || []).filter(f => f.job_id === r.id);
      const photos = { before:[], during:[], after:[] };
      jobFiles.filter(f => f.kind === 'photo').forEach(f => {
        (photos[f.section] || photos.before).push(fileRec(f));
      });
      const byKind = k => jobFiles.filter(f => f.kind === k).map(fileRec);

      const stageChecklistDone = {};
      (chk || []).filter(c => c.job_id === r.id).forEach(c => {
        (stageChecklistDone[c.stage_id] ||= {})[c.item_key] = {
          completed:true,
          completedAt: c.completed_at ? new Date(c.completed_at).getTime() : Date.now(),
          agentId:   c.agent_id   || '',
          agentName: c.agent_name || 'Unassigned',
          agentRole: c.agent_role || '',
        };
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
        stageChecklistExtra: (r.stage_checklist_extra && typeof r.stage_checklist_extra === 'object') ? r.stage_checklist_extra : {},
        quote: (r.quote && typeof r.quote === 'object') ? r.quote : null,
        abcOrder: (r.abc_order && typeof r.abc_order === 'object') ? r.abc_order : null,
        subVoucher: (r.sub_voucher && typeof r.sub_voucher === 'object') ? r.sub_voucher : null,
        commissionPayouts: Array.isArray(r.commission_payouts) ? r.commission_payouts : [],
        projectManager: r.project_manager || null,
        pmFee: (r.pm_fee != null) ? r.pm_fee : 250,
        pmFeePaid: !!r.pm_fee_paid,
        pmFeePaidDate: r.pm_fee_paid_date || null,
        pmFeePaidMethod: r.pm_fee_paid_method || null,
        pmFeePaidNotes: r.pm_fee_paid_notes || null,
        created:new Date(r.created_at).toLocaleString('en-US',
          {month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}),
        deposits:(deps||[]).filter(d=>d.job_id===r.id)
          .map(d=>({amount:String(d.amount),desc:d.description})),
        expenses:(exps||[]).filter(e=>e.job_id===r.id)
          .map(e=>({cat:e.category,desc:e.description,amount:String(e.amount),vendor:e.vendor||null,vendorName:e.vendor_name||null,paid:!!e.paid,paidDate:e.paid_date||null,paidMethod:e.paid_method||null,paidNotes:e.paid_notes||null,breakdown:(e.breakdown&&typeof e.breakdown==='object')?e.breakdown:null,_src:e.src||null,_vid:e.vid||null})),
        photos, contracts:byKind('contract'), checks:byKind('check'),
        lossFiles:byKind('loss'), roofFiles:byKind('roof'), otherFiles:byKind('other'),
        stageChecklistDone,
      };
    });
    if (Array.isArray(window.jobs)) {
      window.jobs.length = 0;
      newJobs.forEach(j => window.jobs.push(j));
    } else {
      window.jobs = newJobs;
    }
    // One-time cleanup: collapse duplicate voucher-linked expenses (same vid).
    // These accumulated before _vid was persisted; keep the last of each vid.
    (window.jobs||[]).forEach(j => {
      if(!Array.isArray(j.expenses)) return;
      const seen = new Map();
      j.expenses.forEach(e => { if(e && e._vid) seen.set(e._vid, e); });
      if(seen.size){
        j.expenses = j.expenses.filter(e => !e || !e._vid || seen.get(e._vid) === e);
      }
    });
  }
}

/* ---------- SAVE: in-memory arrays -> Supabase ----------- */
/* Debounced full upsert. Simple and robust for a small team. */

let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(pushAllToSupabase, 600);
}

async function pushAllToSupabase() {
  try {
    // Build base rows without id, then categorize
    const newJobs = [];        // no real UUID yet — needs insert without id
    const newJobIndices = [];  // their index in window.jobs for writeback
    const existingJobs = [];   // has UUID — safe to upsert with id

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
        quote: (j.quote && typeof j.quote === 'object') ? j.quote : null,
        abc_order: (j.abcOrder && typeof j.abcOrder === 'object') ? j.abcOrder : null,
        sub_voucher: (j.subVoucher && typeof j.subVoucher === 'object') ? j.subVoucher : null,
        commission_payouts: Array.isArray(j.commissionPayouts) ? j.commissionPayouts : [],
        project_manager: j.projectManager || null,
        pm_fee: (j.pmFee != null) ? j.pmFee : 250,
        pm_fee_paid: !!j.pmFeePaid,
        pm_fee_paid_date: j.pmFeePaidDate || null,
        pm_fee_paid_method: j.pmFeePaidMethod || null,
        pm_fee_paid_notes: j.pmFeePaidNotes || null,
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
      if (error) throw error;
    }

    // delete any jobs that exist in Supabase but no longer in our local array
    {
      const { data: remoteIds, error: idErr } = await sb.from('jobs').select('id');
      if (!idErr) {
        const localIds = new Set((window.jobs || []).map(j => j.id).filter(Boolean));
        const toDelete = (remoteIds || []).map(r => r.id).filter(id => !localIds.has(id));
        if (toDelete.length) {
          const { error: delErr } = await sb.from('jobs').delete().in('id', toDelete);
          if (delErr) console.error('[Supabase] delete jobs failed:', delErr);
        }
      }
    }

    // children: simplest reliable strategy — replace per job
    for (const j of (window.jobs || [])) {
      if (!j.id) continue;
      await sb.from('deposits').delete().eq('job_id', j.id);
      if (j.deposits?.length) await sb.from('deposits').insert(
        j.deposits.map(d => ({ job_id:j.id, amount:parseFloat(d.amount||0), description:d.desc })));

      await sb.from('expenses').delete().eq('job_id', j.id);
      if (j.expenses?.length) await sb.from('expenses').insert(
        j.expenses.map(e => ({
          job_id: j.id,
          category: e.cat,
          description: e.desc,
          amount: parseFloat(e.amount||0),
          vendor: e.vendor || null,
          vendor_name: e.vendorName || null,
          paid: !!e.paid,
          paid_date: e.paidDate || null,
          paid_method: e.paidMethod || null,
          paid_notes: e.paidNotes || null,
          breakdown: (e.breakdown && typeof e.breakdown === 'object') ? e.breakdown : null,
          src: e._src || null,
          vid: e._vid || null,
        })));

      await sb.from('stage_checklist_done').delete().eq('job_id', j.id);
      const chkRows = [];
      Object.entries(j.stageChecklistDone || {}).forEach(([stageId, items]) => {
        Object.entries(items).forEach(([itemKey, rec]) => {
          if (rec) chkRows.push({
            job_id: j.id,
            stage_id: stageId,
            item_key: itemKey,
            agent_id:   rec.agentId   || null,
            agent_name: rec.agentName || null,
            agent_role: rec.agentRole || null,
            completed_at: rec.completedAt ? new Date(rec.completedAt).toISOString() : null,
          });
        });
      });
      if (chkRows.length) await sb.from('stage_checklist_done').insert(chkRows);
    }

    // ── Pipelines & stages: upsert current, delete what's gone ──
    // Only admins and managers can write to these tables (per RLS).
    // Skip the sync for salesmen to avoid 403 errors filling the console.
    const myRole = window.currentMember?.role;
    const canManageBoards = (myRole === 'admin' || myRole === 'manager');
    const localPipelines = window.pipelines || [];
    if (canManageBoards && localPipelines.length) {
      const pipeRows = localPipelines.map((p, i) => ({
        id: p.id, name: p.name, position: i,
      }));
      const { error: pipeErr } = await sb.from('pipelines').upsert(pipeRows);
      if (pipeErr) console.error('[Supabase] pipelines upsert failed:', pipeErr);

      // Stages: flatten all from all pipelines
      const stageRows = [];
      localPipelines.forEach(p => {
        (p.columns || []).forEach((c, i) => {
          stageRows.push({
            id: c.id, pipeline_id: p.id, name: c.name,
            icon: c.icon || null, color: c.color || null,
            locked: !!c.locked, position: i,
            checklist: Array.isArray(c.checklist) ? c.checklist : [],
          });
        });
      });
      if (stageRows.length) {
        const { error: stageErr } = await sb.from('stages').upsert(stageRows);
        if (stageErr) console.error('[Supabase] stages upsert failed:', stageErr);
      }

      // Delete pipelines not in local list
      const { data: remotePipes } = await sb.from('pipelines').select('id');
      const localPipeIds = new Set(localPipelines.map(p => p.id));
      const pipesToDelete = (remotePipes || []).map(r => r.id).filter(id => !localPipeIds.has(id));
      if (pipesToDelete.length) {
        const { error: pdErr } = await sb.from('pipelines').delete().in('id', pipesToDelete);
        if (pdErr) console.error('[Supabase] pipelines delete failed:', pdErr);
      }

      // Delete stages not in local list (across all pipelines)
      const { data: remoteStages } = await sb.from('stages').select('id');
      const localStageIds = new Set(stageRows.map(s => s.id));
      const stagesToDelete = (remoteStages || []).map(r => r.id).filter(id => !localStageIds.has(id));
      if (stagesToDelete.length) {
        const { error: sdErr } = await sb.from('stages').delete().in('id', stagesToDelete);
        if (sdErr) console.error('[Supabase] stages delete failed:', sdErr);
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
    const rows = (window.TEAM || []).map(t => ({
      id: t.id, name: t.name, email: t.email, phone: t.phone,
      role: t.role, color: t.color, status: t.status, permissions: t.permissions || [],
    }));
    if (rows.length) {
      const { error } = await sb.from('team_members').upsert(rows);
      if (error) console.error('[Supabase] team upsert failed:', error);
    }
    // Delete team rows not in local TEAM
    const { data: remote } = await sb.from('team_members').select('id');
    const localIds = new Set(rows.map(r => r.id));
    const toDelete = (remote || []).map(r => r.id).filter(id => !localIds.has(id));
    if (toDelete.length) {
      const { error: delErr } = await sb.from('team_members').delete().in('id', toDelete);
      if (delErr) console.error('[Supabase] team delete failed:', delErr);
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
  return true;
}
window.bootSupabase = bootSupabase;
