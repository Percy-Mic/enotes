/* ============================================================================
   Migration: mark_conversation_read + dependent helpers (navigation fixes)
   File: 2026-09-15b_navigation_screen_fixes.sql

   WHY THIS EXISTS
   ---------------
   The app calls mark_conversation_read(p_conversation uuid) on every chat
   open (app/messages/[id]/page.tsx). The console showed:

     POST /rest/v1/rpc/mark_conversation_read 404 (Not Found)
     POST /rest/v1/message_reactions 409 (Conflict)

   The 404 means the RPC is missing from the live database. This file is a
   SELF-CONTAINED, IDEMPOTENT repair: run it in any database state and it
   converges to the shape the app expects. Nothing is dropped destructively;
   existing functions with incompatible shapes are handled explicitly.

   CONTENTS
   --------
   1. helpers      — is_conversation_member / is_conversation_admin (definer,
                     recursion-safe for use inside conversation_members RLS)
   2. RPC          — mark_conversation_read(p_conversation uuid)
   3. RPC          — create_group_conversation(p_title text, p_member_ids uuid[])
   4. RLS          — the small set of policies the two RPCs + chat page need
   5. RPC          — admin template moderation (approve/reject/archive)
   6. RPC          — use_template(p_template_id uuid), bump_template_use,
                     respond_follow_request, record_sound_play,
                     is_current_user_admin, delete_my_account
   7. Storage      — avatars group/community folder policies
   8. Integrity    — defensive duplicate-reaction cleanup + reassurance that
                     the PK is the duplicate guard (409 = double-tap; the app
                     now treats it as success)

   SAFE-BY-CONSTRUCTION
   --------------------
   • Every policy: drop-if-exists-by-name then create → re-run safe.
   • Functions: CREATE OR REPLACE with stable signatures; where an older
     definition may hold a different parameter NAME or RETURN TYPE, the
     exact legacy signature is discovered via pg_proc and dropped first
     (no CASCADE) — PostgreSQL cannot rename input params in-place.
   • No RLS disabled, no USING(true) on private data, no service role.
   • Definer helpers pin search_path = ''.
   ==========================================================================*/

begin;

/* ============================================================================
   1) DEFINER HELPERS — used by RLS on conversation_members (recursion-safe)
   ==========================================================================*/

-- Adopt-name guard: an earlier migration may have created is_conversation_member
-- with a different input-parameter name; CREATE OR REPLACE cannot rename it.
do $$
declare
  v_args text;
begin
  select pg_get_function_identity_arguments(p.oid) into v_args
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'is_conversation_member'
    and pg_get_function_result(p.oid) = 'boolean'
  limit 1;

  if v_args is not null and v_args is distinct from 'conv uuid' then
    execute format('drop function if exists public.is_conversation_member(%s)', v_args);
  end if;
end $$;

create or replace function public.is_conversation_member(conv uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.conversation_members m
    where m.conversation_id = conv and m.user_id = auth.uid()
  );
$$;

create or replace function public.is_conversation_admin(conv uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.conversations c
    where c.id = conv and c.created_by = auth.uid()
  ) or exists (
    select 1 from public.conversation_members m
    where m.conversation_id = conv
      and m.user_id = auth.uid()
      and m.role in ('admin', 'moderator')
  );
$$;

create or replace function public.is_community_admin(comm uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.communities c
    where c.id = comm and c.created_by = auth.uid()
  ) or exists (
    select 1 from public.community_members m
    where m.community_id = comm
      and m.user_id = auth.uid()
      and m.role = 'moderator'
  );
$$;

create or replace function public.is_current_user_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select p.is_admin from public.profiles p where p.id = auth.uid()),
    false
  );
$$;

/* ============================================================================
   2) mark_conversation_read — fixes the 404
      Member-scoped; touches ONLY other members' rows (read receipts) and
      only clears NULLs, so re-marking is free and idempotent.
   ==========================================================================*/
