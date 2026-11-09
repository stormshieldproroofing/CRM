-- Logged calls/texts (jobs.contact_log) alert the job's assigned salesman, like notes do:
--   "Office logged a call" · "Adjuster called · Wants photos of the back slope"
-- Not when the salesman logged it themselves. Only new entries alert.
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind = any (array['note','mention','contact','packet_viewed','packet_signed','test','supplement_approved','job_approved','commission_ready']));

create or replace function public.notify_contact_log()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  e        jsonb;
  rep_auth uuid;
  who      text;
  party    text;
  meth     text;
  head     text;
  key      text;
begin
  if jsonb_typeof(new.contact_log) is distinct from 'array' then return new; end if;
  select auth_id into rep_auth from team_members where id = new.assigned_to;
  if rep_auth is null or rep_auth is not distinct from auth.uid() then return new; end if;
  for e in select * from jsonb_array_elements(new.contact_log) loop
    if coalesce(e ->> 'at', '') = '' then continue; end if;
    if jsonb_typeof(old.contact_log) = 'array' and exists (
         select 1 from jsonb_array_elements(old.contact_log) o where o ->> 'at' = e ->> 'at') then continue; end if;
    key := new.id || ':contact:' || (e ->> 'at');
    if exists (select 1 from notifications where ref = key) then continue; end if;
    who   := split_part(coalesce(nullif(e ->> 'by', ''), 'Someone'), ' ', 1);
    party := e ->> 'party';
    meth  := coalesce(e ->> 'method', '');
    if e ->> 'dir' = 'in' then
      head := coalesce(case party when 'client' then 'Homeowner' when 'adjuster' then 'Adjuster' when 'carrier' then 'Carrier' end, 'They') || ' ' ||
              coalesce(case meth when 'call' then 'called' when 'text' then 'texted' when 'email' then 'emailed'
                                 when 'voicemail' then 'left a voicemail' when 'in-person' then 'stopped by' end, 'reached out');
    else
      head := coalesce(case meth when 'call' then 'Called' when 'text' then 'Texted' when 'email' then 'Emailed'
                                 when 'voicemail' then 'Left voicemail for' when 'in-person' then 'Met with' end, 'Contacted') || ' ' ||
              coalesce(case party when 'client' then 'homeowner' when 'adjuster' then 'adjuster' when 'carrier' then 'carrier' end, coalesce(party, ''));
    end if;
    insert into notifications(recipient, kind, job_id, job_label, actor_name, title, body, ref)
    values (rep_auth, 'contact', new.id, new.name, who,
            who || ' logged a ' || case meth when 'call' then 'call' when 'text' then 'text' when 'email' then 'email'
                                            when 'voicemail' then 'voicemail' when 'in-person' then 'visit' else 'contact' end,
            concat_ws(' · ', trim(head), nullif(left(e ->> 'note', 200), '')),
            key);
  end loop;
  return new;
end $function$;

drop trigger if exists jobs_contact_log_notify on public.jobs;
create trigger jobs_contact_log_notify
  after update of contact_log on public.jobs
  for each row when (old.contact_log is distinct from new.contact_log)
  execute function public.notify_contact_log();
