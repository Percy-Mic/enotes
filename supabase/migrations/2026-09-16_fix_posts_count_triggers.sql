-- ============================================================
-- FIX: count triggers — NULL-reference in DELETE branch + re-stacked duplicates
--
-- 1. bump_community_posts()'s DELETE branch referenced new.community_id,
--    which is NULL in a DELETE trigger, so `where id = NULL` matched
--    nothing and community post deletion never decremented posts_count.
--    (Masked historically by a second stacked trigger that decremented
--    correctly; resurfaced once the duplicates were dropped.)
-- 2. posts carried FOUR count triggers: bump_posts_count attached twice
--    (posts_bump + posts_bump_count) plus sync_post_count — every post
--    insert tripled-counted profiles.posts_count.
--
-- Fix: correct the DELETE branch (old.community_id), keep exactly one
-- bump trigger per table, recount both counters from their real rows.
-- Idempotent, additive, no data lost.
-- ============================================================

-- 1. Correct the DELETE branch of the community-posts counter
CREATE OR REPLACE FUNCTION public.bump_community_posts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
begin
  if (tg_op = 'INSERT') then
    update public.communities set posts_count = posts_count + 1 where id = new.community_id;
  elsif (tg_op = 'DELETE') then
    update public.communities set posts_count = greatest(posts_count - 1, 0) where id = old.community_id;
  end if;
  return null;
end
$function$;

-- 2. Exactly one bump trigger on posts (posts_bump_count already covers
--    INSERT/DELETE/UPDATE incl. soft-delete transitions)
DROP TRIGGER IF EXISTS posts_bump ON public.posts;
DROP TRIGGER IF EXISTS trg_post_count ON public.posts;

-- 3. Recount profiles.posts_count from real (non-deleted) posts
UPDATE public.profiles p
SET posts_count = (
  SELECT count(*) FROM public.posts po
  WHERE po.author_id = p.id AND po.deleted_at IS NULL
)
WHERE p.posts_count <> (
  SELECT count(*) FROM public.posts po
  WHERE po.author_id = p.id AND po.deleted_at IS NULL
);

-- 4. Recount communities.posts_count from real community_posts rows
UPDATE public.communities c
SET posts_count = (
  SELECT count(*) FROM public.community_posts cp WHERE cp.community_id = c.id
)
WHERE c.posts_count <> (
  SELECT count(*) FROM public.community_posts cp WHERE cp.community_id = c.id
);

-- 5. Soft-deleting a post removes its community memberships, so the
--    community counter (owned by community_posts) stays truthful.
CREATE OR REPLACE FUNCTION public.purge_community_links_on_soft_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
begin
  if new.deleted_at is not null and old.deleted_at is null then
    delete from public.community_posts where post_id = new.id;
  end if;
  return null;
end
$function$;

DROP TRIGGER IF EXISTS posts_purge_community_links ON public.posts;
CREATE TRIGGER posts_purge_community_links
AFTER UPDATE ON public.posts
FOR EACH ROW
EXECUTE FUNCTION public.purge_community_links_on_soft_delete();
