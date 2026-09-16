-- ============================================================
-- enotes production-readiness migration (2026-09-15)
--
-- Contents (all idempotent — safe to run more than once):
--   1. Follow counts: trigger maintains profiles.followers_count /
--      following_count on follows changes + one-time recount backfill.
--   2. Community member counts: trigger maintains communities.members_count
--      + one-time recount backfill.
--   3. mark_conversation_read(p_conversation uuid) RPC — fixes the 404 the
--      frontend hits; stamps last_read_at + read receipts for peers,
--      honoring the reader's read-receipt preference.
--   4. notes table + RLS + indexes (new Notes feature).
--   5. messages.duration_seconds (voice messages).
--   6. Storage policies so community creators/moderators can manage covers
--      in avatars/community-<id>/ (fixes the 401 on "Upload cover").
--   7. Safety-net RLS policies for communities / community_members joins
--      (missing policies made "Join" fail on some projects).
--
-- No DROP ... CASCADE. No destructive changes. Existing data is preserved
-- and reconciled (recounts), never deleted.
-- ============================================================

-- ------------------------------------------------------------
-- 0) DEDUPLICATE legacy count triggers.
--    The live database accumulated SEVEN follow-count triggers and THREE
--    community-count triggers from earlier migrations — every follow/join
--    fired all of them, multiplying the counters (the reported bug).
--    Each drop below is explicit and targeted (no CASCADE); the only
--    trigger removed for a different purpose is none — follows_activity
--    (activity feed) is preserved.
-- ------------------------------------------------------------
drop trigger if exists follows_bump on public.follows;
drop trigger if exists follows_bump_counts on public.follows;
drop trigger if exists trg_follow_counts on public.follows;
drop trigger if exists trg_sync_follow_counts on public.follows;
drop trigger if exists follows_sync_counts on public.follows;
drop trigger if exists follows_count_trigger on public.follows;

drop trigger if exists community_members_count on public.community_members;
drop trigger if exists trg_community_members_count on public.community_members;
drop trigger if exists community_members_count_trigger on public.community_members;

-- ------------------------------------------------------------
-- 1) FOLLOW COUNTS — exactly ONE canonical trigger, RECOUNT-style
--    (recomputing from the follows table is self-healing: it can never
--    drift, even if it fires twice on the same row)
-- ------------------------------------------------------------
create or replace function public.handle_follow_counts()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if (tg_op = 'INSERT') then
    update public.profiles p
       set following_count = (select count(*) from public.follows f where f.follower_id  = p.id),
           followers_count = (select count(*) from public.follows f where f.following_id = p.id)
     where p.id in (new.follower_id, new.following_id);
    return new;
  elsif (tg_op = 'DELETE') then
    update public.profiles p
       set following_count = (select count(*) from public.follows f where f.follower_id  = p.id),
           followers_count = (select count(*) from public.follows f where f.following_id = p.id)
     where p.id in (old.follower_id, old.following_id);
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists follows_count_trigger on public.follows;
create trigger follows_count_trigger
  after insert or delete on public.follows
  for each row execute function public.handle_follow_counts();

-- ------------------------------------------------------------
-- 2) COMMUNITY MEMBER COUNTS
-- ------------------------------------------------------------
create or replace function public.handle_community_member_count()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if (tg_op = 'INSERT') then
    update public.communities c
       set members_count = (select count(*) from public.community_members m where m.community_id = c.id),
           updated_at    = now()
     where c.id = new.community_id;
    return new;
  elsif (tg_op = 'DELETE') then
    update public.communities c
       set members_count = (select count(*) from public.community_members m where m.community_id = c.id),
           updated_at    = now()
     where c.id = old.community_id;
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists community_members_count_trigger on public.community_members;
create trigger community_members_count_trigger
  after insert or delete on public.community_members
  for each row execute function public.handle_community_member_count();

