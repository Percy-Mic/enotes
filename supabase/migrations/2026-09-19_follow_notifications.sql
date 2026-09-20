-- ============================================================
-- FOLLOW NOTIFICATIONS
--
-- 1. notify_new_follow: when a row lands in follows, the person
--    being followed gets a 'follow' notification (deduped).
-- 2. notify_new_follow_request: pending follow_requests notify
--    the target ('follow_request'), so requesters don't rely on
--    the target noticing a profile badge.
-- follow_accept is already written by respond_follow_request().
-- All inserts are security-definer with dedupe keys so replays
-- can't spam duplicates.
-- ============================================================

create or replace function public.notify_new_follow()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.notifications (user_id, actor_id, type, entity_type, entity_id, message, dedupe_key)
  values (
    new.following_id,
    new.follower_id,
    'follow',
    'profile',
    new.follower_id::text,
    'started following you',
    format('follow:%s:%s', new.follower_id, new.following_id)
  )
  on conflict (dedupe_key) where dedupe_key is not null do nothing;
  return new;
end;
$$;

drop trigger if exists trg_notify_new_follow on public.follows;
create trigger trg_notify_new_follow
  after insert on public.follows
  for each row execute function public.notify_new_follow();

create or replace function public.notify_new_follow_request()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status <> 'pending' then
    return new;
  end if;
  insert into public.notifications (user_id, actor_id, type, entity_type, entity_id, message, dedupe_key)
  values (
    new.target_id,
    new.requester_id,
    'follow_request',
    'profile',
    new.requester_id::text,
    'requested to follow you',
    format('follow_request:%s:%s', new.requester_id, new.target_id)
  )
  on conflict (dedupe_key) where dedupe_key is not null do nothing;
  return new;
end;
$$;

drop trigger if exists trg_notify_new_follow_request on public.follow_requests;
create trigger trg_notify_new_follow_request
  after insert on public.follow_requests
  for each row execute function public.notify_new_follow_request();
