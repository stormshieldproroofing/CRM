-- Contract e-signing: the Contract tab now signs the way the Claim Packet does (in person
-- or through a private link). Signing links for both documents share packet_links; the new
-- `doc` column says which one a link is for. Existing rows are packets.
alter table public.packet_links add column if not exists doc text not null default 'packet';
alter table public.packet_links drop constraint if exists packet_links_doc_chk;
alter table public.packet_links add constraint packet_links_doc_chk check (doc in ('packet','contract'));
create index if not exists packet_links_job_doc_idx on public.packet_links(job_id, doc, created_at desc);

-- Alerts: "Contract opened" / "Contract signed" alongside the packet ones.
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind = any (array['note','mention','contact','packet_viewed','packet_signed','contract_viewed','contract_signed','test','supplement_approved','job_approved','commission_ready']));

create or replace function public.notify_packet_link() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  j      record;
  kind   text;
  ttl    text;
  bdy    text;
  r      uuid;
  what   text;
begin
  what := case when new.doc = 'contract' then 'contract' else 'claim packet' end;
  if old.viewed_at is null and new.viewed_at is not null then
    kind := case when new.doc = 'contract' then 'contract_viewed' else 'packet_viewed' end;
    ttl := case when new.doc = 'contract' then 'Contract opened' else 'Packet opened' end;
  elsif new.status = 'signed' and old.status is distinct from 'signed' then
    kind := case when new.doc = 'contract' then 'contract_signed' else 'packet_signed' end;
    ttl := case when new.doc = 'contract' then 'Contract signed' else 'Packet signed' end;
  else
    return new;
  end if;
  select id, name, assigned_to into j from jobs where id = new.job_id;
  bdy := case
    when kind in ('packet_viewed', 'contract_viewed') then coalesce(j.name, 'The homeowner') || ' opened the ' || what || '.'
    when kind = 'contract_signed' then coalesce(j.name, 'The homeowner') || ' signed the contract.'
    else coalesce(j.name, 'The homeowner') || ' signed the claim packet. Ready to send to the PA.' end;
  for r in
    select distinct x.a from (
      select auth_id a from team_members where id = j.assigned_to
      union all
      select auth_id from team_members where new.created_by is not null and (name = new.created_by or id = new.created_by)
    ) x where x.a is not null
  loop
    insert into notifications(recipient, kind, job_id, job_label, actor_name, title, body)
    values (r, kind, new.job_id, j.name, j.name, ttl, bdy);
  end loop;
  return new;
end $$;
