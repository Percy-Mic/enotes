-- ============================================================
-- ENOTES PUSH DELIVERY HARDENING
--
-- Fixes:
-- 1. Message notifications must not disappear when a recipient has
--    no user_settings row yet.
-- 2. Group calls must push to every invited participant, not only
--    calls.callee_id (which is the host for group-call compatibility).
-- 3. Normal 1:1 call push must ignore group-call rows.
--
-- Run this AFTER the existing push/message/group-call migrations.
-- ============================================================

create extension if not exists pg_net;

-- ------------------------------------------------------------
-- MESSAGE NOTIFICATION ROWS
-- ------------------------------------------------------------

create or replace function public.notify_new_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notifications (
    user_id,
    actor_id,
    type,
    entity_type,
    entity_id,
    message,
    dedupe_key
  )
  select
    cm.user_id,
    new.sender_id,
    'message',
    'conversation',
    new.conversation_id::text,
    case
      when new.message_type = 'text'
        then left(
          coalesce(
            nullif(btrim(new.content), ''),
            'Sent you a message'
          ),
          160
        )
      when new.message_type = 'image' then 'Sent you a photo'
      when new.message_type = 'video' then 'Sent you a video'
      when new.message_type = 'audio' then 'Sent you a voice message'
      when new.message_type = 'gif' then 'Sent you a GIF'
      when new.message_type = 'sticker' then 'Sent you a sticker'
      when new.message_type = 'file' then 'Sent you a file'
      else 'Sent you a message'
    end,
    'message:' || new.id::text || ':' || cm.user_id::text
  from public.conversation_members cm
  left join public.user_settings us
    on us.user_id = cm.user_id
  where cm.conversation_id = new.conversation_id
    and cm.user_id <> new.sender_id
    and cm.muted = false
    and coalesce(us.notify_messages, true) = true;

  return new;
end;
$$;

drop trigger if exists trg_notify_new_message
on public.messages;

create trigger trg_notify_new_message
after insert on public.messages
for each row
execute function public.notify_new_message();


-- ------------------------------------------------------------
-- NORMAL 1:1 CALL PUSH
-- ------------------------------------------------------------

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
begin
  if new.status <> 'ringing'
     or coalesce(new.metadata ->> 'group_call', 'false') = 'true' then
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

  if endpoint is null or endpoint = ''
     or secret is null or secret = '' then
    return new;
  end if;

  select coalesce(
    nullif(p.full_text_name, ''),
    nullif(p.username, ''),
    'Someone'
  )
    into caller_name
    from public.profiles p
   where p.id = new.caller_id;

  target_url :=
    case
      when new.conversation_id is not null
        then '/messages/' || new.conversation_id::text
             || '?call=' || new.id::text
      else '/notifications?call=' || new.id::text
    end;

  payload := jsonb_build_object(
    'userId', new.callee_id,
    'title',
      case
        when new.media = 'video'
          then 'Incoming video call'
        else 'Incoming call'
      end,
    'body', caller_name || ' is calling you',
    'url', target_url,
    'tag', 'call:' || new.id::text,
    'type', 'call',
    'targets',
      coalesce(
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

drop trigger if exists trg_notify_call_push
on public.calls;

create trigger trg_notify_call_push
after insert on public.calls
for each row
execute function public.notify_call_push();


-- ------------------------------------------------------------
-- GROUP CALL PUSH
--
-- Group calls create one calls row whose callee_id is the host.
-- The actual invitees are in call_participants, so the push must
-- fire when each participant row with status=ringing is created.
-- ------------------------------------------------------------

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
  group_title text;
  target_url text;
  call_row public.calls%rowtype;
begin
  if new.status <> 'ringing' then
    return new;
  end if;

  select c.*
    into call_row
    from public.calls c
   where c.id = new.call_id
     and c.metadata ->> 'group_call' = 'true';

  if not found
     or new.user_id = call_row.caller_id then
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

  if endpoint is null or endpoint = ''
     or secret is null or secret = '' then
    return new;
  end if;

  select coalesce(
    nullif(p.full_text_name, ''),
    nullif(p.username, ''),
    'Someone'
  )
    into caller_name
    from public.profiles p
   where p.id = call_row.caller_id;

  select coalesce(
    nullif(c.title, ''),
    'Group call'
  )
    into group_title
    from public.conversations c
   where c.id = call_row.conversation_id;

  target_url :=
    '/messages/' || call_row.conversation_id::text
    || '?call=' || call_row.id::text;

  payload := jsonb_build_object(
    'userId', new.user_id,
    'title',
      case
        when call_row.media = 'video'
          then 'Incoming group video call'
        else 'Incoming group call'
      end,
    'body',
      caller_name || ' invited you to ' || group_title,
    'url', target_url,
    'tag', 'group-call:' || call_row.id::text,
    'type', 'call',
    'targets',
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'endpoint', s.endpoint,
              'p256dh', s.p256dh,
              'auth', s.auth_key
            )
          )
          from public.push_subscriptions s
          where s.user_id = new.user_id
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

drop trigger if exists trg_notify_group_call_push
on public.call_participants;

create trigger trg_notify_group_call_push
after insert on public.call_participants
for each row
execute function public.notify_group_call_push();

notify pgrst, 'reload schema';
