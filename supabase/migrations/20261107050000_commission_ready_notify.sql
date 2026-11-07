-- "Commission check ready": when the office records a commission payment on a job,
-- alert the rep it's for (bell + lock screen). Only new payments alert; editing or
-- deleting a payment doesn't.
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind = any (array['note','mention','packet_viewed','packet_signed','test','supplement_approved','job_approved','commission_ready']));

create or replace function public.notify_commission_ready()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  p    jsonb;
  k    text;
  r    uuid;
  amt  numeric;
  how  text;
  key  text;
begin
  if jsonb_typeof(new.commission_payouts) is distinct from 'array' then return new; end if;
  for p in select * from jsonb_array_elements(new.commission_payouts) loop
    k := coalesce(nullif(p ->> '_pid', ''), nullif(p ->> 'paidAt', ''));
    if k is null or coalesce(p ->> 'paidTo', '') = '' then continue; end if;
    -- already there before this save? then it's an edit, not a new payment
    -- (matched by its id, or by when it was recorded, since older payments get an id added later)
    if jsonb_typeof(old.commission_payouts) = 'array' and exists (
         select 1 from jsonb_array_elements(old.commission_payouts) o
         where (nullif(o ->> '_pid', '') is not null and o ->> '_pid' = p ->> '_pid')
            or (nullif(o ->> 'paidAt', '') is not null and o ->> 'paidAt' = p ->> 'paidAt')) then continue; end if;
    key := new.id || ':comm:' || coalesce(nullif(p ->> 'paidAt', ''), k);
    if exists (select 1 from notifications where ref = key) then continue; end if;
    select auth_id into r from team_members where id = p ->> 'paidTo' and auth_id is not null limit 1;
    if r is null then continue; end if;
    amt := nullif(regexp_replace(coalesce(p ->> 'amount', ''), '[^0-9.]', '', 'g'), '')::numeric;
    how := nullif(initcap(coalesce(p ->> 'method', '')), '');
    insert into notifications(recipient, kind, job_id, job_label, actor_name, title, body, ref)
    values (r, 'commission_ready', new.id, new.name, null, 'Commission check ready',
            concat_ws(' · ', case when amt is not null then regexp_replace('$' || to_char(amt, 'FM999,999,990.00'), '\.00$', '') end, how),
            key);
  end loop;
  return new;
end $function$;

drop trigger if exists jobs_commission_ready_notify on public.jobs;
create trigger jobs_commission_ready_notify
  after update of commission_payouts on public.jobs
  for each row when (old.commission_payouts is distinct from new.commission_payouts)
  execute function public.notify_commission_ready();
