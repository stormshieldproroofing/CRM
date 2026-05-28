// StormShield CRM Supabase browser client helpers.
//
// Add these scripts before the main CRM <script> in index.html:
// <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
// <script src="./supabase/frontend-integration.js"></script>

const STORMSHIELD_SUPABASE_URL = 'https://lqhdhflsgswctdwmojhd.supabase.co';
const STORMSHIELD_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxxaGRoZmxzZ3N3Y3Rkd21vamhkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5Mzc2NjcsImV4cCI6MjA5NTUxMzY2N30.1FXt_Q88QSg93MAA3GjdoYzfP1eX3ON6-14nz3m8flI';

const crmSupabase =
  window.supabase && STORMSHIELD_SUPABASE_URL.startsWith('https://')
    ? window.supabase.createClient(STORMSHIELD_SUPABASE_URL, STORMSHIELD_SUPABASE_ANON_KEY)
    : null;

function crmBackendReady(){
  return !!crmSupabase;
}

async function crmSignIn(email, password){
  if(!crmBackendReady()) throw new Error('Supabase is not configured.');
  const { data, error } = await crmSupabase.auth.signInWithPassword({ email, password });
  if(error) throw error;
  return data;
}

async function crmSignOut(){
  if(!crmBackendReady()) return;
  const { error } = await crmSupabase.auth.signOut();
  if(error) throw error;
}

async function crmCurrentSession(){
  if(!crmBackendReady()) return null;
  const { data, error } = await crmSupabase.auth.getSession();
  if(error) throw error;
  return data.session;
}

