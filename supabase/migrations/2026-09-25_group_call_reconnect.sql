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
  where c.caller_id = v_user_id
    and c.conversation_id = p_conversation_id
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
   and cp.status in ('invited', 'ringing', 'joined')
  where c.metadata ->> 'group_call' = 'true'
    and c.status in ('ringing', 'connecting', 'connected', 'reconnecting')
  order by c.started_at desc;
end;
$$;

revoke execute on function public.get_my_active_group_calls() from public, anon;
grant execute on function public.get_my_active_group_calls() to authenticated;

notify pgrst, 'reload schema';
