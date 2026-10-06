-- Reaction permissions for the existing enotes reaction schema.
-- No new columns/tables are required.
-- Existing primary key remains (comment_id, user_id, emoji).

alter table public.comment_reactions enable row level security;

drop policy if exists "comment_reactions_read_authenticated" on public.comment_reactions;
drop policy if exists "comment_reactions_insert_self" on public.comment_reactions;
drop policy if exists "comment_reactions_delete_self" on public.comment_reactions;

create policy "comment_reactions_read_authenticated"
on public.comment_reactions
for select
to authenticated
using (true);

create policy "comment_reactions_insert_self"
on public.comment_reactions
for insert
to authenticated
with check (user_id = auth.uid());

create policy "comment_reactions_delete_self"
on public.comment_reactions
for delete
to authenticated
using (user_id = auth.uid());

-- Realtime is optional, but enables other open clients to see reaction changes.
do $$
begin
  begin
    alter publication supabase_realtime add table public.comment_reactions;
  exception when duplicate_object then null;
  end;
end $$;
