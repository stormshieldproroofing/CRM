-- Supplement alerts: say how much was approved out of what was asked for
-- ("Supplement partially approved · $1,980 of $2,380"). Supplements now keep the
-- amount asked for in `requested`; older ones don't have it, so the title stays as before.
create or replace function public.notify_supplement_approved()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  s        jsonb;
  old_st   text;
  st       text;
  amt      numeric;
  req      numeric;
  ttl      text;
  bdy      text;
  r        uuid;
  key      text;
  what     text;
begin
  if jsonb_typeof(new.contract -> '__supplements') is distinct from 'array' then return new; end if;
  for s in select * from jsonb_array_elements(new.contract -> '__supplements') loop
    st := s ->> 'status';
    if st not in ('Approved', 'Partial') or coalesce(s ->> '_sid', '') = '' then continue; end if;
    select o ->> 'status' into old_st
      from jsonb_array_elements(case when jsonb_typeof(old.contract -> '__supplements') = 'array'
                                     then old.contract -> '__supplements' else '[]'::jsonb end) o
      where o ->> '_sid' = s ->> '_sid' limit 1;
    if old_st is not distinct from st then continue; end if;
    key := new.id || ':' || (s ->> '_sid') || ':' || st;
    if exists (select 1 from notifications where ref = key) then continue; end if;

    amt := nullif(regexp_replace(coalesce(s ->> 'amount', ''), '[^0-9.]', '', 'g'), '')::numeric;
    req := nullif(regexp_replace(coalesce(s ->> 'requested', ''), '[^0-9.]', '', 'g'), '')::numeric;
    ttl := case when st = 'Partial' then 'Supplement partially approved' else 'Supplement approved' end
           || case when amt is not null and amt > 0 then ' · ' || regexp_replace('$' || to_char(amt, 'FM999,999,990.00'), '\.00$', '') else '' end
           || case when st = 'Partial' and req is not null and amt is not null and req > amt
                   then ' of ' || regexp_replace('$' || to_char(req, 'FM999,999,990.00'), '\.00$', '') else '' end;
    what := nullif(left(s ->> 'note', 120), '');
    bdy := coalesce(nullif(concat_ws(' · ', what, nullif(left(s ->> 'decisionNote', 120), '')), ''),
                    case when st = 'Partial' then 'Partially approved by the carrier.' else 'Approved by the carrier.' end);

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
end $function$;