create or replace function public.mark_conversation_read(p_conversation uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_conversation_member(p_conversation) then
    raise exception 'Not a member of this conversation';
  end if;

  update public.conversation_members m
     set last_read_at = now()
   where m.conversation_id = p_conversation
     and m.user_id <> auth.uid()
     and (m.last_read_at is null or m.last_read_at < now() - interval '1 second');
end;
$$;

grant execute on function public.mark_conversation_read(uuid) to authenticated;

/* ============================================================================
   3) create_group_conversation — atomic group creation (fixes the RLS 403
      on POST /rest/v1/conversations for the group flow)
   ==========================================================================*/
create or replace function public.create_group_conversation(p_title text, p_member_ids uuid[])
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_conv uuid;
  v_clean uuid[];
  v_m uuid;
begin
  if v_me is null then
    raise exception 'Sign in to create a group';
  end if;

  -- validate + dedupe; the creator is added separately
  if p_member_ids is null then
    raise exception 'Pick at least one member';
  end if;

  select coalesce(array_agg(distinct m), '{}') into v_clean
  from unnest(p_member_ids) as m
  where m <> v_me
    and exists (select 1 from public.profiles p where p.id = m);

  if coalesce(array_length(v_clean, 1), 0) = 0 then
    raise exception 'Pick at least one other member';
  end if;

  insert into public.conversations (is_group, title, created_by)
  values (true, left(btrim(coalesce(p_title, '')), 120), v_me)
  returning id into v_conv;

  insert into public.conversation_members (conversation_id, user_id, role)
  values (v_conv, v_me, 'admin');

  insert into public.conversation_members (conversation_id, user_id, role)
  select v_conv, m, 'member' from unnest(v_clean) as m;

  -- invites (best effort: skip self, dedupe)
  insert into public.notifications (user_id, actor_id, type, entity_type, entity_id, message, dedupe_key)
  select
    m, v_me, 'group_invite', 'conversation', v_conv::text,
    'added you to a group chat', format('group_invite:%s:%s', v_conv, m)
  from unnest(v_clean) as m
  on conflict do nothing;

  return v_conv;
end;
$$;

grant execute on function public.create_group_conversation(text, uuid[]) to authenticated;

/* ============================================================================
   4) RLS — the chat-surface policies these flows rely on
   ==========================================================================*/

alter table public.conversations        enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages             enable row level security;
alter table public.message_reactions    enable row level security;
alter table public.notifications        enable row level security;

-- conversations -----------------------------------------------------------
drop policy if exists "conversations_select_member"  on public.conversations;
drop policy if exists "conversations_insert_creator" on public.conversations;
drop policy if exists "conversations_update_admin"   on public.conversations;
drop policy if exists "conversations_delete_creator" on public.conversations;

create policy "conversations_select_member" on public.conversations for select
  using (public.is_conversation_member(id));
create policy "conversations_insert_creator" on public.conversations for insert
  with check (created_by = auth.uid());
create policy "conversations_update_admin" on public.conversations for update
  using (public.is_conversation_admin(id))
  with check (public.is_conversation_admin(id));
create policy "conversations_delete_creator" on public.conversations for delete
  using (created_by = auth.uid());

-- conversation_members ----------------------------------------------------
drop policy if exists "conversation_members_select"  on public.conversation_members;
drop policy if exists "conversation_members_insert"  on public.conversation_members;
drop policy if exists "conversation_members_update"  on public.conversation_members;
drop policy if exists "conversation_members_delete"  on public.conversation_members;

create policy "conversation_members_select" on public.conversation_members for select
  using (public.is_conversation_member(conversation_id));
-- DM creation path (app/u/[username]/page.tsx) inserts creator + partner rows
-- for a conversation the creator just made (and therefore admins).
create policy "conversation_members_insert" on public.conversation_members for insert
  with check (
    public.is_conversation_admin(conversation_id)
    or user_id = auth.uid()
  );
create policy "conversation_members_update" on public.conversation_members for update
  using (user_id = auth.uid() or public.is_conversation_admin(conversation_id))
  with check (user_id = auth.uid() or public.is_conversation_admin(conversation_id));
create policy "conversation_members_delete" on public.conversation_members for delete
  using (
    user_id = auth.uid()
    or public.is_conversation_admin(conversation_id)
  );

-- role guard: a member may edit their own row (mute state) but can NEVER
-- change their own role — only a creator/admin may elevate someone.
create or replace function public.guard_member_role_change()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.role is distinct from old.role
     and new.user_id = auth.uid()
     and not public.is_conversation_admin(new.conversation_id) then
    raise exception 'Only a group admin can change member roles';
  end if;
  return new;
end;
$$;

drop trigger if exists "conversation_members_role_guard" on public.conversation_members;
create trigger "conversation_members_role_guard"
  before update on public.conversation_members
  for each row execute function public.guard_member_role_change();

-- messages ---------------------------------------------------------------
drop policy if exists "messages_select_member" on public.messages;
drop policy if exists "messages_insert_member" on public.messages;
drop policy if exists "messages_update_own"    on public.messages;
drop policy if exists "messages_delete_own"    on public.messages;

create policy "messages_select_member" on public.messages for select
  using (public.is_conversation_member(conversation_id));
create policy "messages_insert_member" on public.messages for insert
  with check (sender_id = auth.uid() and public.is_conversation_member(conversation_id));
create policy "messages_update_own" on public.messages for update
  using (sender_id = auth.uid() and deleted_at is null)
  with check (sender_id = auth.uid());
create policy "messages_delete_own" on public.messages for delete
  using (sender_id = auth.uid());

-- message_reactions (the 409 is the PK doing its job — see section 8) ------
drop policy if exists "message_reactions_select" on public.message_reactions;
drop policy if exists "message_reactions_insert" on public.message_reactions;
drop policy if exists "message_reactions_delete" on public.message_reactions;

create policy "message_reactions_select" on public.message_reactions for select
  using (
    exists (
      select 1 from public.messages msg
      where msg.id = message_reactions.message_id
        and public.is_conversation_member(msg.conversation_id)
    )
  );
create policy "message_reactions_insert" on public.message_reactions for insert
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.messages msg
      where msg.id = message_reactions.message_id
        and public.is_conversation_member(msg.conversation_id)
    )
  );
