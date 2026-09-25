-- ENOTES — GROUP CALL AUTHORIZATION HARDENING
--
-- Keeps 1-to-1 call authorization intact while allowing members of a
-- group conversation to access the durable group-call session represented
-- by calls.caller_id/callee_id = host.

create schema if not exists private;

create or replace function private.can_access_call(
  p_call_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
      from public.calls c
     where c.id = p_call_id
       and (
         c.caller_id = p_user_id
         or c.callee_id = p_user_id
         or (
           coalesce(c.metadata ->> 'group_call', 'false') = 'true'
           and c.conversation_id is not null
           and exists (
             select 1
               from public.conversation_members cm
              where cm.conversation_id = c.conversation_id
                and cm.user_id = p_user_id
           )
         )
       )
  );
$$;

revoke all on function private.can_access_call(uuid, uuid) from public;
grant execute on function private.can_access_call(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
