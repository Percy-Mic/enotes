-- ============================================================================
-- 2026-09-30 — AI Studio tables: conversations, messages, actions, memories
--
-- Fresh-environment completeness. The AI Studio (video editor assistant)
-- writes six tables; three of them existed only in production and were
-- never captured in a migration:
--   • video_ai_conversations  — one active chat thread per user+project
--   • video_ai_messages       — chat turns (role, content, actions, tool_calls)
--   • video_ai_actions        — audit trail of actions the AI requested
--   • video_ai_memories       — durable user memories (also defined here for
--                               fresh envs; production already has it, plus
--                               the vector(768) embedding column from
--                               2026-09-30_video_ai_memory_embedding.sql)
-- video_ai_jobs (2026-09-28) and video_ai_clip_vision_index (20260929000000)
-- already have migration files and are not repeated here.
--
-- Column shapes mirror exactly what app/api/video/ai/route.ts and
-- lib/video/ai.ts write — no invented fields. All statements are
-- idempotent (create-if-not-exists / drop-then-create policies) so the
-- file can be re-run safely, including on environments that already have
-- some of the tables.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- video_ai_conversations — one active thread per user+project
-- ---------------------------------------------------------------------------
create table if not exists public.video_ai_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  project_id uuid null references public.video_projects(id) on delete cascade,
  title text not null default 'Editing session',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists video_ai_conversations_user_project_idx
  on public.video_ai_conversations(user_id, project_id, updated_at desc);

alter table public.video_ai_conversations enable row level security;

drop policy if exists "video_ai_conversations_select_own" on public.video_ai_conversations;
create policy "video_ai_conversations_select_own"
  on public.video_ai_conversations for select
  using (auth.uid() = user_id);

drop policy if exists "video_ai_conversations_insert_own" on public.video_ai_conversations;
create policy "video_ai_conversations_insert_own"
  on public.video_ai_conversations for insert
  with check (auth.uid() = user_id);

drop policy if exists "video_ai_conversations_update_own" on public.video_ai_conversations;
create policy "video_ai_conversations_update_own"
  on public.video_ai_conversations for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "video_ai_conversations_delete_own" on public.video_ai_conversations;
create policy "video_ai_conversations_delete_own"
  on public.video_ai_conversations for delete
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- video_ai_messages — chat turns inside a conversation
-- ---------------------------------------------------------------------------
create table if not exists public.video_ai_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.video_ai_conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null default '',
  actions jsonb not null default '[]'::jsonb,
  tool_calls jsonb not null default '[]'::jsonb,
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists video_ai_messages_conversation_created_idx
  on public.video_ai_messages(conversation_id, created_at);

alter table public.video_ai_messages enable row level security;

drop policy if exists "video_ai_messages_select_own" on public.video_ai_messages;
create policy "video_ai_messages_select_own"
  on public.video_ai_messages for select
  using (auth.uid() = user_id);

drop policy if exists "video_ai_messages_insert_own" on public.video_ai_messages;
create policy "video_ai_messages_insert_own"
  on public.video_ai_messages for insert
  with check (auth.uid() = user_id);

drop policy if exists "video_ai_messages_update_own" on public.video_ai_messages;
create policy "video_ai_messages_update_own"
  on public.video_ai_messages for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "video_ai_messages_delete_own" on public.video_ai_messages;
create policy "video_ai_messages_delete_own"
  on public.video_ai_messages for delete
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- video_ai_actions — audit trail of executed AI actions
-- ---------------------------------------------------------------------------
create table if not exists public.video_ai_actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  project_id uuid null references public.video_projects(id) on delete cascade,
  conversation_id uuid null references public.video_ai_conversations(id) on delete set null,
  message_id uuid null,
  action_type text not null default 'unknown',
  target_type text not null default 'project',
  target_id text null,
  action jsonb not null default '{}'::jsonb,
  before_state jsonb null,
  after_state jsonb null,
  status text not null default 'executed' check (status in ('executed', 'undone', 'failed', 'skipped')),
  feedback text null,
  created_at timestamptz not null default now()
);

create index if not exists video_ai_actions_user_project_idx
  on public.video_ai_actions(user_id, project_id, created_at desc);

alter table public.video_ai_actions enable row level security;

drop policy if exists "video_ai_actions_select_own" on public.video_ai_actions;
create policy "video_ai_actions_select_own"
  on public.video_ai_actions for select
  using (auth.uid() = user_id);

drop policy if exists "video_ai_actions_insert_own" on public.video_ai_actions;
create policy "video_ai_actions_insert_own"
  on public.video_ai_actions for insert
  with check (auth.uid() = user_id);

drop policy if exists "video_ai_actions_update_own" on public.video_ai_actions;
create policy "video_ai_actions_update_own"
  on public.video_ai_actions for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "video_ai_actions_delete_own" on public.video_ai_actions;
create policy "video_ai_actions_delete_own"
  on public.video_ai_actions for delete
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- video_ai_memories — durable user memories for personalization.
-- (Production already has this table; included so fresh environments get it
-- from this file. The embedding column comes from
-- 2026-09-30_video_ai_memory_embedding.sql and is added here too for the
-- same reason, guarded by add-column-if-not-exists.)
-- ---------------------------------------------------------------------------
create table if not exists public.video_ai_memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  project_id uuid null references public.video_projects(id) on delete cascade,
  memory_type text not null default 'preference' check (memory_type in ('preference', 'correction', 'recurring_instruction', 'style', 'fact')),
  content text not null,
  metadata jsonb not null default '{}'::jsonb,
  confidence numeric not null default 0.8 check (confidence between 0 and 1),
  importance numeric not null default 0.5 check (importance between 0 and 1),
  use_count integer not null default 0,
  is_active boolean not null default true,
  last_used_at timestamptz null,
  expires_at timestamptz null,
  archived_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists video_ai_memories_user_active_idx
  on public.video_ai_memories(user_id, is_active);

alter table public.video_ai_memories enable row level security;

drop policy if exists "video_ai_memories_select_own" on public.video_ai_memories;
create policy "video_ai_memories_select_own"
  on public.video_ai_memories for select
  using (auth.uid() = user_id);

drop policy if exists "video_ai_memories_insert_own" on public.video_ai_memories;
create policy "video_ai_memories_insert_own"
  on public.video_ai_memories for insert
  with check (auth.uid() = user_id);

drop policy if exists "video_ai_memories_update_own" on public.video_ai_memories;
create policy "video_ai_memories_update_own"
  on public.video_ai_memories for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "video_ai_memories_delete_own" on public.video_ai_memories;
create policy "video_ai_memories_delete_own"
  on public.video_ai_memories for delete
  using (auth.uid() = user_id);

-- pgvector + the embedding column (shared with
-- 2026-09-30_video_ai_memory_embedding.sql; both are idempotent).
create extension if not exists vector;
alter table public.video_ai_memories
  add column if not exists embedding vector(768);

commit;