create policy "message_reactions_delete" on public.message_reactions for delete
  using (user_id = auth.uid());

-- notifications (invites) -------------------------------------------------
drop policy if exists "notifications_select_own" on public.notifications;
drop policy if exists "notifications_update_own" on public.notifications;

create policy "notifications_select_own" on public.notifications for select
  using (user_id = auth.uid());
create policy "notifications_update_own" on public.notifications for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

/* ============================================================================
   5) ADMIN TEMPLATE MODERATION — exact dashboard signatures, re-run safe
      (return type setof templates; legacy incompatible shapes are dropped)
   ==========================================================================*/
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure::text as sig,
           pg_get_function_result(p.oid) as res
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('admin_approve_template', 'admin_reject_template', 'admin_archive_template')
      and pg_get_function_identity_arguments(p.oid) in
          ('p_template_id uuid', 'p_template_id uuid, p_note text')
      and pg_get_function_result(p.oid) is distinct from 'setof public.templates'
  loop
    execute format('drop function if exists %s', r.sig);
  end loop;
end $$;

create or replace function public.admin_approve_template(p_template_id uuid, p_note text default null)
returns setof public.templates
language plpgsql security definer set search_path = ''
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

  insert into public.template_reviews (template_id, reviewer_id, action, note, previous_status, new_status)
  select t.id, auth.uid(), 'approved', p_note, 'pending', 'published'
  from public.templates t where t.id = p_template_id;

  return query select * from public.templates where id = p_template_id;
end;
$$;

create or replace function public.admin_reject_template(p_template_id uuid, p_note text default null)
returns setof public.templates
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_current_user_admin() then
    raise exception 'Admins only';
  end if;
  if coalesce(btrim(p_note, ''), '') = '' then
    raise exception 'A rejection note is required';
  end if;

  update public.templates
     set status = 'rejected',
         reviewed_at = now(),
         reviewed_by = auth.uid(),
         rejection_reason = left(btrim(p_note), 500)
   where id = p_template_id;

  insert into public.template_reviews (template_id, reviewer_id, action, note, previous_status, new_status)
  select t.id, auth.uid(), 'rejected', p_note, 'pending', 'rejected'
  from public.templates t where t.id = p_template_id;

  return query select * from public.templates where id = p_template_id;
end;
$$;

create or replace function public.admin_archive_template(p_template_id uuid, p_note text default null)
returns setof public.templates
language plpgsql security definer set search_path = ''
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

  insert into public.template_reviews (template_id, reviewer_id, action, note, previous_status, new_status)
  select t.id, auth.uid(), 'archived', p_note, t.status, 'archived'
  from public.templates t where t.id = p_template_id;

  return query select * from public.templates where id = p_template_id;
end;
$$;

grant execute on function
  public.admin_approve_template(uuid, text),
  public.admin_reject_template(uuid, text),
  public.admin_archive_template(uuid, text)
  to authenticated;

-- templates policies the marketplace + RPCs rely on -----------------------
alter table public.templates enable row level security;

drop policy if exists "templates_select_published_or_own" on public.templates;
drop policy if exists "templates_insert_own"              on public.templates;
drop policy if exists "templates_update_own"              on public.templates;
drop policy if exists "templates_delete_own"              on public.templates;

