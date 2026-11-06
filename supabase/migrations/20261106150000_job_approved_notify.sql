-- Alert when a job moves into an "Approved" stage (any pipeline).
-- Reads: Approved / homeowner name / address. Goes to the assigned rep and to
-- admins/managers, not to whoever moved it. Shows in the bell and on the lock screen.
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind = any (array['note','mention','packet_viewed','packet_signed','test','supplement_approved','job_approved']));

create or replace function public.notify_job_approved()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r      uuid;
  ttl    text;
  bdy    text;
  key    text;
begin
  if new.stage_id is null or new.stage_id is not distinct from old.stage_id then return new; end if;
  if not (new.stage_id = 'approved' or new.stage_id like '%-approved'
          or exists (select 1 from pipeline_stages ps where ps.id = new.stage_id and ps.name ilike 'approved')) then
    return new;
  end if;
  -- once per job per day, so dragging it back and forth doesn't spam
  key := new.id || ':approved:' || to_char(now() at time zone 'America/Chicago', 'YYYY-MM-DD');
  if exists (select 1 from notifications where ref = key) then return new; end if;

  ttl := 'Approved';
  -- street and city: "10439 Acacia Forest Trail, Houston"
  bdy := nullif(trim(both ', ' from concat_ws(',', split_part(coalesce(new.address, ''), ',', 1), split_part(coalesce(new.address, ''), ',', 2))), '');

  for r in
    select distinct a from (
      select auth_id a from team_members where id = new.assigned_to
      union all
      select auth_id from team_members where role in ('admin', 'manager') and coalesce(status, 'active') = 'active'
    ) x
    where a is not null and a is distinct from auth.uid()
  loop
    insert into notifications(recipient, kind, job_id, job_label, actor_name, title, body, ref)
    values (r, 'job_approved', new.id, new.name, null, ttl, bdy, key);
  end loop;
  return new;
end $function$;

drop trigger if exists jobs_approved_notify on public.jobs;
create trigger jobs_approved_notify
  after update of stage_id on public.jobs
  for each row when (old.stage_id is distinct from new.stage_id)
  execute function public.notify_job_approved();
