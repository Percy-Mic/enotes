-- ============================================================
-- PERSISTENT GROUP CALLS
--
-- Reuses the existing calls/call_participants/call_events tables.
-- The calls row is the durable group-call session; participants are
-- the invitation/recovery state. WebRTC SDP/ICE remains Broadcast-only.
-- ============================================================

create extension if not exists pg_net;

-- Group calls use calls.callee_id as the host for compatibility with
-- the existing 1:1 calls schema. metadata.group_call distinguishes them.
create or replace function public.create_group_call(
  p_conversation_id uuid,
  p_media text default 'video'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_call_id uuid;
begin
  if v_user_id is null then
    raise exception 'You must be signed in.';
  end if;

  if p_media not in ('audio', 'video') then
    raise exception 'Unsupported call media.';
  end if;

  if not exists (
    select 1
      from public.conversations c
      join public.conversation_members cm
        on cm.conversation_id = c.id
       and cm.user_id = v_user_id
     where c.id = p_conversation_id
       and c.is_group = true
  ) then
    raise exception 'You are not a member of this group.';
  end if;

  if exists (
    select 1
      from public.calls c
     where c.caller_id = v_user_id
       and c.metadata ->> 'group_call' = 'true'
       and c.status in ('ringing', 'connecting', 'connected', 'reconnecting')
  ) then
    raise exception 'You already have an active group call.';
  end if;

  insert into public.calls (
    conversation_id,
    caller_id,
    callee_id,
    media,
    status,
    ringing_at,
    connection_state,
    metadata
  )
  values (
    p_conversation_id,
    v_user_id,
    v_user_id,
    p_media,
    'ringing',
    timezone('utc', now()),
    'new',
    jsonb_build_object(
      'group_call', true,
      'conversation_id', p_conversation_id,
      'media', p_media
    )
  )
  returning id into v_call_id;

  insert into public.call_participants (
    call_id,
    user_id,
    role,
    status,
    joined_at,
    muted,
    camera_enabled
  )
  values (
    v_call_id,
    v_user_id,
    'caller',
    'joined',
    timezone('utc', now()),
    false,
    p_media = 'video'
  );

  insert into public.call_participants (
    call_id,
    user_id,
    role,
    status,
    camera_enabled
  )
  select
    v_call_id,
    cm.user_id,
    'participant',
    'ringing',
    p_media = 'video'
  from public.conversation_members cm
  where cm.conversation_id = p_conversation_id
    and cm.user_id <> v_user_id;

  insert into public.call_events (
    call_id,
    user_id,
    event_type,
    metadata
  )
  values (
    v_call_id,
    v_user_id,
    'group_call_started',
    jsonb_build_object('media', p_media)
  );

  return v_call_id;
end;
$$;

create or replace function public.get_pending_group_calls()
returns table (
  call_id uuid,
  conversation_id uuid,
  caller_id uuid,
  media text,
  started_at timestamptz,
  group_title text,
  caller_name text,
  caller_avatar text,
  members jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    return;
  end if;

  -- Expire old unanswered group invitations before returning them.
  update public.calls c
     set status = 'missed',
         missed_at = timezone('utc', now()),
         ended_at = timezone('utc', now()),
         end_reason = 'no_answer',
         updated_at = timezone('utc', now())
   where c.metadata ->> 'group_call' = 'true'
     and c.status in ('ringing', 'connecting')
     and c.started_at < timezone('utc', now()) - interval '60 seconds';

  update public.call_participants cp
     set status = 'failed',
         left_at = coalesce(cp.left_at, timezone('utc', now())),
         updated_at = timezone('utc', now())
   from public.calls c
   where cp.call_id = c.id
     and cp.user_id = v_user_id
     and cp.status in ('invited', 'ringing')
     and c.metadata ->> 'group_call' = 'true'
     and c.status = 'missed';

  return query
  select
    c.id,
    c.conversation_id,
    c.caller_id,
    c.media,
    c.started_at,
    coalesce(nullif(conv.title, ''), 'Group video call'),
    coalesce(nullif(p.full_text_name, ''), nullif(p.username, ''), 'Someone'),
    p.avatar_url,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'user_id', cm.user_id,
            'full_text_name', mp.full_text_name,
            'username', mp.username,
            'avatar_url', mp.avatar_url
          )
          order by cm.joined_at nulls last, cm.created_at
        )
        from public.conversation_members cm
        join public.profiles mp on mp.id = cm.user_id
        where cm.conversation_id = c.conversation_id
      ),
      '[]'::jsonb
    )
  from public.calls c
  join public.call_participants cp
    on cp.call_id = c.id
   and cp.user_id = v_user_id
  join public.conversations conv
    on conv.id = c.conversation_id
  join public.profiles p
    on p.id = c.caller_id
  where c.metadata ->> 'group_call' = 'true'
    and c.status in ('ringing', 'connecting', 'connected', 'reconnecting')
    and cp.status in ('invited', 'ringing')
  order by c.started_at desc
  limit 5;
end;
$$;

