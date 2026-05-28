-- Optional starter data for StormShield CRM.
-- Run after schema.sql.
-- Safe to run more than once.

insert into public.team_members (id, name, email, phone, role, color, status, permissions)
values
  ('mt', 'Matthew Trinh', 'matthew.trinh@stormshield.com', '(214) 555-0100', 'admin', '#1557A8', 'active',
    array['view_jobs','edit_jobs','delete_jobs','manage_team','view_payments','edit_payments','manage_boards','view_reports']),
  ('jd', 'Jake Davis', 'jake.davis@stormshield.com', '(214) 555-0107', 'manager', '#0F7B5A', 'active',
    array['view_jobs','edit_jobs','view_payments','manage_boards','view_reports']),
  ('sa', 'Sara Avery', 'sara.avery@stormshield.com', '(214) 555-0114', 'salesman', '#8B3FA8', 'active',
    array['view_jobs','edit_jobs']),
  ('rk', 'Ron Kim', 'ron.kim@stormshield.com', '(214) 555-0121', 'salesman', '#C0510B', 'active',
    array['view_jobs','edit_jobs'])
on conflict (id) do update
set
  name = excluded.name,
  email = excluded.email,
  phone = excluded.phone,
  role = excluded.role,
  color = excluded.color,
  status = excluded.status,
  permissions = excluded.permissions;

insert into public.pipelines (id, name, sort_order)
values ('insurance', 'Insurance', 1)
on conflict (id) do update
set name = excluded.name, sort_order = excluded.sort_order;

insert into public.pipeline_stages (id, pipeline_id, name, icon, color, locked, sort_order)
values
  ('lead', 'insurance', 'Lead', 'ti-antenna', '#4D9DE0', false, 1),
  ('inspection', 'insurance', 'Inspection', 'ti-clipboard-list', '#F59E0B', false, 2),
  ('approved', 'insurance', 'Approved', 'ti-shield-check', '#34D399', false, 3),
  ('contract', 'insurance', 'Contract Signed', 'ti-writing-sign', '#A78BFA', false, 4),
  ('invoiced', 'insurance', 'Invoiced', 'ti-cash', '#FB923C', false, 5),
  ('completed', 'insurance', 'Job Completed', 'ti-rosette-discount-check', '#38BDF8', false, 6)
on conflict (pipeline_id, id) do update
set
  pipeline_id = excluded.pipeline_id,
  name = excluded.name,
  icon = excluded.icon,
  color = excluded.color,
  locked = excluded.locked,
  sort_order = excluded.sort_order;
