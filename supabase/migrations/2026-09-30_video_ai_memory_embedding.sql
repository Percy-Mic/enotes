-- ============================================================================
-- 2026-09-30 — Semantic memory search (pgvector)
--
-- Adds the embedding column the AI Studio memory path now writes and reads:
--   • video_ai_memories.embedding — vector(768), Gemini text-embedding-004.
--   • Rows written before this column existed are NULL; the client embeds
--     them lazily on first recall and backfills (see lib/video/ai.ts).
--   • No pgvector index needed at this scale (per-user pool ≤ a few hundred
--     rows; similarity is computed client-side over the fetched pool).
--   • Safe to re-run (drop-if-exists then add).
-- ============================================================================

-- pgvector must exist (Supabase projects ship it; enable if missing).
create extension if not exists vector;

alter table public.video_ai_memories
  add column if not exists embedding vector(768);

-- Optional integrity: drop any row whose embedding is the wrong dimension
-- (cannot happen via the typed column, but keeps re-runs honest).
-- (No action needed — Postgres enforces vector(768) on write.)
