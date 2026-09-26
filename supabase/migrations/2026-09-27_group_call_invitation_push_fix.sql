-- GROUP CALL INVITATION PUSH + REINVITE REPAIR
-- Re-inviting a participant uses UPDATE on the existing call_participants row,
-- so an INSERT-only push trigger misses it. This migration makes the invite
-- operation reliable and sends the same Web Push for both first invite and
-- re-invite.

create extension if not exists pg_net;

create or replace function public.invite_group_call_participant(
  p_call_id uuid,
  p_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_host_id uuid := auth.uid();
  v_call public.calls%rowtype;
begin
  if v_host_id is null then
    raise sqlstate 'PT401'
      using message = 'You must be signed in.';
  end if;

  select c.*
    into v_call
    from public.calls c
   where c.id = p_call_id
     and c.metadata ->> 'group_call' = 'true'
     and c.caller_id = v_host_id
   for update;

  if not found then
    raise sqlstate 'PT403'
      using message = 'Only the group-call host can invite participants.';
  end if;

  if v_call.status in ('ended', 'missed', 'declined', 'busy', 'failed') then
    raise sqlstate 'PT409'
      using message = 'This group call is no longer active.';
  end if;

  if p_user_id = v_host_id then
    raise sqlstate 'PT400'
      using message = 'You are already in this group call.';
  end if;

  if not exists (
    select 1
      from public.conversation_members cm
     where cm.conversation_id = v_call.conversation_id
       and cm.user_id = p_user_id
  ) then
    raise sqlstate 'PT403'
      using message = 'That user is not a member of this group.';
  end if;

  insert into public.call_participants (
    call_id, user_id, role, status, joined_at, left_at, updated_at
  )
  values (
    p_call_id, p_user_id, 'participant', 'ringing',
    null, null, timezone('utc', now())
  )
  on conflict (call_id, user_id)
  do update set
    role = 'participant',
    status = 'ringing',
    joined_at = null,
    left_at = null,
    updated_at = timezone('utc', now());

  insert into public.call_events (call_id, user_id, event_type, metadata)
  values (
    p_call_id,
    v_host_id,
    'group_call_participant_invited',
    jsonb_build_object('invited_user_id', p_user_id)
  );

  return true;
end;
$$;

revoke all on function public.invite_group_call_participant(uuid, uuid) from public, anon;
grant execute on function public.invite_group_call_participant(uuid, uuid) to authenticated;


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
begin
  if new.status <> 'ringing' then
    return new;
  end if;

  select c.*
    into call_row
    from public.calls c
   where c.id = new.call_id
     and c.metadata ->> 'group_call' = 'true';

  if not found or new.user_id = call_row.caller_id then
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
  ), p.avatar_url
    into caller_name, caller_avatar
    from public.profiles p
   where p.id = call_row.caller_id;

  select coalesce(nullif(c.title, ''), 'Group call')
    into group_title
    from public.conversations c
   where c.id = call_row.conversation_id;

  target_url :=
    '/messages/' || call_row.conversation_id::text
    || '?call=' || call_row.id::text;

  payload := jsonb_build_object(
    'userId', new.user_id,
    'title',
      case when call_row.media = 'video'
        then 'Incoming group video call'
        else 'Incoming group call'
      end,
    'body', caller_name || ' invited you to ' || group_title,
    'url', target_url,
    'tag', 'group-call:' || call_row.id::text,
    'type', 'call',
    'callId', call_row.id::text,
    'conversationId', call_row.conversation_id::text,
    'senderId', call_row.caller_id::text,
    'senderName', caller_name,
    'icon', caller_avatar,
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
after insert or update of status on public.call_participants
for each row
when (new.status = 'ringing')
execute function public.notify_group_call_push();

notify pgrst, 'reload schema';
