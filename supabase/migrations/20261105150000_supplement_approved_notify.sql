-- Notify when a supplement is approved (or partially approved).
-- Supplements live in jobs.contract -> '__supplements' as [{_sid, amount, status, note}].
-- When one turns Approved / Partial, alert the job's rep and the office (admins + managers),
-- except whoever made the change. Each supplement alerts once per status (ref = job:_sid:status).

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('note','mention','packet_viewed','packet_signed','test','supplement_approved'));
alter table public.notifications add column if not exists ref text;
create index if not exists notifications_ref_idx on public.notifications(ref) where ref is not null;

create or replace function public.notify_supplement_approved() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  s        jsonb;
  old_st   text;
  st       text;
  amt      numeric;
  ttl      text;
  bdy      text;
  r        uuid;
  key      text;
begin
  if jsonb_typeof(new.contract -> '__supplements') is distinct from 'array' then return new; end if;
  for s in select * from jsonb_array_elements(new.contract -> '__supplements') loop
    st := s ->> 'status';
    if st not in ('Approved', 'Partial') or coalesce(s ->> '_sid', '') = '' then continue; end if;
    select o ->> 'status' into old_st
      from jsonb_array_elements(case when jsonb_typeof(old.contract -> '__supplements') = 'array'
                                     then old.contract -> '__supplements' else '[]'::jsonb end) o
      where o ->> '_sid' = s ->> '_sid' limit 1;
    if old_st is not distinct from st then continue; end if;       -- no change for this one
    key := new.id || ':' || (s ->> '_sid') || ':' || st;
    if exists (select 1 from notifications where ref = key) then continue; end if;   -- already told (e.g. a re-sync)

    amt := nullif(regexp_replace(coalesce(s ->> 'amount', ''), '[^0-9.]', '', 'g'), '')::numeric;
    ttl := case when st = 'Partial' then 'Supplement partially approved' else 'Supplement approved' end
           || case when amt is not null and amt > 0 then ' · $' || to_char(amt, 'FM999,999,990.00') else '' end;
    ttl := regexp_replace(ttl, '\.00$', '');
    bdy := coalesce(nullif(left(s ->> 'note', 160), ''), case when st = 'Partial' then 'Partially approved by the carrier.' else 'Approved by the carrier.' end);

    for r in
      select distinct a from (
        select auth_id a from team_members where id = new.assigned_to
        union all
        select auth_id from team_members where role in ('admin', 'manager') and coalesce(status, 'active') = 'active'
      ) x
      where a is not null and a is distinct from auth.uid()
    loop
      insert into notifications(recipient, kind, job_id, job_label, actor_name, title, body, ref)
      values (r, 'supplement_approved', new.id, new.name, null, ttl, bdy, key);
    end loop;
  end loop;
  return new;
end $$;

drop trigger if exists jobs_supplement_notify on public.jobs;
create trigger jobs_supplement_notify after update of contract on public.jobs
  for each row when (old.contract -> '__supplements' is distinct from new.contract -> '__supplements')
  execute function public.notify_supplement_approved();
