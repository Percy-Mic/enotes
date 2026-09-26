-- ============================================================
-- ENOTES MESSENGER-STYLE PUSH NOTIFICATIONS
-- ============================================================

-- Message notification rows already come from
-- notify_new_message(). This migration only upgrades the
-- push payload and makes the message notification richer.

create or replace function public.notify_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  endpoint text;
  secret text;
  payload jsonb;

  sender_name text;
  sender_avatar text;

  notification_title text;
  notification_body text;
  notification_url text;
  notification_tag text;
  notification_type text;
  notification_icon text;
begin
  select value #>> '{}'
    into endpoint
  from public.platform_config
  where key = 'push_endpoint';

  if endpoint is null or endpoint = '' then
    return new;
  end if;

  select value #>> '{}'
    into secret
  from public.platform_config
  where key = 'push_send_secret';

  if secret is null or secret = '' then
    return new;
  end if;

  notification_title :=
    'enotes';

  notification_body :=
    coalesce(
      nullif(new.message, ''),
      'You have a new notification'
    );

  notification_url :=
    '/notifications';

  notification_tag :=
    new.id::text;

  notification_type :=
    'default';

  notification_icon :=
    '/icon.svg';

  if new.type = 'message' then

    select
      coalesce(
        nullif(p.full_text_name, ''),
        nullif(p.username, ''),
        'Someone'
      ),
      nullif(p.avatar_url, '')
    into
      sender_name,
      sender_avatar
    from public.profiles p
    where p.id = new.actor_id;

    notification_title :=
      coalesce(
        nullif(sender_name, ''),
        'New message'
      );

    notification_body :=
      coalesce(
        nullif(new.message, ''),
        'Sent you a message'
      );

    if new.entity_id is not null
       and btrim(new.entity_id) <> '' then

      notification_url :=
        '/messages/' || new.entity_id;

      notification_tag :=
        'message:conversation:' || new.entity_id;

    else

      notification_url :=
        '/messages';

      notification_tag :=
        'message:' || new.id::text;

    end if;

    notification_type :=
      'message';

    if sender_avatar is not null
       and btrim(sender_avatar) <> '' then

      notification_icon :=
        sender_avatar;

    end if;

  end if;

  payload := jsonb_build_object(
    'userId',
    new.user_id,

    'title',
    notification_title,

    'body',
    notification_body,

    'url',
    notification_url,

    'tag',
    notification_tag,

    'type',
    notification_type,

    'icon',
    notification_icon,

    'badge',
    '/icon.svg',

    'notificationId',
    new.id::text,

    'conversationId',
    case
      when new.type = 'message'
        then new.entity_id
      else null
    end,

    'senderId',
    case
      when new.type = 'message'
        then new.actor_id
      else null
    end,

    'senderName',
    case
      when new.type = 'message'
        then sender_name
      else null
    end,

    'targets',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'endpoint',
            s.endpoint,

            'p256dh',
            s.p256dh,

            'auth',
            s.auth_key
          )
        )
        from public.push_subscriptions s
        where s.user_id = new.user_id
      ),
      '[]'::jsonb
    )
  );

  perform net.http_post(
    url := endpoint,

    headers := jsonb_build_object(
      'Content-Type',
      'application/json',

      'x-push-send-secret',
      secret
    ),

    body := payload,

    timeout_milliseconds := 5000
  );

  return new;
end;
$$;

drop trigger if exists trg_notify_push
on public.notifications;

create trigger trg_notify_push
after insert on public.notifications
for each row
execute function public.notify_push();
