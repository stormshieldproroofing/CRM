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
  document.getElementById('ssSignIn').onclick = async () => {
    const email = document.getElementById('ssEmail').value.trim();
    const password = document.getElementById('ssPass').value;
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) { msg.textContent = error.message; return; }
    location.reload();
  };
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
  // team
  const { data: team } = await sb.from('team_members').select('*').order('created_at');
  if (team) {
    window.TEAM = team.map(t => ({
      id: t.id, name: t.name, email: t.email, phone: t.phone,
      role: t.role, color: t.color, status: t.status,
      permissions: t.permissions || [], createdAt: new Date(t.created_at).getTime(),
    }));
  }

  // pipelines + stages
  const { data: pipes } = await sb.from('pipelines').select('*').order('position');
  const { data: stages } = await sb.from('stages').select('*').order('position');
  if (pipes) {
    window.pipelines = pipes.map(p => ({
      id: p.id, name: p.name,
      columns: (stages || []).filter(s => s.pipeline_id === p.id).map(s => ({
        id: s.id, name: s.name, icon: s.icon, color: s.color, locked: s.locked,
      })),
    }));
  }

  // jobs + children
  const { data: jobRows } = await sb.from('jobs').select('*').order('created_at', { ascending:false });
  const { data: deps }    = await sb.from('deposits').select('*');
  const { data: exps }    = await sb.from('expenses').select('*');
  const { data: files }   = await sb.from('job_files').select('*');
  const { data: chk }     = await sb.from('stage_checklist_done').select('*');

  if (jobRows) {
    window.jobs = jobRows.map(r => {
      const jobFiles = (files || []).filter(f => f.job_id === r.id);
      const photos = { before:[], during:[], after:[] };
      jobFiles.filter(f => f.kind === 'photo').forEach(f => {
        (photos[f.section] || photos.before).push({ name:f.name, path:f.storage_path, _id:f.id });
      });
      const byKind = k => jobFiles.filter(f => f.kind === k)
        .map(f => ({ name:f.name, path:f.storage_path, _id:f.id }));

      const stageChecklistDone = {};
      (chk || []).filter(c => c.job_id === r.id).forEach(c => {
        (stageChecklistDone[c.stage_id] ||= {})[c.item_key] = {
          completed:true, completedAt:new Date(c.completed_at).getTime(),
        };
      });

      return {
        id: r.id, _sb:true,
        name:r.name, phone:r.phone, email:r.email, address:r.address,
        priority:r.priority, user:r.assigned_to, col:r.stage_id, pipeline:r.pipeline_id,
        source:r.source, potVal:String(r.pot_val ?? '0'), paidVal:String(r.paid_val ?? '0'),
        carrier:r.carrier, claimNum:r.claim_num,
        created:new Date(r.created_at).toLocaleString('en-US',
          {month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}),
        deposits:(deps||[]).filter(d=>d.job_id===r.id)
          .map(d=>({amount:String(d.amount),desc:d.description})),
        expenses:(exps||[]).filter(e=>e.job_id===r.id)
          .map(e=>({cat:e.category,desc:e.description,amount:String(e.amount)})),
        photos, contracts:byKind('contract'), checks:byKind('check'),
        lossFiles:byKind('loss'), roofFiles:byKind('roof'), otherFiles:byKind('other'),
        stageChecklistDone,
      };
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
    // jobs (parent rows only; children handled below)
    const jobUpserts = (window.jobs || []).map(j => ({
      id: (typeof j.id === 'string' && j.id.length > 20) ? j.id : undefined, // let new ids be generated
      pipeline_id: j.pipeline || 'insurance',
      stage_id: j.col,
      assigned_to: j.user || null,
      name: j.name, phone: j.phone, email: j.email, address: j.address,
      priority: j.priority, source: j.source,
      pot_val: parseFloat(j.potVal || 0), paid_val: parseFloat(j.paidVal || 0),
      carrier: j.carrier || null, claim_num: j.claimNum || null,
    }));
    if (jobUpserts.length) {
      const { data, error } = await sb.from('jobs').upsert(jobUpserts).select();
      if (error) throw error;
      // write back any newly-assigned ids so children link correctly
      data.forEach((row, i) => { if (window.jobs[i]) window.jobs[i].id = row.id; });
    }

    // children: simplest reliable strategy — replace per job
    for (const j of (window.jobs || [])) {
      if (!j.id) continue;
      await sb.from('deposits').delete().eq('job_id', j.id);
      if (j.deposits?.length) await sb.from('deposits').insert(
        j.deposits.map(d => ({ job_id:j.id, amount:parseFloat(d.amount||0), description:d.desc })));

      await sb.from('expenses').delete().eq('job_id', j.id);
      if (j.expenses?.length) await sb.from('expenses').insert(
        j.expenses.map(e => ({ job_id:j.id, category:e.cat, description:e.desc, amount:parseFloat(e.amount||0) })));

      await sb.from('stage_checklist_done').delete().eq('job_id', j.id);
      const chkRows = [];
      Object.entries(j.stageChecklistDone || {}).forEach(([stageId, items]) => {
        Object.entries(items).forEach(([itemKey, rec]) => {
          if (rec) chkRows.push({ job_id:j.id, stage_id:stageId, item_key:itemKey });
        });
      });
      if (chkRows.length) await sb.from('stage_checklist_done').insert(chkRows);
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
    if (rows.length) await sb.from('team_members').upsert(rows);
  } catch (e) { console.error('team sync failed', e); }
}

/* ---------- FILE upload helper (use in photo/contract tabs) */
async function uploadJobFile(jobId, kind, section, file) {
  const path = `${jobId}/${kind}/${Date.now()}-${file.name}`;
  const { error } = await sb.storage.from('job-files').upload(path, file);
  if (error) { console.error(error); return null; }
  await sb.from('job_files').insert({
    job_id: jobId, kind, section: section || null, name: file.name, storage_path: path,
  });
  const { data } = await sb.storage.from('job-files').createSignedUrl(path, 3600);
  return { name:file.name, path, url:data?.signedUrl };
}
window.uploadJobFile = uploadJobFile;

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
  installOverrides();
  await loadAllFromSupabase();
  return true;
}
window.bootSupabase = bootSupabase;
