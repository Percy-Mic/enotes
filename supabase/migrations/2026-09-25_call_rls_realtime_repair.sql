-- ============================================================
-- CALL RLS / REALTIME AUTHORIZATION REPAIR
--
-- Fixes two production errors:
--   1. infinite recursion detected in policy for call_participants
--   2. Unauthorized access to private group-call Realtime topics
--
-- The participant/event policies below intentionally avoid querying
-- call_participants from a call_participants policy. Permission checks
-- that need cross-table access are isolated in SECURITY DEFINER helpers.
-- ============================================================

create schema if not exists private;

-- These helpers run as the database owner so their membership checks do
-- not recursively invoke the RLS policies being evaluated.
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
       )
  );
$$;

create or replace function private.can_access_group_topic(
  p_topic text,
  p_user_id uuid default auth.uid()
)
returns boolean
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  v_conversation_id uuid;
begin
  if p_user_id is null
     or p_topic is null
     or p_topic !~ '^group-call-[0-9a-fA-F-]{36}$' then
    return false;
  end if;

  v_conversation_id :=
    substring(p_topic from '^group-call-([0-9a-fA-F-]{36})$')::uuid;

  return exists (
    select 1
      from public.conversation_members cm
     where cm.conversation_id = v_conversation_id
       and cm.user_id = p_user_id
  );
end;
$$;

create or replace function private.can_access_call_topic(
  p_topic text,
  p_user_id uuid default auth.uid()
)
returns boolean
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  v_call_id uuid;
begin
  if p_user_id is null
     or p_topic is null
     or p_topic !~ '^call:[0-9a-fA-F-]{36}$' then
    return false;
  end if;

  v_call_id :=
    substring(p_topic from '^call:([0-9a-fA-F-]{36})$')::uuid;

  return private.can_access_call(v_call_id, p_user_id);
end;
$$;

revoke all on function private.can_access_call(uuid, uuid) from public;
revoke all on function private.can_access_group_topic(text, uuid) from public;
revoke all on function private.can_access_call_topic(text, uuid) from public;

grant execute on function private.can_access_call(uuid, uuid) to authenticated;
grant execute on function private.can_access_group_topic(text, uuid) to authenticated;
grant execute on function private.can_access_call_topic(text, uuid) to authenticated;

-- Remove any conflicting participant/event policies. This is deliberately
-- scoped only to these two call tables.
do $$
declare
  p record;
begin
  for p in
    select schemaname, tablename, policyname
      from pg_policies
     where schemaname = 'public'
       and tablename in ('call_participants', 'call_events')
  loop
    execute format(
      'drop policy if exists %I on %I.%I',
      p.policyname,
      p.schemaname,
      p.tablename
    );
  end loop;
end;
$$;

alter table public.call_participants enable row level security;
alter table public.call_events enable row level security;

revoke all on table public.call_participants from anon;
revoke all on table public.call_events from anon;

grant select, insert, update, delete on table public.call_participants to authenticated;
grant select, insert on table public.call_events to authenticated;

-- A user may read/update/delete only their own participant row.
-- INSERT additionally requires that the call belongs to the user.
-- This policy never queries call_participants itself, so it cannot recurse.
create policy "call participants own rows"
on public.call_participants
as permissive
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "call participants own insert"
on public.call_participants
as permissive
for insert
to authenticated
with check (
  (select auth.uid()) = user_id
  and (select private.can_access_call(call_id))
);

create policy "call participants own update"
on public.call_participants
as permissive
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "call participants own delete"
on public.call_participants
as permissive
for delete
to authenticated
using ((select auth.uid()) = user_id);

-- Events are readable to users participating in the corresponding call.
-- Users may only insert events as themselves.
create policy "call events participants read"
on public.call_events
as permissive
for select
to authenticated
using ((select private.can_access_call(call_id)));

create policy "call events own insert"
on public.call_events
as permissive
for insert
to authenticated
with check (
  (select auth.uid()) = user_id
  and (select private.can_access_call(call_id))
);

-- Rebuild the private Realtime authorization used by WebRTC signaling.
-- Supabase checks realtime.messages RLS when a private channel is joined;
-- both SELECT and INSERT permissions are required for Broadcast.
drop policy if exists "enotes call signaling read" on realtime.messages;
drop policy if exists "enotes call signaling send" on realtime.messages;
drop policy if exists "enotes group call signaling read" on realtime.messages;
drop policy if exists "enotes group call signaling send" on realtime.messages;

create policy "enotes call signaling read"
on realtime.messages
as permissive
for select
to authenticated
using (
  realtime.messages.extension = 'broadcast'
  and (
    (select private.can_access_group_topic(realtime.topic()))
    or
    (select private.can_access_call_topic(realtime.topic()))
  )
);

create policy "enotes call signaling send"
on realtime.messages
as permissive
for insert
to authenticated
with check (
  realtime.messages.extension = 'broadcast'
  and (
    (select private.can_access_group_topic(realtime.topic()))
    or
    (select private.can_access_call_topic(realtime.topic()))
  )
);

notify pgrst, 'reload schema';
