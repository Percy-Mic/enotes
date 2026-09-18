-- ============================================================
-- PUSH DELIVERY BRIDGE: notifications INSERT → /api/push/send
--
-- Makes browser Web Push functional. When any row lands in
-- public.notifications, this trigger posts it to the app's
-- server-only push endpoint (app/api/push/send), which delivers
-- via web-push (VAPID) to every push_subscriptions row the user
-- registered. Free-tier all the way: pg_net for the HTTP call,
-- the browser's own push service for transport.
--
-- OPERATOR STEP (outside SQL): the endpoint URL must point at the
-- production deployment. Update platform_config key 'push_endpoint'
-- after deploying, e.g.
--   insert into platform_config (key, value) values
--     ('push_endpoint', '"https://enotes-amber.vercel.app/api/push/send"')
--   on conflict (key) do update set value = excluded.value;
--
-- The endpoint URL is intentionally stored in the DB (not a secret):
-- it is the public app URL. The VAPID private key and PUSH_SEND_SECRET
-- live only in the server environment.
-- ============================================================

-- 1) pg_net for async HTTP from triggers (free, built into Supabase)
create extension if not exists pg_net;

-- 2) Trigger function: fire-and-forget POST per notification insert.
--    SECURITY DEFINER so it can read platform_config regardless of the
--    caller's policies; search_path pinned per project convention.
create or replace function public.notify_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  endpoint text;
  secret  text;
  payload jsonb;
begin
  select value #>> '{}' into endpoint from public.platform_config where key = 'push_endpoint';
  if endpoint is null or endpoint = '' then
    return new; -- push not configured on this deployment; in-app notifications still work
  end if;

  select value #>> '{}' into secret from public.platform_config where key = 'push_send_secret';
  if secret is null or secret = '' then
    return new; -- endpoint would reject us; skip the wasted call
  end if;

  /* The trigger runs SECURITY DEFINER, so it reads push_subscriptions
     directly (RLS bypassed for this definer read) and attaches the
     recipient's own targets. The endpoint never needs a service-role
     key — it can only send to subscriptions the DB selected. */
  payload := jsonb_build_object(
    'userId', new.user_id,
    'title',  'enotes',
    'body',   coalesce(new.message, 'You have a new notification'),
    'url',    '/notifications',
    'tag',    new.id::text,
    'targets', coalesce(
      (select jsonb_agg(jsonb_build_object(
                'endpoint', s.endpoint,
                'p256dh',   s.p256dh,
                'auth',     s.auth_key))
         from public.push_subscriptions s
         where s.user_id = new.user_id),
      '[]'::jsonb)
  );

  perform net.http_post(
    url := endpoint,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-push-send-secret', secret
    ),
    body := payload,
    timeout_milliseconds := 5000
  );

  return new;
end;
$$;

-- 3) Attach AFTER INSERT (row level). Drop first so this migration is
--    safely re-runnable.
drop trigger if exists trg_notify_push on public.notifications;
create trigger trg_notify_push
  after insert on public.notifications
  for each row execute function public.notify_push();

-- 4) Optional hardening for platform_config: only admins may write the
--    config rows (read stays open — it holds no secrets). Skip cleanly
--    if a policy with this name already exists.
do $$
begin
  if not exists (
    select 1 from pg_policies where tablename = 'platform_config' and policyname = 'platform_config_admin_write'
  ) then
    create policy platform_config_admin_write on public.platform_config
      for all to authenticated
      using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin))
      with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));
  end if;
end;
$$;
