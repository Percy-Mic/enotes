create table if not exists public.video_ai_clip_vision_index (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.video_projects(id) on delete cascade,
  clip_id text not null,
  fingerprint text not null,
  source_url text not null,
  source_duration numeric not null default 0,
  trim_start numeric not null default 0,
  trim_end numeric not null default 0,
  description text not null default '',
  shot_type text not null default '',
  subjects jsonb not null default '[]'::jsonb,
  visual_tags jsonb not null default '[]'::jsonb,
  text_visible jsonb not null default '[]'::jsonb,
  composition text not null default '',
  quality_notes jsonb not null default '[]'::jsonb,
  suggested_use text not null default '',
  frame_times jsonb not null default '[]'::jsonb,
  analyzed_at timestamptz not null default now(),
  model text not null default 'gemini',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, clip_id)
);

create index if not exists video_ai_clip_vision_index_user_project_idx
  on public.video_ai_clip_vision_index(user_id, project_id);

alter table public.video_ai_clip_vision_index enable row level security;

drop policy if exists "video_ai_clip_vision_index_select_own" on public.video_ai_clip_vision_index;
create policy "video_ai_clip_vision_index_select_own"
  on public.video_ai_clip_vision_index for select
  using (auth.uid() = user_id);

drop policy if exists "video_ai_clip_vision_index_insert_own" on public.video_ai_clip_vision_index;
create policy "video_ai_clip_vision_index_insert_own"
  on public.video_ai_clip_vision_index for insert
  with check (auth.uid() = user_id);

drop policy if exists "video_ai_clip_vision_index_update_own" on public.video_ai_clip_vision_index;
create policy "video_ai_clip_vision_index_update_own"
  on public.video_ai_clip_vision_index for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "video_ai_clip_vision_index_delete_own" on public.video_ai_clip_vision_index;
create policy "video_ai_clip_vision_index_delete_own"
  on public.video_ai_clip_vision_index for delete
  using (auth.uid() = user_id);