create or replace function public.respond_group_call(
  p_call_id uuid,
  p_action text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_call public.calls%rowtype;
  v_joined_count integer;
begin
  if v_user_id is null then
    raise exception 'You must be signed in.';
  end if;

  if p_action not in ('join', 'decline', 'leave') then
    raise exception 'Unsupported group-call action.';
  end if;

  select c.*
    into v_call
    from public.calls c
    join public.call_participants cp on cp.call_id = c.id
   where c.id = p_call_id
     and c.metadata ->> 'group_call' = 'true'
     and cp.user_id = v_user_id
   for update of c;

  if not found then
    raise exception 'Group call not found or you are not invited.';
  end if;

  if p_action = 'join' then
    if v_call.status in ('ended', 'missed', 'declined', 'busy', 'failed') then
      raise exception 'This group call is no longer active.';
    end if;

    update public.call_participants
       set status = 'joined',
           joined_at = coalesce(joined_at, timezone('utc', now())),
           updated_at = timezone('utc', now())
     where call_id = p_call_id
       and user_id = v_user_id;

    select count(*)
      into v_joined_count
      from public.call_participants
     where call_id = p_call_id
       and status = 'joined';

    update public.calls
       set status = case when v_joined_count >= 2 then 'connected' else 'connecting' end,
           connected_at = case
             when v_joined_count >= 2 then coalesce(connected_at, timezone('utc', now()))
             else connected_at
           end,
           connection_state = case when v_joined_count >= 2 then 'connected' else 'connecting' end,
           updated_at = timezone('utc', now())
     where id = p_call_id
       and status not in ('ended', 'missed', 'declined', 'busy', 'failed');

    insert into public.call_events (call_id, user_id, event_type)
    values (p_call_id, v_user_id, 'group_call_joined');

    return true;
  end if;

  if p_action = 'decline' then
    update public.call_participants
       set status = 'declined',
           left_at = timezone('utc', now()),
           updated_at = timezone('utc', now())
     where call_id = p_call_id
       and user_id = v_user_id;

    insert into public.call_events (call_id, user_id, event_type)
    values (p_call_id, v_user_id, 'group_call_declined');

    return true;
  end if;

  update public.call_participants
     set status = 'left',
         left_at = timezone('utc', now()),
         updated_at = timezone('utc', now())
   where call_id = p_call_id
     and user_id = v_user_id;

  insert into public.call_events (call_id, user_id, event_type)
  values (p_call_id, v_user_id, 'group_call_left');

  return true;
end;
$$;

create or replace function public.end_group_call(p_call_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'You must be signed in.';
  end if;

  if not exists (
    select 1
      from public.calls c
     where c.id = p_call_id
       and c.caller_id = v_user_id
       and c.metadata ->> 'group_call' = 'true'
  ) then
    raise exception 'Only the group-call host can end this call.';
  end if;

  update public.calls
     set status = 'ended',
         ended_at = timezone('utc', now()),
         ended_by = v_user_id,
         end_reason = 'host_ended',
         connection_state = 'closed',
         updated_at = timezone('utc', now())
   where id = p_call_id
     and status not in ('ended', 'missed', 'declined', 'busy', 'failed');

  update public.call_participants
     set status = case when user_id = v_user_id then 'left' else 'left' end,
         left_at = coalesce(left_at, timezone('utc', now())),
         updated_at = timezone('utc', now())
   where call_id = p_call_id
     and status in ('invited', 'ringing', 'joined');

  insert into public.call_events (call_id, user_id, event_type)
  values (p_call_id, v_user_id, 'group_call_ended');

  return true;
end;
$$;

revoke execute on function public.create_group_call(uuid, text) from public, anon;
revoke execute on function public.get_pending_group_calls() from public, anon;
revoke execute on function public.respond_group_call(uuid, text) from public, anon;
revoke execute on function public.end_group_call(uuid) from public, anon;

grant execute on function public.create_group_call(uuid, text) to authenticated;
grant execute on function public.get_pending_group_calls() to authenticated;
grant execute on function public.respond_group_call(uuid, text) to authenticated;
grant execute on function public.end_group_call(uuid) to authenticated;

-- Existing 1:1 call trigger must ignore durable group sessions; group
-- invitations are sent from the participant trigger below after the
-- participant rows exist.
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

create or replace function public.notify_group_call_push()
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

  if endpoint is null or endpoint = '' or secret is null or secret = '' then
    return new;
  end if;

  select coalesce(nullif(p.full_text_name, ''), nullif(p.username, ''), 'Someone')
    into caller_name
    from public.profiles p
   where p.id = call_row.caller_id;

  select coalesce(nullif(c.title, ''), 'Group video call')
    into group_title
    from public.conversations c
   where c.id = call_row.conversation_id;

  target_url :=
    '/messages/' || call_row.conversation_id::text ||
    '?call=' || call_row.id::text;

  payload := jsonb_build_object(
    'userId', new.user_id,
    'title', case when call_row.media = 'video' then 'Incoming group video call' else 'Incoming group call' end,
    'body', caller_name || ' invited you to ' || group_title,
    'url', target_url,
    'tag', 'group-call:' || call_row.id::text,
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

drop trigger if exists trg_notify_group_call_push on public.call_participants;

create trigger trg_notify_group_call_push
  after insert on public.call_participants
  for each row
  execute function public.notify_group_call_push();

do $$
begin
  if not exists (
    select 1
      from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'call_participants'
  ) then
    alter publication supabase_realtime add table public.call_participants;
  end if;
end;
$$;

create index if not exists idx_calls_group_active
  on public.calls (status, started_at desc)
  where ((metadata ->> 'group_call') = 'true');

create index if not exists idx_call_participants_user_status
  on public.call_participants (user_id, status, created_at desc);
