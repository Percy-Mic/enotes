-- Allow the host to re-invite a group member into the existing active call.
-- This does NOT create another calls row.
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

revoke all on function public.invite_group_call_participant(uuid, uuid) from public;
grant execute on function public.invite_group_call_participant(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