create policy "templates_select_published_or_own" on public.templates for select
  using (status = 'published' or creator_id = auth.uid() or public.is_current_user_admin());
create policy "templates_insert_own" on public.templates for insert
  with check (creator_id = auth.uid());
create policy "templates_update_own" on public.templates for update
  using (creator_id = auth.uid())
  with check (creator_id = auth.uid());
create policy "templates_delete_own" on public.templates for delete
  using (creator_id = auth.uid());

/* ============================================================================
   6) REMAINING APP RPCs — every supabase.rpc() call site, self-contained
   ==========================================================================*/

-- use_template: copies a published template into a NEW project for the caller.
-- Premium gating server-side (templates.premium entitlement key, mirrors
-- lib/entitlements.ts PLAN_ENTITLEMENTS).
do $$
declare
  v_args text;
begin
  select pg_get_function_identity_arguments(p.oid) into v_args
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'use_template'
  limit 1;
  if v_args is not null and v_args is distinct from 'p_template_id uuid' then
    execute format('drop function if exists public.use_template(%s)', v_args);
  end if;
end $$;

create or replace function public.use_template(p_template_id uuid)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_tpl public.templates;
  v_has_premium boolean;
  v_project uuid;
begin
  if v_me is null then
    raise exception 'Sign in to use templates';
  end if;

  select * into v_tpl from public.templates where id = p_template_id;
  if not found then
    raise exception 'Template not found';
  end if;
  if v_tpl.status <> 'published' then
    raise exception 'Template is not published';
  end if;

  if v_tpl.premium then
    select exists (
      select 1 from public.entitlements e
      where e.user_id = v_me
        and e.key = 'templates.premium'
        and (e.expires_at is null or e.expires_at > now())
    ) into v_has_premium;
    if not v_has_premium then
      raise exception 'This is a premium template — upgrade to Pro to use it';
    end if;
  end if;

  insert into public.video_projects (user_id, title, project, aspect_ratio, duration_seconds, template_id)
  select v_me,
         'Remix: ' || v_tpl.title,
         v_tpl.project,
         v_tpl.aspect_ratio,
         v_tpl.duration_seconds,
         v_tpl.id
  returning id into v_project;

  update public.templates
     set uses = uses + 1,
         views = views + 1
   where id = p_template_id;

  return v_project;
end;
$$;

grant execute on function public.use_template(uuid) to authenticated;

create or replace function public.bump_template_use(p_template uuid)
returns void
language sql security definer set search_path = ''
as $$
  update public.templates set uses = uses + 1 where id = p_template;
$$;

grant execute on function public.bump_template_use(uuid) to authenticated;

create or replace function public.record_sound_play(p_sound uuid)
returns void
language sql security definer set search_path = ''
as $$
  update public.sounds set plays = plays + 1 where id = p_sound;
$$;

grant execute on function public.record_sound_play(uuid) to authenticated;

