-- ============================================================
-- GROUP CALL RPC RECOVERY
--
-- Makes stale group-call cleanup available even when the earlier
-- persistent-group-call migration has already been applied.
-- ============================================================

create or replace function public.recover_stale_group_call(
  p_conversation_id uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_recovered boolean := false;
begin
  if v_user_id is null then
    raise exception 'You must be signed in.';
  end if;

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
     and updated_at < timezone('utc', now()) - interval '90 seconds'
     and (p_conversation_id is null or conversation_id = p_conversation_id);

  v_recovered := found;

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

  return v_recovered;
end;
$$;

revoke execute on function public.recover_stale_group_call(uuid) from public, anon;
grant execute on function public.recover_stale_group_call(uuid) to authenticated;

notify pgrst, 'reload schema';
