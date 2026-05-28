-- StormShield CRM Supabase backend
-- Run this in Supabase Dashboard > SQL Editor.
-- This schema matches the current single-file frontend IDs:
-- pipelines use IDs like "insurance", stages use IDs like "lead",
-- and team members use IDs like "mt".

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  email text,
  role text not null default 'salesman' check (role in ('admin','manager','salesman')),
  status text not null default 'active' check (status in ('active','suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.team_members (
  id text primary key,
  auth_user_id uuid unique references auth.users(id) on delete set null,
  name text not null,
  email text not null,
  phone text,
  role text not null default 'salesman' check (role in ('admin','manager','salesman')),
  color text not null default '#4D9DE0',
  status text not null default 'active' check (status in ('active','suspended')),
  permissions text[] not null default array['view_jobs','edit_jobs'],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pipelines (
  id text primary key,
  name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pipeline_stages (
  id text not null,
  pipeline_id text not null references public.pipelines(id) on delete cascade,
  name text not null,
  icon text not null default 'ti-layout-kanban',
  color text not null default '#4D9DE0',
  locked boolean not null default false,
  sort_order integer not null default 0,
  checklist jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (pipeline_id, id)
);

create table if not exists public.jobs (
  id text primary key,
  pipeline_id text not null references public.pipelines(id) on delete restrict,
  stage_id text,
  assigned_member_id text references public.team_members(id) on delete set null,
  customer_name text not null,
  phone text,
  email text,
  address text,
  priority text not null default 'low' check (priority in ('low','med','high')),
  source text,
  contract_value numeric(12,2) not null default 0,
  paid_value numeric(12,2) not null default 0,
  carrier text,
  claim_number text,
  policy_number text,
  claim_type text,
  claim_status text,
  date_of_loss date,
  rcv numeric(12,2),
  acv numeric(12,2),
  deductible numeric(12,2),
  adjuster_name text,
  adjuster_phone text,
  inspection_date date,
  claim_notes text,
  docs_count integer not null default 0,
  notes_count integer not null default 0,
  tasks_count integer not null default 0,
  tasks_done_count integer not null default 0,
  stage_checklist_done jsonb not null default '{}'::jsonb,
  extra jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.job_payments (
  id uuid primary key default gen_random_uuid(),
  job_id text not null references public.jobs(id) on delete cascade,
  amount numeric(12,2) not null default 0,
  description text,
  paid_at timestamptz not null default now(),
  extra jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.job_expenses (
  id uuid primary key default gen_random_uuid(),
  job_id text not null references public.jobs(id) on delete cascade,
  category text not null default 'Other',
  description text,
  amount numeric(12,2) not null default 0,
  extra jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.job_files (
  id uuid primary key default gen_random_uuid(),
  job_id text not null references public.jobs(id) on delete cascade,
  category text not null check (category in (
    'photos_before',
    'photos_during',
    'photos_after',
    'contract',
    'checks',
    'loss_statement',
    'roof_measurement',
    'other'
  )),
  bucket text not null,
  storage_path text not null,
  file_name text not null,
  mime_type text,
  size_bytes bigint,
  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (bucket, storage_path)
);

create table if not exists public.job_notes (
  id uuid primary key default gen_random_uuid(),
  job_id text not null references public.jobs(id) on delete cascade,
  body text not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', new.email, ''),
    new.email
  )
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at before update on public.profiles
for each row execute function public.touch_updated_at();

drop trigger if exists team_members_touch_updated_at on public.team_members;
create trigger team_members_touch_updated_at before update on public.team_members
for each row execute function public.touch_updated_at();

drop trigger if exists pipelines_touch_updated_at on public.pipelines;
create trigger pipelines_touch_updated_at before update on public.pipelines
for each row execute function public.touch_updated_at();

drop trigger if exists pipeline_stages_touch_updated_at on public.pipeline_stages;
create trigger pipeline_stages_touch_updated_at before update on public.pipeline_stages
for each row execute function public.touch_updated_at();

drop trigger if exists jobs_touch_updated_at on public.jobs;
create trigger jobs_touch_updated_at before update on public.jobs
for each row execute function public.touch_updated_at();

alter table public.profiles enable row level security;
alter table public.team_members enable row level security;
alter table public.pipelines enable row level security;
alter table public.pipeline_stages enable row level security;
alter table public.jobs enable row level security;
alter table public.job_payments enable row level security;
alter table public.job_expenses enable row level security;
alter table public.job_files enable row level security;
alter table public.job_notes enable row level security;

-- Starter policy: any signed-in CRM user can manage CRM data.
-- This is practical for the first release. Later, tighten these policies by role.
drop policy if exists "Authenticated users can manage profiles" on public.profiles;
create policy "Authenticated users can manage profiles"
on public.profiles for all to authenticated using (true) with check (true);

drop policy if exists "Authenticated users can manage team members" on public.team_members;
create policy "Authenticated users can manage team members"
on public.team_members for all to authenticated using (true) with check (true);

drop policy if exists "Authenticated users can manage pipelines" on public.pipelines;
create policy "Authenticated users can manage pipelines"
on public.pipelines for all to authenticated using (true) with check (true);

drop policy if exists "Authenticated users can manage pipeline stages" on public.pipeline_stages;
create policy "Authenticated users can manage pipeline stages"
on public.pipeline_stages for all to authenticated using (true) with check (true);

drop policy if exists "Authenticated users can manage jobs" on public.jobs;
create policy "Authenticated users can manage jobs"
on public.jobs for all to authenticated using (true) with check (true);

drop policy if exists "Authenticated users can manage job payments" on public.job_payments;
create policy "Authenticated users can manage job payments"
on public.job_payments for all to authenticated using (true) with check (true);

drop policy if exists "Authenticated users can manage job expenses" on public.job_expenses;
create policy "Authenticated users can manage job expenses"
on public.job_expenses for all to authenticated using (true) with check (true);

drop policy if exists "Authenticated users can manage job files" on public.job_files;
create policy "Authenticated users can manage job files"
on public.job_files for all to authenticated using (true) with check (true);

drop policy if exists "Authenticated users can manage job notes" on public.job_notes;
create policy "Authenticated users can manage job notes"
on public.job_notes for all to authenticated using (true) with check (true);

insert into storage.buckets (id, name, public)
values
  ('crm-photos', 'crm-photos', false),
  ('crm-contracts', 'crm-contracts', false),
  ('crm-checks', 'crm-checks', false),
  ('crm-loss-statements', 'crm-loss-statements', false),
  ('crm-roof-measurements', 'crm-roof-measurements', false),
  ('crm-other-files', 'crm-other-files', false)
on conflict (id) do nothing;

drop policy if exists "Authenticated users can read CRM files" on storage.objects;
create policy "Authenticated users can read CRM files"
on storage.objects for select to authenticated
using (bucket_id in ('crm-photos','crm-contracts','crm-checks','crm-loss-statements','crm-roof-measurements','crm-other-files'));

drop policy if exists "Authenticated users can upload CRM files" on storage.objects;
create policy "Authenticated users can upload CRM files"
on storage.objects for insert to authenticated
with check (bucket_id in ('crm-photos','crm-contracts','crm-checks','crm-loss-statements','crm-roof-measurements','crm-other-files'));

drop policy if exists "Authenticated users can update CRM files" on storage.objects;
create policy "Authenticated users can update CRM files"
on storage.objects for update to authenticated
using (bucket_id in ('crm-photos','crm-contracts','crm-checks','crm-loss-statements','crm-roof-measurements','crm-other-files'))
with check (bucket_id in ('crm-photos','crm-contracts','crm-checks','crm-loss-statements','crm-roof-measurements','crm-other-files'));

drop policy if exists "Authenticated users can delete CRM files" on storage.objects;
create policy "Authenticated users can delete CRM files"
on storage.objects for delete to authenticated
using (bucket_id in ('crm-photos','crm-contracts','crm-checks','crm-loss-statements','crm-roof-measurements','crm-other-files'));
