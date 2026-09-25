-- ============================================================
-- PRIORITY CALL ALERTS
--
-- A call must reach the user even when the enotes page is closed,
-- backgrounded, or the phone is currently showing another app.
--
-- WebSocket/Reatime handles the live in-app call UI.
-- Web Push handles the closed/background path.
-- The browser service worker displays the OS notification.
-- ============================================================

create extension if not exists pg_net;

create or replace function public.notify_call_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  endpoint text;
  secret text;
  payload jsonb;
  caller_name text;
  target_url text;
begin
  if new.status <> 'ringing' then
    return new;
  end if;

  select value #>> '{}'
    into endpoint
    from public.platform_config
   where key = 'push_endpoint';

  select value #>> '{}'
    into secret
    from public.platform_config
   where key = 'push_send_secret';

  if endpoint is null or endpoint = '' or secret is null or secret = '' then
    return new;
  end if;

  select coalesce(nullif(p.full_text_name, ''), nullif(p.username, ''), 'Someone')
    into caller_name
    from public.profiles p
   where p.id = new.caller_id;

  target_url :=
    case
      when new.conversation_id is not null
        then '/messages/' || new.conversation_id::text || '?call=' || new.id::text
      else '/notifications?call=' || new.id::text
    end;

  payload := jsonb_build_object(
    'userId', new.callee_id,
    'title', case when new.media = 'video' then 'Incoming video call' else 'Incoming call' end,
    'body', caller_name || ' is calling you',
    'url', target_url,
    'tag', 'call:' || new.id::text,
    'type', 'call',
    'targets', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'endpoint', s.endpoint,
            'p256dh', s.p256dh,
            'auth', s.auth_key
          )
        )
        from public.push_subscriptions s
        where s.user_id = new.callee_id
      ),
      '[]'::jsonb
    )
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

drop trigger if exists trg_notify_call_push on public.calls;

create trigger trg_notify_call_push
  after insert on public.calls
  for each row
  execute function public.notify_call_push();

-- Make sure the calls table is included in Supabase Realtime.
do $$
begin
  if not exists (
    select 1
      from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'calls'
  ) then
    alter publication supabase_realtime add table public.calls;
  end if;
end;
$$;