function crmDateFromDisplay(value){
  if(!value) return null;
  if(/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = new Date(String(value).replace(' at ', ' '));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function crmDisplayDate(value){
  if(!value) return '';
  const parsed = new Date(value);
  if(Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function crmNumber(value){
  const n = parseFloat(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function crmLocalStage(row){
  return {
    id: row.id,
    name: row.name,
    icon: row.icon || 'ti-layout-kanban',
    locked: !!row.locked,
    color: row.color || '#4D9DE0',
    checklist: Array.isArray(row.checklist) ? row.checklist : []
  };
}

function crmLocalPipeline(row, stages){
  return {
    id: row.id,
    name: row.name,
    columns: stages
      .filter(stage => stage.pipeline_id === row.id)
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
      .map(crmLocalStage)
  };
}

function crmLocalTeamMember(row){
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone || '',
    role: row.role || 'salesman',
    color: row.color || '#4D9DE0',
    status: row.status || 'active',
    permissions: row.permissions || ['view_jobs', 'edit_jobs'],
    createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now()
  };
}

function crmLocalJob(row){
  const extra = row.extra || {};
  return {
    id: row.id,
    name: row.customer_name,
    phone: row.phone || '',
    email: row.email || '',
    address: row.address || '',
    priority: row.priority || 'low',
    user: row.assigned_member_id,
    col: row.stage_id,
    pipeline: row.pipeline_id || 'insurance',
    docs: row.docs_count || 0,
    notes: row.notes_count || 0,
    tasks: row.tasks_count || 0,
    tasksDone: row.tasks_done_count || 0,
    source: row.source || 'Manual Entry',
    potVal: String(row.contract_value || '0.00'),
    paidVal: String(row.paid_value || '0.00'),
    created: crmDisplayDate(row.created_at),
    createdAt: row.created_at,
    carrier: row.carrier || '',
    claimNum: row.claim_number || '',
    policyNum: row.policy_number || '',
    claimType: row.claim_type || '',
    claimStatus: row.claim_status || '',
    dateOfLoss: row.date_of_loss || '',
    rcv: row.rcv || '',
    acv: row.acv || '',
    deductible: row.deductible || '',
    adjName: row.adjuster_name || '',
    adjPhone: row.adjuster_phone || '',
    inspDate: row.inspection_date || '',
    claimNotes: row.claim_notes || '',
    stageChecklistDone: row.stage_checklist_done || {},
    deposits: (row.payments || []).map(payment => ({
      id: payment.id,
      amount: String(payment.amount || '0.00'),
      desc: payment.description || '',
      date: crmDisplayDate(payment.paid_at),
      time: payment.paid_at ? new Date(payment.paid_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : ''
    })),
    expenses: (row.expenses || []).map(expense => ({
      id: expense.id,
      cat: expense.category || 'Other',
      desc: expense.description || '',
      amount: String(expense.amount || '0.00')
    })),
    photosBefore: extra.photosBefore || [],
    photosDuring: extra.photosDuring || [],
    photosAfter: extra.photosAfter || [],
    contractFiles: extra.contractFiles || [],
    checkFiles: extra.checkFiles || [],
    lossFiles: extra.lossFiles || [],
    roofFiles: extra.roofFiles || [],
    otherFiles: extra.otherFiles || [],
    commissions: extra.commissions || [],
    commPctPrimary: extra.commPctPrimary,
    cpBreakdown: extra.cpBreakdown
  };
}

function crmJobRowFromLocal(job){
  return {
    id: job.id || `j${Date.now()}`,
    pipeline_id: job.pipeline || 'insurance',
    stage_id: job.col || 'lead',
    assigned_member_id: job.user || null,
    customer_name: job.name || 'Unnamed Customer',
    phone: job.phone || null,
    email: job.email || null,
    address: job.address || null,
    priority: job.priority || 'low',
    source: job.source || null,
    contract_value: crmNumber(job.potVal),
    paid_value: crmNumber(job.paidVal),
    carrier: job.carrier || null,
    claim_number: job.claimNum || null,
    policy_number: job.policyNum || null,
    claim_type: job.claimType || null,
    claim_status: job.claimStatus || null,
    date_of_loss: job.dateOfLoss || null,
    rcv: job.rcv === '' ? null : crmNumber(job.rcv),
    acv: job.acv === '' ? null : crmNumber(job.acv),
    deductible: job.deductible === '' ? null : crmNumber(job.deductible),
    adjuster_name: job.adjName || null,
    adjuster_phone: job.adjPhone || null,
    inspection_date: job.inspDate || null,
    claim_notes: job.claimNotes || null,
    docs_count: job.docs || 0,
    notes_count: job.notes || 0,
    tasks_count: job.tasks || 0,
    tasks_done_count: job.tasksDone || 0,
    stage_checklist_done: job.stageChecklistDone || {},
    created_at: crmDateFromDisplay(job.createdAt || job.created) || new Date().toISOString(),
    extra: {
      photosBefore: job.photosBefore || [],
      photosDuring: job.photosDuring || [],
      photosAfter: job.photosAfter || [],
      contractFiles: job.contractFiles || [],
      checkFiles: job.checkFiles || [],
      lossFiles: job.lossFiles || [],
      roofFiles: job.roofFiles || [],
      otherFiles: job.otherFiles || [],
      commissions: job.commissions || [],
      commPctPrimary: job.commPctPrimary,
      cpBreakdown: job.cpBreakdown
    }
  };
}

function crmTeamRowFromLocal(member){
  return {
    id: member.id,
    name: member.name,
    email: member.email,
    phone: member.phone || null,
    role: member.role || 'salesman',
    color: member.color || '#4D9DE0',
    status: member.status || 'active',
    permissions: member.permissions || ['view_jobs', 'edit_jobs'],
    created_at: member.createdAt ? new Date(member.createdAt).toISOString() : new Date().toISOString()
  };
}

function crmPipelineRowsFromLocal(pipelines){
  const pipelineRows = [];
  const stageRows = [];
  pipelines.forEach((pipeline, pipelineIndex) => {
    pipelineRows.push({
      id: pipeline.id,
      name: pipeline.name,
      sort_order: pipelineIndex + 1
    });
    (pipeline.columns || []).forEach((stage, stageIndex) => {
      stageRows.push({
        id: stage.id,
        pipeline_id: pipeline.id,
        name: stage.name,
        icon: stage.icon || 'ti-layout-kanban',
        color: stage.color || '#4D9DE0',
        locked: !!stage.locked,
        sort_order: stageIndex + 1,
        checklist: stage.checklist || []
      });
    });
  });
  return { pipelineRows, stageRows };
}

async function crmLoadState(){
  if(!crmBackendReady()) throw new Error('Supabase is not configured.');

  const [teamRes, pipelineRes, stageRes, jobsRes] = await Promise.all([
    crmSupabase.from('team_members').select('*').order('created_at', { ascending: true }),
    crmSupabase.from('pipelines').select('*').order('sort_order', { ascending: true }),
    crmSupabase.from('pipeline_stages').select('*').order('sort_order', { ascending: true }),
    crmSupabase
      .from('jobs')
      .select('*, payments:job_payments(*), expenses:job_expenses(*)')
      .order('created_at', { ascending: false })
  ]);

  const firstError = teamRes.error || pipelineRes.error || stageRes.error || jobsRes.error;
  if(firstError) throw firstError;

  const stages = stageRes.data || [];
  const pipelines = (pipelineRes.data || []).map(row => crmLocalPipeline(row, stages));

  return {
    TEAM: (teamRes.data || []).map(crmLocalTeamMember),
    USERS: (teamRes.data || []).map(row => ({ id: row.id, name: row.name, color: row.color })),
    pipelines,
    currentPipelineId: pipelines[0]?.id || 'insurance',
    jobs: (jobsRes.data || []).map(crmLocalJob)
  };
}

async function crmSaveTeam(team){
  if(!crmBackendReady()) throw new Error('Supabase is not configured.');
  const rows = (team || []).map(crmTeamRowFromLocal);
  const { error } = await crmSupabase.from('team_members').upsert(rows);
  if(error) throw error;
}

async function crmSavePipelines(pipelines){
  if(!crmBackendReady()) throw new Error('Supabase is not configured.');
  const { pipelineRows, stageRows } = crmPipelineRowsFromLocal(pipelines || []);
  const pipelineResult = await crmSupabase.from('pipelines').upsert(pipelineRows);
  if(pipelineResult.error) throw pipelineResult.error;
  const stageResult = await crmSupabase.from('pipeline_stages').upsert(stageRows, { onConflict: 'pipeline_id,id' });
  if(stageResult.error) throw stageResult.error;
}

async function crmSaveJob(job){
  if(!crmBackendReady()) throw new Error('Supabase is not configured.');
  const row = crmJobRowFromLocal(job);
  const { data, error } = await crmSupabase.from('jobs').upsert(row).select().single();
  if(error) throw error;
  return data;
}

async function crmSaveJobFinancials(job){
  if(!crmBackendReady()) throw new Error('Supabase is not configured.');
  await crmSaveJob(job);

  const deletePayments = await crmSupabase.from('job_payments').delete().eq('job_id', job.id);
  if(deletePayments.error) throw deletePayments.error;
  const paymentRows = (job.deposits || []).map(deposit => ({
    job_id: job.id,
    amount: crmNumber(deposit.amount),
    description: deposit.desc || '',
    paid_at: crmDateFromDisplay(`${deposit.date || ''} ${deposit.time || ''}`) || new Date().toISOString(),
    extra: deposit
  }));
  if(paymentRows.length){
    const insertPayments = await crmSupabase.from('job_payments').insert(paymentRows);
    if(insertPayments.error) throw insertPayments.error;
  }

  const deleteExpenses = await crmSupabase.from('job_expenses').delete().eq('job_id', job.id);
  if(deleteExpenses.error) throw deleteExpenses.error;
  const expenseRows = (job.expenses || []).map(expense => ({
    job_id: job.id,
    category: expense.cat || 'Other',
    description: expense.desc || '',
    amount: crmNumber(expense.amount),
    extra: expense
  }));
  if(expenseRows.length){
    const insertExpenses = await crmSupabase.from('job_expenses').insert(expenseRows);
    if(insertExpenses.error) throw insertExpenses.error;
  }
}

async function crmDeleteJob(jobId){
  if(!crmBackendReady()) throw new Error('Supabase is not configured.');
  const { error } = await crmSupabase.from('jobs').delete().eq('id', jobId);
  if(error) throw error;
}

async function crmDeleteTeamMember(memberId){
  if(!crmBackendReady()) throw new Error('Supabase is not configured.');
  const { error } = await crmSupabase.from('team_members').delete().eq('id', memberId);
  if(error) throw error;
}

async function crmDeletePipeline(pipelineId){
  if(!crmBackendReady()) throw new Error('Supabase is not configured.');
  const { error } = await crmSupabase.from('pipelines').delete().eq('id', pipelineId);
  if(error) throw error;
}

async function crmDeletePipelineStage(pipelineId, stageId){
  if(!crmBackendReady()) throw new Error('Supabase is not configured.');
  const { error } = await crmSupabase
    .from('pipeline_stages')
    .delete()
    .eq('pipeline_id', pipelineId)
    .eq('id', stageId);
  if(error) throw error;
}

function crmBucketForFileCategory(category){
  const buckets = {
    photos_before: 'crm-photos',
    photos_during: 'crm-photos',
    photos_after: 'crm-photos',
    contract: 'crm-contracts',
    checks: 'crm-checks',
    loss_statement: 'crm-loss-statements',
    roof_measurement: 'crm-roof-measurements',
    other: 'crm-other-files'
  };
  return buckets[category] || 'crm-other-files';
}

async function crmUploadJobFile(jobId, category, file){
  if(!crmBackendReady()) throw new Error('Supabase is not configured.');
  const bucket = crmBucketForFileCategory(category);
  const safeName = file.name.replace(/[^a-z0-9._-]+/gi, '-').toLowerCase();
  const path = `${jobId}/${category}/${Date.now()}-${safeName}`;

  const upload = await crmSupabase.storage.from(bucket).upload(path, file, {
    cacheControl: '3600',
    upsert: false
  });
  if(upload.error) throw upload.error;

  const { data, error } = await crmSupabase
    .from('job_files')
    .insert({
      job_id: jobId,
      category,
      bucket,
      storage_path: path,
      file_name: file.name,
      mime_type: file.type || 'application/octet-stream',
      size_bytes: file.size
    })
    .select()
    .single();
  if(error) throw error;
  return data;
}

async function crmCreateSignedFileUrl(fileRecord){
  if(!crmBackendReady()) throw new Error('Supabase is not configured.');
  const { data, error } = await crmSupabase
    .storage
    .from(fileRecord.bucket)
    .createSignedUrl(fileRecord.storage_path, 60 * 10);
  if(error) throw error;
  return data.signedUrl;
}

Object.assign(window, {
  crmBackendReady,
  crmSignIn,
  crmSignOut,
  crmCurrentSession,
  crmLoadState,
  crmSaveTeam,
  crmSavePipelines,
  crmSaveJob,
  crmSaveJobFinancials,
  crmDeleteJob,
  crmDeleteTeamMember,
  crmDeletePipeline,
  crmDeletePipelineStage,
  crmUploadJobFile,
  crmCreateSignedFileUrl
});
