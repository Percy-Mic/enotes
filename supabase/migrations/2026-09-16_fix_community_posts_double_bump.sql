-- ============================================================
-- FIX: community posts_count double-bump
--
-- community_posts carried TWO triggers that each bumped
-- communities.posts_count on INSERT/DELETE:
--   • bump_community_posts        (+1 / −1)
--   • sync_community_post_count   (+1 / −1)
-- Every share therefore counted twice and every cascade delete of a
-- post decremented twice, drifting posts_count permanently
-- (observed live: posts_count=4 while actual rows=2).
--
-- Fix: drop the redundant sync_community_post_count trigger and keep
-- bump_community_posts (single owner). Recount posts_count from the
-- real rows so existing drift is repaired. Idempotent and additive —
-- no data is lost, the trigger being dropped is a pure duplicate.
-- ============================================================

DROP TRIGGER IF EXISTS trg_community_posts_count ON public.community_posts;

-- Repair any drift left behind by the double-bump era
UPDATE public.communities c
SET posts_count = (
  SELECT count(*) FROM public.community_posts cp WHERE cp.community_id = c.id
)
WHERE c.posts_count <> (
  SELECT count(*) FROM public.community_posts cp WHERE cp.community_id = c.id
);
