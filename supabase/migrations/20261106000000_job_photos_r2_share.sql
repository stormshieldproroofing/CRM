-- Job photos: in-app camera, Cloudflare R2 storage, and share links.
--
-- 1) job_files gets a few photo columns. Existing rows are untouched and keep
--    living in the Supabase "job-files" bucket (storage = 'supabase').
--    New photos taken while the Cloudflare photo worker is configured are stored
--    in R2 (storage = 'r2'); storage_path / thumb_path are then R2 object keys.
-- 2) photo_shares: view-only links for homeowners, adjusters and PAs.
--    Like packet_links, only a SHA-256 hash of the token is stored; the raw
--    token lives only in the link. The public photos.html page reads a share
--    through the photo-share edge function (service role), never this table.

alter table public.job_files
  add column if not exists storage    text not null default 'supabase',
  add column if not exists thumb_path text,
  add column if not exists taken_at   timestamptz,
  add column if not exists lat        double precision,
  add column if not exists lng        double precision,
  add column if not exists taken_by   text;

do $$ begin
  alter table public.job_files
    add constraint job_files_storage_chk check (storage in ('supabase','r2'));
exception when duplicate_object then null; end $$;

create index if not exists job_files_job_kind_idx on public.job_files(job_id, kind, created_at);

create table if not exists public.photo_shares (
  id              uuid primary key default gen_random_uuid(),
  token_hash      text not null unique,
  job_id          uuid not null references public.jobs(id) on delete cascade,
  sections        text[] not null default array['before','during','after'],
  label           text check (label is null or length(label) <= 80),
  created_by      text,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz,                 -- null = never expires
  revoked_at      timestamptz,
  view_count      integer not null default 0,
  last_viewed_at  timestamptz,
  constraint photo_shares_sections_chk
    check (sections <@ array['before','during','after'] and cardinality(sections) > 0)
);

create index if not exists photo_shares_job_idx on public.photo_shares(job_id, created_at desc);

alter table public.photo_shares enable row level security;

drop policy if exists photo_shares_select on public.photo_shares;
create policy photo_shares_select on public.photo_shares
  for select to authenticated using (public.can_access_job(job_id));

drop policy if exists photo_shares_insert on public.photo_shares;
create policy photo_shares_insert on public.photo_shares
  for insert to authenticated
  with check (public.can_access_job(job_id) and revoked_at is null and view_count = 0);

-- Staff can only turn a link off (set revoked_at); nothing else changes from the CRM.
drop policy if exists photo_shares_update on public.photo_shares;
create policy photo_shares_update on public.photo_shares
  for update to authenticated
  using (public.can_access_job(job_id) and revoked_at is null)
  with check (public.can_access_job(job_id) and revoked_at is not null);

revoke all on public.photo_shares from anon;

-- Keep a revoke from editing anything but revoked_at.
create or replace function public.photo_shares_guard() returns trigger
language plpgsql as $$
begin
  if auth.role() = 'service_role' then return new; end if;
  if new.token_hash <> old.token_hash or new.job_id <> old.job_id
     or new.sections <> old.sections or new.created_at <> old.created_at
     or new.expires_at is distinct from old.expires_at
     or new.view_count <> old.view_count then
    raise exception 'only revoked_at can be changed';
  end if;
  return new;
end $$;

drop trigger if exists photo_shares_guard on public.photo_shares;
create trigger photo_shares_guard before update on public.photo_shares
  for each row execute function public.photo_shares_guard();