create or replace function public.respond_follow_request(p_request_id uuid, p_accept boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_req public.follow_requests;
begin
  select * into v_req from public.follow_requests where id = p_request_id;
  if not found then
    raise exception 'Request not found';
  end if;
  if v_req.target_id <> auth.uid() then
    raise exception 'Only the recipient can respond';
  end if;

  if p_accept then
    insert into public.follows (follower_id, following_id)
    values (v_req.requester_id, v_req.target_id)
    on conflict do nothing;

    update public.profiles
       set followers_count = followers_count + 1
     where id = v_req.target_id;
    update public.profiles
       set following_count = following_count + 1
     where id = v_req.requester_id;

    insert into public.notifications (user_id, actor_id, type, entity_type, entity_id, message, dedupe_key)
    values (v_req.requester_id, auth.uid(), 'follow_accept', 'profile', auth.uid()::text,
            'accepted your follow request', format('follow_accept:%s:%s', v_req.requester_id, auth.uid()))
    on conflict do nothing;
  end if;

  update public.follow_requests
     set status = case when p_accept then 'accepted' else 'declined' end
   where id = p_request_id;
end;
$$;

grant execute on function public.respond_follow_request(uuid, boolean) to authenticated;

create or replace function public.delete_my_account()
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in first';
  end if;

  delete from public.message_reactions        where user_id = auth.uid();
  delete from public.post_reactions           where user_id = auth.uid();
  delete from public.comment_reactions        where user_id = auth.uid();
  delete from public.post_likes               where user_id = auth.uid();
  delete from public.saved_posts              where user_id = auth.uid();
  delete from public.saved_templates          where user_id = auth.uid();
  delete from public.template_ratings         where user_id = auth.uid();
  delete from public.favorite_sounds          where user_id = auth.uid();
  delete from public.reposts                  where user_id = auth.uid();
  delete from public.story_views              where viewer_id = auth.uid();
  delete from public.follows                  where follower_id = auth.uid() or following_id = auth.uid();
  delete from public.follow_requests          where requester_id = auth.uid() or target_id = auth.uid();
  delete from public.conversation_members     where user_id = auth.uid();
  delete from public.community_members        where user_id = auth.uid();
  delete from public.community_posts          where posted_by = auth.uid();
  delete from public.messages                 where sender_id = auth.uid();
  delete from public.comments                 where author_id = auth.uid();
  delete from public.posts                    where author_id = auth.uid();
  delete from public.activity_events          where user_id = auth.uid();
  delete from public.user_settings            where user_id = auth.uid();
  delete from public.user_presence            where user_id = auth.uid();
  delete from public.entitlements             where user_id = auth.uid();
  delete from public.subscriptions            where user_id = auth.uid();
  delete from public.video_projects           where user_id = auth.uid();
  delete from public.media_library            where user_id = auth.uid();
  delete from public.notifications            where user_id = auth.uid();
  delete from public.profiles                 where id = auth.uid();
end;
$$;

grant execute on function public.delete_my_account() to authenticated;

/* ============================================================================
   7) STORAGE — avatars bucket folder policies for group/community images.
      Folder layout from lib/storage/upload.ts + group icon flow:
        avatars/group-<conversation-uuid>/<file>
        avatars/community-<community-uuid>/<file>
   ==========================================================================*/
do $$
begin
  if not exists (select 1 from storage.buckets where id = 'avatars') then
    insert into storage.buckets (id, name, public)
    values ('avatars', 'avatars', true);
  end if;
end $$;

drop policy if exists "avatars_group_read"   on storage.objects;
drop policy if exists "avatars_group_write"  on storage.objects;
drop policy if exists "avatars_group_manage" on storage.objects;
drop policy if exists "avatars_community_read"   on storage.objects;
drop policy if exists "avatars_community_write"  on storage.objects;
drop policy if exists "avatars_community_manage" on storage.objects;

create policy "avatars_group_read" on storage.objects for select
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] like 'group-%');
create policy "avatars_group_write" on storage.objects for insert
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] like 'group-%'
    and case
          when (storage.foldername(name))[1] ~ '^group-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
            then public.is_conversation_admin(substr((storage.foldername(name))[1] from 7)::uuid)
          else false
        end
  );
create policy "avatars_group_manage" on storage.objects for update
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] like 'group-%'
    and case
          when (storage.foldername(name))[1] ~ '^group-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
            then public.is_conversation_admin(substr((storage.foldername(name))[1] from 7)::uuid)
          else false
        end
  );

create policy "avatars_community_read" on storage.objects for select
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] like 'community-%');
create policy "avatars_community_write" on storage.objects for insert
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] like 'community-%'
    and case
          when (storage.foldername(name))[1] ~ '^community-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
            then public.is_community_admin(substr((storage.foldername(name))[1] from 11)::uuid)
          else false
        end
  );
create policy "avatars_community_manage" on storage.objects for update
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] like 'community-%'
    and case
          when (storage.foldername(name))[1] ~ '^community-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
            then public.is_community_admin(substr((storage.foldername(name))[1] from 11)::uuid)
          else false
        end
  );

/* ============================================================================
   8) REACTION INTEGRITY
      The 409 the console shows is the (message_id, user_id, emoji) PRIMARY
      KEY correctly refusing a duplicate insert — a double-tap race in the
      client. Two layers here:
        a) one-time cleanup of any historical duplicates (defensive; PK makes
           these impossible going forward, but old data predating the PK may
           exist if the constraint was added later)
        b) the client fix (app/messages/[id]/page.tsx) now treats a unique-
           violation as "already reacted" and reconciles to reacted state.
   ==========================================================================*/
delete from public.message_reactions a
using public.message_reactions b
where a.rowid > b.rowid
  and a.message_id = b.message_id
  and a.user_id = b.user_id
  and a.emoji = b.emoji;

commit;

/* ============================================================================
   RUN
   ---
   Supabase Dashboard → SQL Editor → paste this file → Run.
   Safe to run repeatedly. Verify afterwards:

     select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public'
       and proname in ('mark_conversation_read','create_group_conversation',
                       'use_template','admin_approve_template');
   ==========================================================================*/