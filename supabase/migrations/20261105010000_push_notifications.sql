-- Lock-screen (Web Push) alerts for CRM notifications.
--
-- One-time setup NOT in this file (secrets): three Vault secrets, created with
--   select vault.create_secret('<value>', 'push_vapid_public');
--   select vault.create_secret('<value>', 'push_vapid_private');
--   select vault.create_secret('<value>', 'push_hook_token');
-- The public VAPID key is also in crm-notifications.js. Edge function: push-send (verify_jwt off).

-- 'test' notifications (the "Send a test" button)
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('note','mention','packet_viewed','packet_signed','test'));

-- Each phone / browser that turned on alerts
create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  auth_id     uuid not null,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now(),
  last_ok_at  timestamptz
);
create index if not exists push_subscriptions_auth_idx on public.push_subscriptions(auth_id);
alter table public.push_subscriptions enable row level security;
drop policy if exists push_subscriptions_select on public.push_subscriptions;
create policy push_subscriptions_select on public.push_subscriptions for select to authenticated using (auth_id = auth.uid());
drop policy if exists push_subscriptions_delete on public.push_subscriptions;
create policy push_subscriptions_delete on public.push_subscriptions for delete to authenticated using (auth_id = auth.uid());
revoke all on public.push_subscriptions from anon;
revoke insert, update on public.push_subscriptions from authenticated;
grant select, delete on public.push_subscriptions to authenticated;

-- Save this device for the signed-in person (a shared phone moves to whoever turned it on last)
create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_ua text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if p_endpoint !~ '^https://' or length(p_endpoint) > 1000 or length(p_p256dh) > 200 or length(p_auth) > 100 then
    raise exception 'bad subscription';
  end if;
  insert into push_subscriptions(auth_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_ua, 300))
  on conflict (endpoint) do update set auth_id = excluded.auth_id, p256dh = excluded.p256dh, auth = excluded.auth,
    user_agent = excluded.user_agent, created_at = now();
end $$;
revoke all on function public.save_push_subscription(text, text, text, text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;

create or replace function public.remove_push_subscription(p_endpoint text)
returns void language sql security definer set search_path = public as $$
  delete from push_subscriptions where endpoint = p_endpoint and auth_id = auth.uid();
$$;
revoke all on function public.remove_push_subscription(text) from public, anon;
grant execute on function public.remove_push_subscription(text) to authenticated;

-- "Send a test" button: a notification to yourself
create or replace function public.send_test_notification()
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  insert into notifications(recipient, kind, title, body)
  values (auth.uid(), 'test', 'Test alert', 'Lock-screen alerts are working on this device.');
end $$;
revoke all on function public.send_test_notification() from public, anon;
grant execute on function public.send_test_notification() to authenticated;

-- Keys for the push-send function (service role only)
create or replace function public.push_config()
returns json language sql security definer set search_path = public, vault as $$
  select json_build_object(
    'vapid_public',  (select decrypted_secret from vault.decrypted_secrets where name = 'push_vapid_public'),
    'vapid_private', (select decrypted_secret from vault.decrypted_secrets where name = 'push_vapid_private'),
    'hook_token',    (select decrypted_secret from vault.decrypted_secrets where name = 'push_hook_token'));
$$;
revoke all on function public.push_config() from public, anon, authenticated;
grant execute on function public.push_config() to service_role;

-- New notification → ask push-send to deliver it (async; never blocks or fails the insert)
create or replace function public.notifications_push() returns trigger
language plpgsql security definer set search_path = public, vault, net as $$
declare tok text;
begin
  if not exists (select 1 from push_subscriptions where auth_id = new.recipient) then return new; end if;
  select decrypted_secret into tok from vault.decrypted_secrets where name = 'push_hook_token';
  if tok is null then return new; end if;
  perform net.http_post(
    url     := 'https://lqhdhflsgswctdwmojhd.supabase.co/functions/v1/push-send',
    body    := jsonb_build_object('id', new.id),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-token', tok),
    timeout_milliseconds := 8000);
  return new;
exception when others then
  return new;
end $$;
drop trigger if exists notifications_push on public.notifications;
create trigger notifications_push after insert on public.notifications
  for each row execute function public.notifications_push();
