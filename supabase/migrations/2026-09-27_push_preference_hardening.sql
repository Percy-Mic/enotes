-- ENOTES PUSH PREFERENCE HARDENING
-- Call notifications must honor user_settings.notify_calls.
-- Message delivery remains controlled by notify_new_message + conversation_members.muted.

create or replace function public.notify_call_push()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  endpoint text;
  secret text;
  payload jsonb;
  caller_name text;
  target_url text;
  calls_enabled boolean;
begin
  if new.status <> 'ringing'
     or coalesce(new.metadata ->> 'group_call', 'false') = 'true' then
    return new;
  end if;

  select coalesce(us.notify_calls, true)
    into calls_enabled
    from public.user_settings us
   where us.user_id = new.callee_id;

  if calls_enabled is false then
    return new;
  end if;

  select value #>> '{}' into endpoint from public.platform_config where key = 'push_endpoint';
  select value #>> '{}' into secret from public.platform_config where key = 'push_send_secret';

  if endpoint is null or endpoint = '' or secret is null or secret = '' then
    return new;
  end if;

  select coalesce(nullif(p.full_text_name, ''), nullif(p.username, ''), 'Someone')
    into caller_name
    from public.profiles p
   where p.id = new.caller_id;

  target_url := case
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
    'callId', new.id::text,
    'conversationId', new.conversation_id::text,
    'senderId', new.caller_id::text,
    'senderName', caller_name,
    'targets', coalesce(
      (select jsonb_agg(jsonb_build_object(
        'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth_key))
       from public.push_subscriptions s
       where s.user_id = new.callee_id),
      '[]'::jsonb)
  );

  perform net.http_post(
    url := endpoint,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-send-secret', secret),
    body := payload,
    timeout_milliseconds := 5000
  );

  return new;
end;
$$;

create or replace function public.notify_group_call_push()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  endpoint text;
  secret text;
  payload jsonb;
  caller_name text;
  caller_avatar text;
  group_title text;
  target_url text;
  call_row public.calls%rowtype;
  calls_enabled boolean;
begin
  if new.status <> 'ringing' then return new; end if;

  select c.* into call_row
    from public.calls c
   where c.id = new.call_id
     and c.metadata ->> 'group_call' = 'true';

  if not found or new.user_id = call_row.caller_id then return new; end if;

  select coalesce(us.notify_calls, true)
    into calls_enabled
    from public.user_settings us
   where us.user_id = new.user_id;

  if calls_enabled is false then return new; end if;

  select value #>> '{}' into endpoint from public.platform_config where key = 'push_endpoint';
  select value #>> '{}' into secret from public.platform_config where key = 'push_send_secret';

  if endpoint is null or endpoint = '' or secret is null or secret = '' then return new; end if;

  select coalesce(nullif(p.full_text_name, ''), nullif(p.username, ''), 'Someone'), p.avatar_url
    into caller_name, caller_avatar
    from public.profiles p
   where p.id = call_row.caller_id;

  select coalesce(nullif(c.title, ''), 'Group call')
    into group_title
    from public.conversations c
   where c.id = call_row.conversation_id;

  target_url := '/messages/' || call_row.conversation_id::text || '?call=' || call_row.id::text;

  payload := jsonb_build_object(
    'userId', new.user_id,
    'title', case when call_row.media = 'video' then 'Incoming group video call' else 'Incoming group call' end,
    'body', caller_name || ' invited you to ' || group_title,
    'url', target_url,
    'tag', 'group-call:' || call_row.id::text,
    'type', 'call',
    'callId', call_row.id::text,
    'conversationId', call_row.conversation_id::text,
    'senderId', call_row.caller_id::text,
    'senderName', caller_name,
    'icon', caller_avatar,
    'targets', coalesce(
      (select jsonb_agg(jsonb_build_object(
        'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth_key))
       from public.push_subscriptions s
       where s.user_id = new.user_id),
      '[]'::jsonb)
  );

  perform net.http_post(
    url := endpoint,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-send-secret', secret),
    body := payload,
    timeout_milliseconds := 5000
  );

  return new;
end;
$$;

drop trigger if exists trg_notify_group_call_push on public.call_participants;
create trigger trg_notify_group_call_push
after insert or update of status on public.call_participants
for each row
when (new.status = 'ringing')
execute function public.notify_group_call_push();

notify pgrst, 'reload schema';