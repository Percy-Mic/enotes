-- ============================================================
-- STORY REACTIONS — per-user emoji reactions on stories
--
-- Mirrors post_reactions: (story_id, user_id, emoji) PK means a user can
-- react with several emojis but never double-count one. Cascade on both
-- parents so story/profile deletion cleans up automatically.
-- ============================================================

create table if not exists public.story_reactions (
  story_id uuid not null references public.stories(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  emoji text not null,
  created_at timestamp with time zone not null default timezone('utc'::text, now()),
  constraint story_reactions_pkey primary key (story_id, user_id, emoji)
);

alter table public.story_reactions enable row level security;

drop policy if exists "story_reactions_select" on public.story_reactions;
create policy "story_reactions_select" on public.story_reactions
  for select to authenticated using (true);

drop policy if exists "story_reactions_insert" on public.story_reactions;
create policy "story_reactions_insert" on public.story_reactions
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "story_reactions_delete" on public.story_reactions;
create policy "story_reactions_delete" on public.story_reactions
  for delete to authenticated using (user_id = auth.uid());
