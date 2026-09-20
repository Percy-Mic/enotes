-- ============================================================
-- DELETE FOR ME — per-user hidden messages
--
-- "Delete for me" hides a message for ONE member without touching
-- anyone else's copy (the existing soft delete stays "for everyone").
-- The client fetches its own hide rows and filters locally, so the
-- messages table, its RLS, and realtime stay untouched.
-- ============================================================

create table if not exists public.hidden_messages (
  message_id uuid not null references public.messages(id) on delete cascade,
  hidden_for uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default timezone('utc'::text, now()),
  primary key (message_id, hidden_for)
);

alter table public.hidden_messages enable row level security;

drop policy if exists "hidden_messages_all_own" on public.hidden_messages;
create policy "hidden_messages_all_own" on public.hidden_messages
  for all
  using (hidden_for = auth.uid())
  with check (hidden_for = auth.uid() and public.is_conversation_member(
    (select m.conversation_id from public.messages m where m.id = hidden_messages.message_id)
  ));

create index if not exists hidden_messages_hidden_for_idx
  on public.hidden_messages (hidden_for);
