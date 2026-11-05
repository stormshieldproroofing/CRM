-- In-app notifications: new notes on your jobs, @mentions, packet opened / signed.
-- Rows are created only by the database triggers below (security definer);
-- people can read their own and mark them read, nothing else.

create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  recipient   uuid not null,                                   -- auth user id
  kind        text not null check (kind in ('note','mention','packet_viewed','packet_signed')),
  job_id      uuid references public.jobs(id) on delete cascade,
  note_id     uuid references public.job_notes(id) on delete cascade,
  job_label   text,                                            -- job name at the time (shown even without job access)
  actor_name  text,
  title       text not null,
  body        text,
  created_at  timestamptz not null default now(),
  read_at     timestamptz
);
create index if not exists notifications_recipient_idx on public.notifications(recipient, created_at desc);

alter table public.notifications enable row level security;

drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications
  for select to authenticated using (recipient = auth.uid());

drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications
  for update to authenticated using (recipient = auth.uid()) with check (recipient = auth.uid());

drop policy if exists notifications_delete on public.notifications;
create policy notifications_delete on public.notifications
  for delete to authenticated using (recipient = auth.uid());

revoke all on public.notifications from anon;
revoke insert, update on public.notifications from authenticated;
grant select, delete on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;

-- Notes can name the people they @mention (team_members.id)
alter table public.job_notes add column if not exists mentions text[] not null default '{}';

-- ── New note → assigned rep + anyone @mentioned ───────────────────────────
create or replace function public.notify_job_note() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  j        record;
  rep_auth uuid;
  m_auth   uuid;
  who      text := coalesce(nullif(new.author_name, ''), 'Someone');
  snippet  text := left(new.body, 240);
  mentioned uuid[] := '{}';
begin
  select id, name, assigned_to into j from jobs where id = new.job_id;
  select auth_id into rep_auth from team_members where id = j.assigned_to;

  for m_auth in
    select distinct tm.auth_id from team_members tm
    where tm.id = any(coalesce(new.mentions, '{}')) and tm.auth_id is not null and tm.auth_id <> new.author_id
  loop
    insert into notifications(recipient, kind, job_id, note_id, job_label, actor_name, title, body)
    values (m_auth, 'mention', new.job_id, new.id, j.name, who, who || ' mentioned you', snippet);
    mentioned := mentioned || m_auth;
  end loop;

  if rep_auth is not null and rep_auth <> new.author_id and not (rep_auth = any(mentioned)) then
    insert into notifications(recipient, kind, job_id, note_id, job_label, actor_name, title, body)
    values (rep_auth, 'note', new.job_id, new.id, j.name, who, who || ' added a note', snippet);
  end if;
  return new;
end $$;

drop trigger if exists job_notes_notify on public.job_notes;
create trigger job_notes_notify after insert on public.job_notes
  for each row execute function public.notify_job_note();

-- ── Claim packet opened / signed by the homeowner → rep + whoever sent it ──
create or replace function public.notify_packet_link() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  j      record;
  kind   text;
  ttl    text;
  bdy    text;
  r      uuid;
begin
  if old.viewed_at is null and new.viewed_at is not null then
    kind := 'packet_viewed'; ttl := 'Packet opened';
  elsif new.status = 'signed' and old.status is distinct from 'signed' then
    kind := 'packet_signed'; ttl := 'Packet signed';
  else
    return new;
  end if;
  select id, name, assigned_to into j from jobs where id = new.job_id;
  bdy := case kind
    when 'packet_viewed' then coalesce(j.name, 'The homeowner') || ' opened the claim packet.'
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

drop trigger if exists packet_links_notify on public.packet_links;
create trigger packet_links_notify after update on public.packet_links
  for each row execute function public.notify_packet_link();

-- Live delivery to the CRM
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.notifications;
    exception when duplicate_object then null;
    end;
  end if;
end $$;
