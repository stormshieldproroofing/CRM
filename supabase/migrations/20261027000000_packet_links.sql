-- Remote signing links for the Claim Packet (Contingency Agreement + Third-Party Authorization).
-- The CRM creates a row with a SHA-256 hash of a random token; the raw token only lives in the
-- link sent to the homeowner. The homeowner never touches this table directly: the
-- packet-sign edge function (service role) looks the link up by hash.
create table if not exists public.packet_links (
  id              uuid primary key default gen_random_uuid(),
  token_hash      text not null unique,
  job_id          uuid not null references public.jobs(id) on delete cascade,
  fields          jsonb not null default '{}'::jsonb,   -- snapshot of the packet answers
  rep_name        text,
  rep_sig         text,                                 -- PNG data URL, rep pre-signs
  rep_signed_at   timestamptz,
  sent_to         text,
  status          text not null default 'sent' check (status in ('sent','viewed','signed','void')),
  created_by      text,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null default now() + interval '7 days',
  viewed_at       timestamptz,
  signed_at       timestamptz,
  signed_path     text,
  signed_summary  jsonb,
  audit           jsonb
);

create index if not exists packet_links_job_idx on public.packet_links(job_id, created_at desc);

alter table public.packet_links enable row level security;

drop policy if exists packet_links_select on public.packet_links;
create policy packet_links_select on public.packet_links
  for select to authenticated using (public.can_access_job(job_id));

drop policy if exists packet_links_insert on public.packet_links;
create policy packet_links_insert on public.packet_links
  for insert to authenticated with check (public.can_access_job(job_id) and status = 'sent');

-- Staff may only cancel a link (status -> void); signing happens server-side.
drop policy if exists packet_links_update on public.packet_links;
create policy packet_links_update on public.packet_links
  for update to authenticated
  using (public.can_access_job(job_id) and status <> 'signed')
  with check (public.can_access_job(job_id) and status = 'void');

revoke all on public.packet_links from anon;
