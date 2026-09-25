-- ============================================================
-- GROUP CALL RPC REPAIR / RECOVERY
--
-- This migration is intentionally self-contained. It repairs databases
-- where the persistent group-call migration created create_group_call()
-- but the later recovery RPCs were not applied.
-- ============================================================

alter table public.calls
  add column if not exists ringing_at timestamptz,
  add column if not exists connection_state text,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists missed_at timestamptz,
  add column if not exists end_reason text,
  add column if not exists ended_by uuid,
  add column if not exists updated_at timestamptz not null default timezone('utc', now());

create table if not exists public.call_participants (
  call_id uuid not null references public.calls(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'participant',
  status text not null default 'invited',
  joined_at timestamptz,
  left_at timestamptz,
  muted boolean not null default false,
  camera_enabled boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (call_id, user_id)
);

create index if not exists idx_call_participants_user_status
  on public.call_participants (user_id, status, created_at desc);

-- Host heartbeat. The browser calls this periodically while a group call
-- is active so stale-session recovery does not terminate a healthy call.
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

-- Restore an active group call for a member already marked joined.
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

-- Restore active sessions globally. Only participants already marked joined
-- are returned; unanswered invitations remain handled by get_pending_group_calls.
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

-- End an abandoned host-owned group call when it has not received a
-- heartbeat for 90 seconds. A healthy host heartbeats every 20 seconds.
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

revoke execute on function public.touch_group_call(uuid) from public, anon;
revoke execute on function public.get_my_active_group_call(uuid) from public, anon;
revoke execute on function public.get_my_active_group_calls() from public, anon;
revoke execute on function public.recover_stale_group_call(uuid) from public, anon;

grant execute on function public.touch_group_call(uuid) to authenticated;
grant execute on function public.get_my_active_group_call(uuid) to authenticated;
grant execute on function public.get_my_active_group_calls() to authenticated;
grant execute on function public.recover_stale_group_call(uuid) to authenticated;

notify pgrst, 'reload schema';
