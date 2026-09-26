-- ============================================================
-- MESSAGE PUSH NOTIFICATIONS
-- ============================================================

create or replace function public.notify_new_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notifications (
    user_id,
    actor_id,
    type,
    entity_type,
    entity_id,
    message,
    dedupe_key
  )
  select
    cm.user_id,
    new.sender_id,
    'message',
    'conversation',
    new.conversation_id::text,
    case
      when new.message_type = 'text'
        then left(coalesce(nullif(btrim(new.content), ''), 'Sent you a message'), 160)
      when new.message_type = 'image' then 'Sent you a photo'
      when new.message_type = 'video' then 'Sent you a video'
      when new.message_type = 'audio' then 'Sent you a voice message'
      when new.message_type = 'gif' then 'Sent you a GIF'
      when new.message_type = 'sticker' then 'Sent you a sticker'
      when new.message_type = 'file' then 'Sent you a file'
      else 'Sent you a message'
    end,
    'message:' || new.id::text || ':' || cm.user_id::text
  from public.conversation_members cm
  join public.user_settings us on us.user_id = cm.user_id
  where cm.conversation_id = new.conversation_id
    and cm.user_id <> new.sender_id
    and cm.muted = false
    and us.notify_messages = true;

  return new;
end;
$$;

drop trigger if exists trg_notify_new_message on public.messages;

create trigger trg_notify_new_message
  after insert on public.messages
  for each row
  execute function public.notify_new_message();
