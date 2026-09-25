-- ============================================================
-- GROUP CALL STALE-SESSION RECOVERY
--
-- A browser can disappear without running React cleanup (tab close,
-- crash, mobile OS suspension). Do not permanently block a user from
-- starting another group call in that case.
--
-- Active clients heartbeat every 20 seconds. Sessions without a
-- heartbeat for 90 seconds are considered stale and are ended when
-- the host tries to create another call.
-- ============================================================

create or replace function public.touch_group_call(p_call_id uuid)
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

  update public.calls
     set updated_at = timezone('utc', now())
   where id = p_call_id
     and caller_id = v_user_id
     and metadata ->> 'group_call' = 'true'
     and status in ('ringing', 'connecting', 'connected', 'reconnecting');

  return found;
end;
$$;

-- Replace create_group_call with stale-session recovery before the
-- existing "already active" guard.
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

  -- Recover calls left behind by a crashed/closed browser. A healthy
  -- caller updates updated_at every 20 seconds, so 90 seconds is safely
  -- beyond the heartbeat interval.
  update public.calls
     set status = 'ended',
         ended_at = timezone('utc', now()),
         ended_by = v_user_id,
         end_reason = 'stale_session',
         connection_state = 'closed',
         updated_at = timezone('utc', now())
   where caller_id = v_user_id
     and metadata ->> 'group_call' = 'true'
     and status in ('ringing', 'connecting', 'connected', 'reconnecting')
     and updated_at < timezone('utc', now()) - interval '90 seconds';

  update public.call_participants cp
     set status = 'left',
         left_at = coalesce(cp.left_at, timezone('utc', now())),
         updated_at = timezone('utc', now())
    from public.calls c
   where cp.call_id = c.id
     and c.caller_id = v_user_id
     and c.metadata ->> 'group_call' = 'true'
     and c.status = 'ended'
     and c.end_reason = 'stale_session'
     and cp.status in ('invited', 'ringing', 'joined');

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
    metadata,
    updated_at
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
    ),
    timezone('utc', now())
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

revoke execute on function public.touch_group_call(uuid) from public, anon;
grant execute on function public.touch_group_call(uuid) to authenticated;

notify pgrst, 'reload schema';


