-- ============================================================================
-- 2026-09-30 — Group ownership continuity
--
-- PROBLEM: When a group creator left ("Leave group" deletes their
-- conversation_members row), the group was stranded:
--   • is_conversation_admin() returns false for everyone remaining, so the
--     RLS insert policy on conversation_members blocks every invite ("Only
--     the group creator or admins can add members"), and the role-change
--     guard blocks promoting anyone — nobody can ever become an admin.
--   • conversations.created_by keeps pointing at a non-member forever.
--   • Groups orphaned BEFORE this migration stay broken (the trigger below
--     only fires on future departures).
--
-- FIX (four pieces, idempotent / safe to re-run):
--   1. claim_group_ownership(p_conversation) — when the creator has left,
--      ANY remaining member may claim ownership (that is the only way the
--      group can un-strand). System message records it.
--   2. make_group_owner(p_conversation, p_user) — a current creator or admin
--      hands ownership to an existing member (deliberate "hire admins" /
--      succession). Demotes the previous owner so there is exactly one.
--   3. Trigger on conversation_members DELETE: if the departing member is
--      the group creator, ownership passes to the most senior remaining
--      member (admins first, then earliest joined_at) with a system
--      message — the group never strands in the first place.
--   4. One-time backfill (DO block) healing every already-orphaned group.
--
-- DESIGN: SECURITY DEFINER + empty search_path (no injection surface);
-- explicit grants (definer funcs are not executable by default);
-- the empty-group delete inside the trigger is wrapped so a missing
-- messages→conversations cascade can never fail the user's leave.
-- ============================================================================

begin;

/* ---------------------------------------------------------------------------
   1) claim_group_ownership — self-heal for stranded groups
   ------------------------------------------------------------------------- */
create or replace function public.claim_group_ownership(p_conversation uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me              uuid := auth.uid();
  v_conv            public.conversations;
  v_creator_present boolean;
  v_old_owner_name  text;
  v_actor_name      text;
begin
  if v_me is null then
    raise exception 'Not signed in';
  end if;

  select * into v_conv from public.conversations where id = p_conversation;
  if not found then
    raise exception 'Conversation not found';
  end if;
  if not v_conv.is_group then
    raise exception 'Only group chats have owners';
  end if;

  -- Must be a current member (RLS would hide the row anyway; be explicit).
  if not exists (
    select 1 from public.conversation_members
     where conversation_id = p_conversation and user_id = v_me
  ) then
    raise exception 'You are not a member of this group';
  end if;

  -- Claiming only applies to groups whose creator has left. If the creator
  -- is still around, ownership hand-off goes through make_group_owner.
  select exists (
    select 1 from public.conversation_members
     where conversation_id = p_conversation
       and user_id = v_conv.created_by
  ) into v_creator_present;

  if v_creator_present then
    if v_me = v_conv.created_by then
      raise exception 'You already own this group';
    end if;
    raise exception 'This group already has an owner';
  end if;

  update public.conversation_members
     set role = 'admin'
   where conversation_id = p_conversation and user_id = v_me;

  update public.conversations
     set created_by = v_me
   where id = p_conversation;

  select coalesce(nullif(full_text_name, ''), username, 'Someone')
    into v_old_owner_name from public.profiles where id = v_conv.created_by;
  select coalesce(nullif(full_text_name, ''), username, 'Someone')
    into v_actor_name from public.profiles where id = v_me;

  insert into public.messages (conversation_id, sender_id, content, message_type)
  values (
    p_conversation,
    v_me,
    format('%s claimed group ownership — %s had left the group.', v_actor_name, v_old_owner_name),
    'system'
  );

  return v_me;
end;
$$;

revoke all on function public.claim_group_ownership(uuid) from public;
revoke all on function public.claim_group_ownership(uuid) from anon;
grant execute on function public.claim_group_ownership(uuid) to authenticated;

/* ---------------------------------------------------------------------------
   2) make_group_owner — deliberate hand-off to an existing member
   ------------------------------------------------------------------------- */
create or replace function public.make_group_owner(p_conversation uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me         uuid := auth.uid();
  v_creator    uuid;
  v_is_group   boolean;
  v_old_role   text;
  v_actor_name text;
  v_user_name  text;
begin
  if v_me is null then
    raise exception 'Not signed in';
  end if;

  select created_by, is_group into v_creator, v_is_group
    from public.conversations where id = p_conversation;
  if not found then
    raise exception 'Conversation not found';
  end if;
  if not v_is_group then
    raise exception 'Only group chats have owners';
  end if;

  -- Authorization: the current creator (by conversation row, even if their
  -- membership was removed) or any current admin/moderator.
  if v_me <> v_creator then
    if not exists (
      select 1 from public.conversation_members
       where conversation_id = p_conversation
         and user_id = v_me
         and role in ('admin', 'moderator')
    ) then
      raise exception 'Only the group creator or admins can change ownership';
    end if;
  end if;

  -- Target must already be a member (this RPC edits roles; it never invites).
  select role into v_old_role
    from public.conversation_members
   where conversation_id = p_conversation and user_id = p_user;
  if not found then
    raise exception 'That person is not a member of this group';
  end if;

  if p_user = v_creator then
    raise exception 'That person is already the owner';
  end if;

  update public.conversation_members
     set role = 'admin'
   where conversation_id = p_conversation and user_id = p_user;

  update public.conversations
     set created_by = p_user
   where id = p_conversation;

  -- Demote the previous owner's member row (if any) so exactly one owner.
  update public.conversation_members
     set role = 'member'
   where conversation_id = p_conversation
     and user_id = v_creator;

  select coalesce(nullif(full_text_name, ''), username, 'Someone')
    into v_actor_name from public.profiles where id = v_me;
  select coalesce(nullif(full_text_name, ''), username, 'Someone')
    into v_user_name from public.profiles where id = p_user;

  insert into public.messages (conversation_id, sender_id, content, message_type)
  values (
    p_conversation,
    v_me,
    format('%s made %s the owner of the group.', v_actor_name, v_user_name),
    'system'
  );
end;
$$;

revoke all on function public.make_group_owner(uuid, uuid) from public;
revoke all on function public.make_group_owner(uuid, uuid) from anon;
grant execute on function public.make_group_owner(uuid, uuid) to authenticated;

/* ---------------------------------------------------------------------------
   3) Trigger: reassign ownership when the creator leaves
   ------------------------------------------------------------------------- */
create or replace function public.handle_creator_departure()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conv      public.conversations;
  v_next      uuid;
  v_next_name text;
  v_left_name text;
begin
  select * into v_conv from public.conversations where id = old.conversation_id;
  if not found or not v_conv.is_group then
    return old;
  end if;
  if old.user_id <> v_conv.created_by then
    return old;  -- a non-owner left — nothing to do
  end if;

  -- Most senior remaining member: admins/moderators first, then join order.
  select m.user_id into v_next
    from public.conversation_members m
   where m.conversation_id = old.conversation_id
   order by case when m.role in ('admin', 'moderator') then 0 else 1 end,
            m.joined_at asc,
            m.user_id asc
   limit 1;

  if v_next is null then
    -- Nobody is left. Try to remove the empty conversation shell; if the
    -- schema lacks a cascade from messages, keep the shell rather than
    -- failing the user's leave.
    begin
      delete from public.conversations where id = old.conversation_id;
    exception when foreign_key_violation then
      null;
    end;
    return old;
  end if;

  update public.conversation_members
     set role = 'admin'
   where conversation_id = old.conversation_id and user_id = v_next;

  update public.conversations
     set created_by = v_next
   where id = old.conversation_id;

  select coalesce(nullif(full_text_name, ''), username, 'Someone')
    into v_next_name from public.profiles where id = v_next;
  select coalesce(nullif(full_text_name, ''), username, 'Someone')
    into v_left_name from public.profiles where id = old.user_id;

  insert into public.messages (conversation_id, sender_id, content, message_type)
  values (
    old.conversation_id,
    v_next,
    format('%s left — %s is now the group owner.', v_left_name, v_next_name),
    'system'
  );

  return old;
end;
$$;

drop trigger if exists trg_creator_departure on public.conversation_members;
create trigger trg_creator_departure
  after delete on public.conversation_members
  for each row execute function public.handle_creator_departure();

/* ---------------------------------------------------------------------------
   4) One-time backfill: heal every ALREADY-orphaned group
      (creator no longer has a member row). Re-running is a no-op because
      healed groups no longer match the orphan predicate.
   ------------------------------------------------------------------------- */
do $$
declare
  r           record;
  v_next      uuid;
  v_next_name text;
begin
  for r in
    select c.id, c.created_by
      from public.conversations c
     where c.is_group
       and not exists (
         select 1 from public.conversation_members m
          where m.conversation_id = c.id and m.user_id = c.created_by
       )
  loop
    select m.user_id into v_next
      from public.conversation_members m
     where m.conversation_id = r.id
     order by case when m.role in ('admin', 'moderator') then 0 else 1 end,
              m.joined_at asc,
              m.user_id asc
     limit 1;

    if v_next is not null then
      update public.conversation_members
         set role = 'admin'
       where conversation_id = r.id and user_id = v_next;

      update public.conversations
         set created_by = v_next
       where id = r.id;

      select coalesce(nullif(full_text_name, ''), username, 'Someone')
        into v_next_name from public.profiles where id = v_next;

      insert into public.messages (conversation_id, sender_id, content, message_type)
      values (
        r.id,
        v_next,
        format('%s is now the group owner — the previous owner had left.', v_next_name),
        'system'
      );
    end if;
  end loop;
end $$;

commit;
