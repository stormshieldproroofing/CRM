-- Mark notes whose text was changed after posting (pinning doesn't count).
alter table public.job_notes add column if not exists edited_at timestamptz;

create or replace function public.job_notes_guard() returns trigger
language plpgsql as $$
begin
  if new.body is distinct from old.body then
    if old.author_id <> auth.uid() then
      raise exception 'Only the author can edit a note';
    end if;
    new.edited_at := now();
  else
    new.edited_at := old.edited_at;
  end if;
  new.job_id := old.job_id;
  new.author_id := old.author_id;
  new.author_name := old.author_name;
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end $$;
