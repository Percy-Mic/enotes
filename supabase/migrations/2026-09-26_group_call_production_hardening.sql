-- ============================================================
-- ENOTES GROUP CALL PRODUCTION HARDENING
--
-- One durable group-call session per host/conversation.
-- Explicit invite-only start. No automatic join/rejoin.
-- Safe against stale sessions, duplicate RPC overloads, and
-- missing Realtime/Postgres Changes authorization.
-- ============================================================

create extension if not exists pg_net;

alter table public.calls
  add column if not exists ringing_at timestamptz default timezone('utc', now()),
  add column if not exists connection_state text default 'new',
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
  camera_enabled boolean not null default true,
  screen_sharing boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (call_id, user_id)
);

alter table public.call_participants
  add column if not exists screen_sharing boolean not null default false,
  add column if not exists updated_at timestamptz not null default timezone('utc', now());

create table if not exists public.call_events (
  id uuid not null default gen_random_uuid(),
  call_id uuid not null references public.calls(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  event_type text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (id)
);

create index if not exists idx_calls_group_host_active
  on public.calls (caller_id, status, updated_at desc)
  where ((metadata ->> 'group_call') = 'true');

create index if not exists idx_calls_group_conversation_active
  on public.calls (conversation_id, status, updated_at desc)
  where ((metadata ->> 'group_call') = 'true');

create index if not exists idx_call_participants_user_status
  on public.call_participants (user_id, status, created_at desc);

create index if not exists idx_call_events_call_created
  on public.call_events (call_id, created_at desc);

-- Remove every old overload. PostgREST can return 400/PGRST203 when
-- overloaded functions expose ambiguous named arguments.
do $$
declare
  r record;
begin
  for r in
    select oid::regprocedure as identity
      from pg_proc
     where pronamespace = 'public'::regnamespace
       and proname in (
         'create_group_call',
         'get_pending_group_calls',
         'respond_group_call',
         'end_group_call',
         'get_my_active_group_call',
         'recover_stale_group_call',
         'touch_group_call'
       )
  loop
    execute 'drop function if exists ' || r.identity::text;
  end loop;
end;
$$;

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
  v_existing public.calls%rowtype;
begin
  if v_user_id is null then
    raise sqlstate 'PT401'
      using message = 'You must be signed in.';
  end if;

  if p_media not in ('audio', 'video') then
    raise sqlstate 'PT400'
      using message = 'Unsupported call media.';
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
    raise sqlstate 'PT403'
      using message = 'You are not a member of this group.';
  end if;

  -- Recover only genuinely abandoned host sessions.
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

  -- If the user clicks the call button twice or the page is restored,
  -- reuse the live session for the same conversation instead of returning
  -- a confusing 400. This is still explicit: the user pressed Video Call.
  select c.*
    into v_existing
    from public.calls c
   where c.caller_id = v_user_id
     and c.conversation_id = p_conversation_id
     and c.metadata ->> 'group_call' = 'true'
     and c.status in ('ringing', 'connecting', 'connected', 'reconnecting')
   order by c.started_at desc
   limit 1;

  if found then
    return v_existing.id;
  end if;

  -- A host can only be in one group call at a time.
  if exists (
    select 1
      from public.calls c
     where c.caller_id = v_user_id
       and c.metadata ->> 'group_call' = 'true'
       and c.status in ('ringing', 'connecting', 'connected', 'reconnecting')
  ) then
    raise sqlstate 'PT409'
      using message = 'You are already in another group call.';
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
    call_id, user_id, role, status, joined_at, muted, camera_enabled
  )
  values (
    v_call_id, v_user_id, 'caller', 'joined',
    timezone('utc', now()), false, p_media = 'video'
  );

  insert into public.call_participants (
    call_id, user_id, role, status, camera_enabled
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
    call_id, user_id, event_type, metadata
  )
  values (
    v_call_id, v_user_id, 'group_call_started',
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

  update public.calls c
     set status = 'missed',
         missed_at = timezone('utc', now()),
         ended_at = timezone('utc', now()),
         end_reason = 'no_answer',
         connection_state = 'closed',
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
          order by cm.joined_at nulls last
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
  join public.conversations conv on conv.id = c.conversation_id
  join public.profiles p on p.id = c.caller_id
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
    raise sqlstate 'PT401'
      using message = 'You must be signed in.';
  end if;

  if p_action not in ('join', 'decline', 'leave') then
    raise sqlstate 'PT400'
      using message = 'Unsupported group-call action.';
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
    raise sqlstate 'PT404'
      using message = 'Group call not found or you are not invited.';
  end if;

  if p_action = 'join' then
    if v_call.status in ('ended', 'missed', 'declined', 'busy', 'failed') then
      raise sqlstate 'PT409'
        using message = 'This group call is no longer active.';
    end if;

    update public.call_participants
       set status = 'joined',
           joined_at = coalesce(joined_at, timezone('utc', now())),
           updated_at = timezone('utc', now())
     where call_id = p_call_id
       and user_id = v_user_id;

    select count(*) into v_joined_count
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
    raise sqlstate 'PT401'
      using message = 'You must be signed in.';
  end if;

  if not exists (
    select 1 from public.calls c
     where c.id = p_call_id
       and c.caller_id = v_user_id
       and c.metadata ->> 'group_call' = 'true'
  ) then
    raise sqlstate 'PT403'
      using message = 'Only the group-call host can end this call.';
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
     set status = 'left',
         left_at = coalesce(left_at, timezone('utc', now())),
         updated_at = timezone('utc', now())
   where call_id = p_call_id
     and status in ('invited', 'ringing', 'joined');

  insert into public.call_events (call_id, user_id, event_type)
  values (p_call_id, v_user_id, 'group_call_ended');

  return true;
end;
$$;

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
    return false;
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
    return false;
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

-- Participant rows are delivered to the invitee through Postgres Changes.
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

-- Realtime authorization for the group-call Broadcast topic.
create schema if not exists private;

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
           c.metadata ->> 'group_call' = 'true'
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

revoke all on function private.can_access_group_topic(text, uuid) from public;
revoke all on function private.can_access_call(uuid, uuid) from public;
revoke all on function private.can_access_call_topic(text, uuid) from public;

grant execute on function private.can_access_group_topic(text, uuid) to authenticated;
grant execute on function private.can_access_call(uuid, uuid) to authenticated;
grant execute on function private.can_access_call_topic(text, uuid) to authenticated;

-- Repair call table RLS without recursive policies.
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
      p.policyname, p.schemaname, p.tablename
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

create policy "enotes call participants own rows"
on public.call_participants
as permissive
for select to authenticated
using ((select auth.uid()) = user_id);

create policy "enotes call participants own insert"
on public.call_participants
as permissive
for insert to authenticated
with check (
  (select auth.uid()) = user_id
  and (select private.can_access_call(call_id))
);

create policy "enotes call participants own update"
on public.call_participants
as permissive
for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "enotes call participants own delete"
on public.call_participants
as permissive
for delete to authenticated
using ((select auth.uid()) = user_id);

create policy "enotes call events participants read"
on public.call_events
as permissive
for select to authenticated
using ((select private.can_access_call(call_id)));

create policy "enotes call events own insert"
on public.call_events
as permissive
for insert to authenticated
with check (
  (select auth.uid()) = user_id
  and (select private.can_access_call(call_id))
);

drop policy if exists "enotes call signaling read" on realtime.messages;
drop policy if exists "enotes call signaling send" on realtime.messages;
drop policy if exists "enotes group call signaling read" on realtime.messages;
drop policy if exists "enotes group call signaling send" on realtime.messages;

create policy "enotes group call signaling read"
on realtime.messages
as permissive
for select to authenticated
using (
  realtime.messages.extension = 'broadcast'
  and (
    (select private.can_access_group_topic(realtime.topic()))
    or
    (select private.can_access_call_topic(realtime.topic()))
  )
);

create policy "enotes group call signaling send"
on realtime.messages
as permissive
for insert to authenticated
with check (
  realtime.messages.extension = 'broadcast'
  and (
    (select private.can_access_group_topic(realtime.topic()))
    or
    (select private.can_access_call_topic(realtime.topic()))
  )
);

revoke execute on function public.create_group_call(uuid, text) from public, anon;
revoke execute on function public.get_pending_group_calls() from public, anon;
revoke execute on function public.respond_group_call(uuid, text) from public, anon;
revoke execute on function public.end_group_call(uuid) from public, anon;
revoke execute on function public.touch_group_call(uuid) from public, anon;
revoke execute on function public.recover_stale_group_call(uuid) from public, anon;

grant execute on function public.create_group_call(uuid, text) to authenticated;
grant execute on function public.get_pending_group_calls() to authenticated;
grant execute on function public.respond_group_call(uuid, text) to authenticated;
grant execute on function public.end_group_call(uuid) to authenticated;
grant execute on function public.touch_group_call(uuid) to authenticated;
grant execute on function public.recover_stale_group_call(uuid) to authenticated;

notify pgrst, 'reload schema';