-- ------------------------------------------------------------
-- 3) mark_conversation_read RPC (fixes REST 404 on /rpc/mark_conversation_read)
--    Frontend contract: supabase.rpc('mark_conversation_read', { p_conversation: id })
-- ------------------------------------------------------------
create or replace function public.mark_conversation_read(p_conversation uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reader uuid := auth.uid();
  v_send_receipts boolean;
begin
  if v_reader is null then
    raise exception 'Authentication required';
  end if;

  -- Only a member of the conversation can mark it read (membership is the
  -- authorization; SECURITY DEFINER here only avoids recursive-RLS noise).
  if not exists (
    select 1 from public.conversation_members
     where conversation_id = p_conversation and user_id = v_reader
  ) then
    -- Silently no-op for non-members: leaks nothing, breaks nothing.
    return;
  end if;

  select coalesce(read_receipts_enabled, true)
    into v_send_receipts
    from public.user_settings
   where user_id = v_reader;

  update public.conversation_members
     set last_read_at = now()
   where conversation_id = p_conversation
     and user_id = v_reader;

  if coalesce(v_send_receipts, true) then
    -- Stamp read receipts on the OTHER members' messages (delivered = the
    -- moment the reader's client fetched; read = now).
    update public.messages
       set delivered_at = coalesce(delivered_at, now()),
             read_at    = now()
     where conversation_id = p_conversation
       and sender_id <> v_reader
       and deleted_at is null
       and read_at is null;
  end if;
end;
$$;

revoke all on function public.mark_conversation_read(uuid) from public;
revoke all on function public.mark_conversation_read(uuid) from anon;
grant execute on function public.mark_conversation_read(uuid) to authenticated;

-- ------------------------------------------------------------
-- 4) NOTES (new feature — list + editor with categories, pin, favorite, archive)
-- ------------------------------------------------------------
create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null default ''::text,
  content text not null default ''::text,
  category text not null default 'general'::text,
  pinned boolean not null default false,
  favorite boolean not null default false,
  archived boolean not null default false,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create index if not exists notes_user_updated_idx on public.notes (user_id, updated_at desc);
create index if not exists notes_user_pinned_idx on public.notes (user_id, pinned desc, updated_at desc);

alter table public.notes enable row level security;

drop policy if exists notes_select_own on public.notes;
create policy notes_select_own on public.notes
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists notes_insert_own on public.notes;
create policy notes_insert_own on public.notes
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists notes_update_own on public.notes;
create policy notes_update_own on public.notes
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists notes_delete_own on public.notes;
create policy notes_delete_own on public.notes
  for delete to authenticated
  using (user_id = auth.uid());

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists notes_touch_updated_at on public.notes;
create trigger notes_touch_updated_at
  before update on public.notes
  for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------
-- 5) VOICE MESSAGES: per-message duration
-- ------------------------------------------------------------
alter table public.messages add column if not exists duration_seconds numeric;

-- ------------------------------------------------------------
-- 6) COMMUNITY COVERS in avatars/community-<id>/…
--    (fixes 401 "Upload cover": only per-user folders were allowed before)
-- ------------------------------------------------------------
create or replace function public.can_manage_community_cover(p_path text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.communities c
      join public.community_members m on m.community_id = c.id
     where split_part(p_path, '/', 1) = 'community-' || c.id::text
       and (
         c.created_by = auth.uid()
         or (m.user_id = auth.uid() and m.role = 'moderator')
       )
  );
$$;

drop policy if exists avatars_community_cover_insert on storage.objects;
create policy avatars_community_cover_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and public.can_manage_community_cover(name)
  );

drop policy if exists avatars_community_cover_update on storage.objects;
create policy avatars_community_cover_update on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and public.can_manage_community_cover(name))
  with check (bucket_id = 'avatars' and public.can_manage_community_cover(name));

drop policy if exists avatars_community_cover_delete on storage.objects;
create policy avatars_community_cover_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and public.can_manage_community_cover(name));

-- ------------------------------------------------------------
-- 7) SAFETY-NET POLICIES so join/leave works even if the earlier
--    community migration never ran (idempotent — skipped when present)
-- ------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'communities'
       and policyname = 'communities_select_all'
  ) then
    create policy communities_select_all on public.communities
      for select to authenticated using (true);
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'community_members'
       and policyname = 'community_members_select_all'
  ) then
    create policy community_members_select_all on public.community_members
      for select to authenticated using (true);
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'community_members'
       and policyname = 'community_members_insert_self'
  ) then
    create policy community_members_insert_self on public.community_members
      for insert to authenticated
      with check (user_id = auth.uid());
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'community_members'
       and policyname = 'community_members_delete_self'
  ) then
    create policy community_members_delete_self on public.community_members
      for delete to authenticated
      using (user_id = auth.uid());
  end if;
end $$;

-- ------------------------------------------------------------
-- 8) ONE-TIME RECONCILIATION of drifted counters (runs on every execution
--    of this file but is cheap and always converges to the truth; the
--    triggers above maintain the counts from here on)
-- ------------------------------------------------------------
update public.profiles p
   set followers_count = (select count(*) from public.follows f where f.following_id = p.id),
       following_count = (select count(*) from public.follows f where f.follower_id  = p.id);

update public.communities c
   set members_count = (select count(*) from public.community_members m where m.community_id = c.id);
