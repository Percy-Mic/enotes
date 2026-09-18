-- ============================================================
-- SHARED CHAT THEME: one theme per conversation, not per user.
--
-- Before: chat_themes carried (conversation_id, user_id) rows — each member
-- saw their own look. Now the whole conversation shares one theme, and
-- changing it notifies the other members in realtime.
--
-- Data preserved: if members had differing personal themes, the one with the
-- most recent update wins as the shared theme (chat_themes.updated_at).
-- ============================================================

begin;

-- 1) Single shared row per conversation -------------------------------
-- New PK (conversation_id) is impossible until the old per-user rows are
-- collapsed, so dedupe first: keep the newest row per conversation.
create temp table _chat_theme_survivors on commit drop as
  select distinct on (conversation_id)
    conversation_id, user_id, background_color, background_url,
    bubble_color_mine, bubble_color_theirs, text_color_mine,
    text_color_theirs, accent_color, bubble_style, font_family,
    created_at, updated_at
  from public.chat_themes
  order by conversation_id, updated_at desc;

truncate public.chat_themes; -- rows are staged in the temp table

alter table public.chat_themes
  drop constraint chat_themes_pkey;

-- user_id keeps its NOT NULL + FK (whoever applied the shared theme).
alter table public.chat_themes
  add constraint chat_themes_pkey primary key (conversation_id);

insert into public.chat_themes
  (conversation_id, user_id, background_color, background_url,
   bubble_color_mine, bubble_color_theirs, text_color_mine,
   text_color_theirs, accent_color, bubble_style, font_family,
   created_at, updated_at)
select conversation_id, user_id, background_color, background_url,
       bubble_color_mine, bubble_color_theirs, text_color_mine,
       text_color_theirs, accent_color, bubble_style, font_family,
       created_at, updated_at
from _chat_theme_survivors;

-- 2) RLS: every conversation member owns the shared theme -------------
alter table public.chat_themes enable row level security;

-- (The pre-existing per-user *_own policies are dropped by the DB step that
-- ran alongside this migration; they cannot survive the new PK.)
drop policy if exists chat_themes_select on public.chat_themes;
drop policy if exists chat_themes_select_members on public.chat_themes;
drop policy if exists chat_themes_insert_own on public.chat_themes;
drop policy if exists chat_themes_update_own on public.chat_themes;
drop policy if exists chat_themes_delete_own on public.chat_themes;

create policy "chat_themes_member_all" on public.chat_themes
  for all using (
    is_conversation_member(conversation_id)
  ) with check (
    is_conversation_member(conversation_id)
  );

-- 3) Notify the other members when the theme changes ------------------
create or replace function public.notify_chat_theme_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notifications (user_id, actor_id, type, entity_type, entity_id, message)
  select cm.user_id,
         new.user_id,
         'chat_theme',
         'conversation',
         new.conversation_id::text,
         'changed the chat theme'
  from public.conversation_members cm
  where cm.conversation_id = new.conversation_id
    and cm.user_id <> new.user_id
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists chat_theme_notify on public.chat_themes;
create trigger chat_theme_notify
  after insert or update on public.chat_themes
  for each row execute function public.notify_chat_theme_changed();

-- 4) Realtime: members' chats restyle live ----------------------------
-- Supabase Realtime only replicates tables in its publication.
alter publication supabase_realtime add table public.chat_themes;

commit;
