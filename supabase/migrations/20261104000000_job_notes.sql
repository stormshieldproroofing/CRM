-- Job notes: quick, timestamped notes on a job (shown in the floating notes panel,
-- docked beside the job screen on desktop, and in a bottom sheet on phones).
-- Plus a private per-user scratchpad that follows the user across jobs.
create table if not exists public.job_notes (
  id           uuid primary key default gen_random_uuid(),
  job_id       uuid not null references public.jobs(id) on delete cascade,
  author_id    uuid not null default auth.uid(),
  author_name  text,
  body         text not null check (length(body) between 1 and 5000),
  tag          text check (tag is null or length(tag) <= 40),
  pinned       boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists job_notes_job_idx on public.job_notes(job_id, created_at);

alter table public.job_notes enable row level security;

drop policy if exists job_notes_select on public.job_notes;
create policy job_notes_select on public.job_notes
  for select to authenticated using (public.can_access_job(job_id));

drop policy if exists job_notes_insert on public.job_notes;
create policy job_notes_insert on public.job_notes
  for insert to authenticated
  with check (public.can_access_job(job_id) and author_id = auth.uid());

-- Anyone on the job can pin/unpin; only the author can edit the text (enforced by trigger).
drop policy if exists job_notes_update on public.job_notes;
create policy job_notes_update on public.job_notes
  for update to authenticated
  using (public.can_access_job(job_id))
  with check (public.can_access_job(job_id));

drop policy if exists job_notes_delete on public.job_notes;
create policy job_notes_delete on public.job_notes
  for delete to authenticated using (author_id = auth.uid());

create or replace function public.job_notes_guard() returns trigger
language plpgsql as $$
begin
  if new.body is distinct from old.body and old.author_id <> auth.uid() then
    raise exception 'Only the author can edit a note';
  end if;
  new.job_id := old.job_id;
  new.author_id := old.author_id;
  new.author_name := old.author_name;
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists job_notes_guard on public.job_notes;
create trigger job_notes_guard before update on public.job_notes
  for each row execute function public.job_notes_guard();

revoke all on public.job_notes from anon;

-- Private scratchpad, one row per signed-in user.
create table if not exists public.user_scratchpads (
  auth_id     uuid primary key default auth.uid(),
  body        text not null default '' check (length(body) <= 20000),
  updated_at  timestamptz not null default now()
);

alter table public.user_scratchpads enable row level security;

drop policy if exists user_scratchpads_own on public.user_scratchpads;
create policy user_scratchpads_own on public.user_scratchpads
  for all to authenticated
  using (auth_id = auth.uid())
  with check (auth_id = auth.uid());

revoke all on public.user_scratchpads from anon;

-- Live updates so a note posted on one device shows up on the others.
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.job_notes;
    exception when duplicate_object then null;
    end;
  end if;
end $$;
