-- ============================================================
-- FIX: reactions/likes silently failing with 42P10
-- "there is no unique or exclusion constraint matching the
--  ON CONFLICT specification"
--
-- Root cause: notify_on_post_reaction() and notify_on_post_like()
-- insert into notifications with `ON CONFLICT (dedupe_key)`, but the
-- notifications table only has PARTIAL unique indexes on dedupe_key
-- (`WHERE dedupe_key IS NOT NULL`). PostgreSQL requires the conflict
-- target to carry the same predicate — notify_on_repost() already
-- does this correctly. Every reaction/like insert therefore failed,
-- and since the trigger runs inside the user's insert statement, the
-- UI reaction POSTs failed with 400.
--
-- Fix: restore the two functions with the correct conflict target
-- (byte-for-byte identical bodies otherwise, same SECURITY DEFINER
-- and search_path). Additive/idempotent: no data touched, no triggers
-- dropped or recreated, safe to re-run.
-- ============================================================

-- 1) notify_on_post_reaction — identical body, valid conflict target
CREATE OR REPLACE FUNCTION public.notify_on_post_reaction()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_author uuid;
begin
  select p.author_id into v_author from public.posts p where p.id = new.post_id;
  if v_author is null or v_author = new.user_id then return null; end if;

  insert into public.notifications (user_id, actor_id, type, entity_type, entity_id, message, dedupe_key)
  values (v_author, new.user_id, 'like', 'post', new.post_id::text, 'reacted to your post',
          'react:' || new.post_id || ':' || new.user_id)
  on conflict (dedupe_key) where dedupe_key is not null do nothing;
  return null;
end;
$function$;

-- 2) notify_on_post_like — identical body, valid conflict target
CREATE OR REPLACE FUNCTION public.notify_on_post_like()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_author uuid;
begin
  select p.author_id into v_author from public.posts p where p.id = new.post_id;
  if v_author is null or v_author = new.user_id then return null; end if;

  insert into public.notifications (user_id, actor_id, type, entity_type, entity_id, message, dedupe_key)
  values (v_author, new.user_id, 'like', 'post', new.post_id::text, 'liked your post',
          'like:' || new.post_id || ':' || new.user_id)
  on conflict (dedupe_key) where dedupe_key is not null do nothing;
  return null;
end;
$function$;

-- 3) notify_on_comment already uses `ON CONFLICT DO NOTHING` (no target),
--    which is valid against partial indexes — left untouched on purpose.
