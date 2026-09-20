-- ============================================================
-- SHARED-POST NOTE — community_posts.note
--
-- "Say something" when sharing a post into a community: an
-- optional 280-char note from the sharer, shown above the
-- shared post with their name ("X shared: …").
-- ============================================================

alter table public.community_posts add column if not exists note text;
