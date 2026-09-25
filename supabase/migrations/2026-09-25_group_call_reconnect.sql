-- ============================================================
-- GROUP CALL RECONNECT
--
-- If the host refreshes/navigates and the durable call row is still
-- active, let the UI reconnect to that existing call instead of
-- attempting to create a second call.
-- ============================================================

create or replace function public.get_my_active_group_call(
  p_conversation_id uuid
)
returns table (
  call_id uuid,
  conversation_id uuid,
  host_id uuid,
  media text,
  status text
)
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

  return query
  select
    c.id,
    c.conversation_id,
    c.caller_id,
    c.media,
    c.status
  from public.calls c
  join public.call_participants cp
    on cp.call_id = c.id
   and cp.user_id = v_user_id
   and cp.status in ('invited', 'ringing', 'joined')
  where c.conversation_id = p_conversation_id
    and c.metadata ->> 'group_call' = 'true'
    and c.status in ('ringing', 'connecting', 'connected', 'reconnecting')
  order by c.started_at desc
  limit 1;
end;
$$;

revoke execute on function public.get_my_active_group_call(uuid) from public, anon;
grant execute on function public.get_my_active_group_call(uuid) to authenticated;


create or replace function public.get_my_active_group_calls()
returns table (
  call_id uuid,
  conversation_id uuid,
  host_id uuid,
  media text,
  status text,
  role text
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

  return query
  select
    c.id,
    c.conversation_id,
    c.caller_id,
    c.media,
    c.status,
    cp.role
  from public.calls c
  join public.call_participants cp
    on cp.call_id = c.id
   and cp.user_id = v_user_id
   and cp.status = 'joined'
  where c.metadata ->> 'group_call' = 'true'
    and c.status in ('ringing', 'connecting', 'connected', 'reconnecting')
  order by c.started_at desc;
end;
$$;

revoke execute on function public.get_my_active_group_calls() from public, anon;
grant execute on function public.get_my_active_group_calls() to authenticated;

-- ============================================================
-- PRIVATE WEBRTC SIGNALING CHANNELS
--
-- SDP/ICE signaling is ephemeral and must only be available to users who
-- are participants in the corresponding DM or group conversation.
-- ============================================================

drop policy if exists "enotes call signaling read" on realtime.messages;
drop policy if exists "enotes call signaling send" on realtime.messages;

create policy "enotes call signaling read"
on realtime.messages
for select
to authenticated
using (
  realtime.messages.extension = 'broadcast'
  and (
    (
      realtime.topic() like 'group-call-%'
      and exists (
        select 1
        from public.conversation_members cm
        where cm.user_id = (select auth.uid())
          and cm.conversation_id::text = substring(realtime.topic() from 12)
      )
    )
    or
    (
      realtime.topic() like 'call:%'
      and exists (
        select 1
        from public.calls c
        where c.id::text = substring(realtime.topic() from 6)
          and (c.caller_id = (select auth.uid()) or c.callee_id = (select auth.uid()))
      )
    )
  )
);

create policy "enotes call signaling send"
on realtime.messages
for insert
to authenticated
with check (
  realtime.messages.extension = 'broadcast'
  and (
    (
      realtime.topic() like 'group-call-%'
      and exists (
        select 1
        from public.conversation_members cm
        where cm.user_id = (select auth.uid())
          and cm.conversation_id::text = substring(realtime.topic() from 12)
      )
    )
    or
    (
      realtime.topic() like 'call:%'
      and exists (
        select 1
        from public.calls c
        where c.id::text = substring(realtime.topic() from 6)
          and (c.caller_id = (select auth.uid()) or c.callee_id = (select auth.uid()))
      )
    )
  )
);

notify pgrst, 'reload schema';
