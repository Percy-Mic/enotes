/* ============================================================================
   2026-10-04 — Live RPC repair
   Re-publishes RPCs that the production UI calls but that may be missing from
   the live Supabase database/schema cache when older migrations were not run.
   Safe to run repeatedly.
   ========================================================================== */

begin;

/* Admin moderation --------------------------------------------------------- */

create or replace function public.is_current_user_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select p.is_admin from public.profiles p where p.id = auth.uid()),
    false
  );
$$;

create or replace function public.admin_approve_template(
  p_template_id uuid,
  p_note text default null
)
returns setof public.templates
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_current_user_admin() then
    raise exception 'Admins only';
  end if;

  update public.templates
     set status = 'published',
         published_at = now(),
         reviewed_at = now(),
         reviewed_by = auth.uid(),
         review_note = null,
         rejection_reason = null
   where id = p_template_id;

  insert into public.template_reviews
    (template_id, reviewer_id, action, note, previous_status, new_status)
  select t.id, auth.uid(), 'approved', p_note, t.status, 'published'
    from public.templates t
   where t.id = p_template_id;

  return query
    select * from public.templates where id = p_template_id;
end;
$$;

create or replace function public.admin_reject_template(
  p_template_id uuid,
  p_note text default null
)
returns setof public.templates
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_current_user_admin() then
    raise exception 'Admins only';
  end if;

  if coalesce(btrim(p_note), '') = '' then
    raise exception 'A rejection note is required';
  end if;

  update public.templates
     set status = 'rejected',
         reviewed_at = now(),
         reviewed_by = auth.uid(),
         rejection_reason = left(btrim(p_note), 500)
   where id = p_template_id;

  insert into public.template_reviews
    (template_id, reviewer_id, action, note, previous_status, new_status)
  select t.id, auth.uid(), 'rejected', p_note, t.status, 'rejected'
    from public.templates t
   where t.id = p_template_id;

  return query
    select * from public.templates where id = p_template_id;
end;
$$;

create or replace function public.admin_archive_template(
  p_template_id uuid,
  p_note text default null
)
returns setof public.templates
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_current_user_admin() then
    raise exception 'Admins only';
  end if;

  update public.templates
     set status = 'archived',
         reviewed_at = now(),
         reviewed_by = auth.uid(),
         review_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_template_id;

  insert into public.template_reviews
    (template_id, reviewer_id, action, note, previous_status, new_status)
  select t.id, auth.uid(), 'archived', p_note, t.status, 'archived'
    from public.templates t
   where t.id = p_template_id;

  return query
    select * from public.templates where id = p_template_id;
end;
$$;

grant execute on function public.admin_approve_template(uuid, text) to authenticated;
grant execute on function public.admin_reject_template(uuid, text) to authenticated;
grant execute on function public.admin_archive_template(uuid, text) to authenticated;


/* Group ownership --------------------------------------------------------- */

create or replace function public.claim_group_ownership(p_conversation uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_conv public.conversations;
begin
  if v_me is null then
    raise exception 'Not signed in';
  end if;

  select * into v_conv
    from public.conversations
   where id = p_conversation;

  if not found then
    raise exception 'Conversation not found';
  end if;

  if not v_conv.is_group then
    raise exception 'Only group chats have owners';
  end if;

  if not exists (
    select 1 from public.conversation_members
     where conversation_id = p_conversation
       and user_id = v_me
  ) then
    raise exception 'You are not a member of this group';
  end if;

  if exists (
    select 1 from public.conversation_members
     where conversation_id = p_conversation
       and user_id = v_conv.created_by
  ) then
    if v_me = v_conv.created_by then
      raise exception 'You already own this group';
    end if;
    raise exception 'This group already has an owner';
  end if;

  update public.conversation_members
     set role = 'admin'
   where conversation_id = p_conversation
     and user_id = v_me;

  update public.conversations
     set created_by = v_me
   where id = p_conversation;

  return v_me;
end;
$$;

create or replace function public.make_group_owner(
  p_conversation uuid,
  p_user uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_creator uuid;
  v_is_group boolean;
begin
  if v_me is null then
    raise exception 'Not signed in';
  end if;

  select created_by, is_group
    into v_creator, v_is_group
    from public.conversations
   where id = p_conversation;

  if not found then
    raise exception 'Conversation not found';
  end if;

  if not v_is_group then
    raise exception 'Only group chats have owners';
  end if;

  if v_me <> v_creator
     and not exists (
       select 1
         from public.conversation_members
        where conversation_id = p_conversation
          and user_id = v_me
          and role in ('admin', 'moderator')
     ) then
    raise exception 'Only the group creator or admins can change ownership';
  end if;

  if not exists (
    select 1
      from public.conversation_members
     where conversation_id = p_conversation
       and user_id = p_user
  ) then
    raise exception 'That person is not a member of this group';
  end if;

  if p_user = v_creator then
    raise exception 'That person is already the owner';
  end if;

  update public.conversation_members
     set role = 'member'
   where conversation_id = p_conversation
     and user_id = v_creator;

  update public.conversation_members
     set role = 'admin'
   where conversation_id = p_conversation
     and user_id = p_user;

  update public.conversations
     set created_by = p_user
   where id = p_conversation;
end;
$$;

grant execute on function public.claim_group_ownership(uuid) to authenticated;
grant execute on function public.make_group_owner(uuid, uuid) to authenticated;


/* Tell PostgREST to rebuild its function schema cache immediately. */
notify pgrst, 'reload schema';

commit;
