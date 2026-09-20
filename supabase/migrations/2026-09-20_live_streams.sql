-- ============================================================
-- LIVE STREAMING — /videos "Go live"
--
-- Design (free-tier friendly, no paid media server):
--   The host's stream is P2P WebRTC (same transport class as 1:1
--   calls): the HOST relays its track to every viewer directly
--   (re-answer per viewer). Signaling runs over one Supabase
--   Realtime broadcast channel per stream, plus this table as the
--   discovery/state layer:
--
--   live_streams   — one row per broadcast (id, host, title, status)
--   live_viewers   — ephemeral presence rows; heartbeat from the
--                    client every 20s (see lib/social/live.ts), stale
--                    rows (>45s) count as gone and are pruned by
--                    prune_stale_live_viewers() which runs on every
--                    heartbeat insert.
--
-- Media never touches Supabase — only SDP/ICE signaling does, so the
-- free tier comfortably carries signaling for small streams.
-- Practical limit is the host's own uplink (~5–10 viewers on home
-- internet). The UI states this honestly.
-- ============================================================

create table if not exists public.live_streams (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references public.profiles(id) on delete cascade,
  title text not null default 'Live',
  status text not null default 'live' check (status in ('live', 'ended')),
  viewer_count integer not null default 0,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists live_streams_status_started_idx
  on public.live_streams (status, started_at desc);
create index if not exists live_streams_host_idx on public.live_streams (host_id);

create table if not exists public.live_viewers (
  stream_id uuid not null references public.live_streams(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (stream_id, user_id)
);

create index if not exists live_viewers_stream_idx on public.live_viewers (stream_id);

-- ------------------------------------------------------------
-- Presence: heartbeats are CLIENT UPSERTS (one row per viewer, PK
-- (stream_id, user_id)) with last_seen_at supplied explicitly —
-- PostgREST ON CONFLICT DO UPDATE only touches payload columns.
--
-- NO before-insert trigger here on purpose: a trigger that inserts
-- into its own table recurses until the stack limit is hit. Pruning
-- and count maintenance run in AFTER statement triggers instead:
--   after insert → prune stale rows, then refresh the count
--   after delete → refresh the count (also fired BY the prune —
--                  that terminates after one pass, no recursion)
-- ------------------------------------------------------------
create or replace function public.refresh_live_viewer_count(p_stream uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.live_streams
  set viewer_count = (
    select count(*) from public.live_viewers
    where stream_id = p_stream
      and last_seen_at >= now() - interval '45 seconds'
  )
  where id = p_stream;
end;
$$;

create or replace function public.prune_stale_live_viewers(p_stream uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.live_viewers
  where stream_id = p_stream
    and last_seen_at < now() - interval '45 seconds';
end;
$$;

-- AFTER INSERT (statement-level, transition table): prune stale rows for
-- every stream touched, then refresh those streams' counts.
create or replace function public.live_viewers_after_insert_fn()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.prune_stale_live_viewers(stream_id) from new_rows;

  update public.live_streams s
  set viewer_count = (
    select count(*) from public.live_viewers c
    where c.stream_id = s.id
      and c.last_seen_at >= now() - interval '45 seconds'
  )
  where s.id in (select stream_id from new_rows);

  return null;
end;
$$;

drop trigger if exists trg_live_viewers_after_insert on public.live_viewers;
create trigger trg_live_viewers_after_insert
  after insert on public.live_viewers
  referencing new table as new_rows
  for each statement
  execute function public.live_viewers_after_insert_fn();

-- AFTER DELETE (statement-level): the count refresh only. Fired both by
-- explicit leaves and by the prune above — single pass, no recursion.
create or replace function public.live_viewers_after_delete_fn()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.live_streams s
  set viewer_count = (
    select count(*) from public.live_viewers c
    where c.stream_id = s.id
      and c.last_seen_at >= now() - interval '45 seconds'
  )
  where s.id in (select stream_id from old_rows);

  return null;
end;
$$;

drop trigger if exists trg_live_viewers_after_delete on public.live_viewers;
create trigger trg_live_viewers_after_delete
  after delete on public.live_viewers
  referencing old table as old_rows
  for each statement
  execute function public.live_viewers_after_delete_fn();

-- ------------------------------------------------------------
-- "went live" notification to followers
-- ------------------------------------------------------------
create or replace function public.notify_live_started()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.notifications (user_id, actor_id, type, entity_type, entity_id, message, dedupe_key)
  select
    f.follower_id,
    new.host_id,
    'live_started',
    'live',
    new.id::text,
    'is live now: ' || new.title,
    format('live:%s:%s', new.id, f.follower_id)
  from public.follows f
  where f.following_id = new.host_id
  on conflict (dedupe_key) where dedupe_key is not null do nothing;

  return new;
end;
$$;

drop trigger if exists trg_notify_live_started on public.live_streams;
create trigger trg_notify_live_started
  after insert on public.live_streams
  for each row execute function public.notify_live_started();

-- ------------------------------------------------------------
-- Ending a stream (host only). One RPC does everything so the
-- beacon fallback (/api/live/end, no Authorization header) and
-- the normal client path behave identically: mark ended AND
-- clear the viewer roster (security definer bypasses RLS for
-- exactly this one operation).
-- ------------------------------------------------------------
create or replace function public.end_own_live_stream(p_stream uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.live_streams
  set status = 'ended', ended_at = now()
  where id = p_stream
    and host_id = (select auth.uid())
    and status = 'live';

  delete from public.live_viewers where stream_id = p_stream;
end;
$$;

-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------
alter table public.live_streams enable row level security;
alter table public.live_viewers enable row level security;

-- Anyone signed in can see live + past (ended) broadcasts; this powers
-- the "live now" rail and could power replay later.
drop policy if exists "live streams are readable by authenticated users" on public.live_streams;
create policy "live streams are readable by authenticated users"
  on public.live_streams for select to authenticated
  using (true);

-- Only the host manages their stream rows; no one else can fake a live row.
drop policy if exists "hosts manage their own streams" on public.live_streams;
create policy "hosts manage their own streams"
  on public.live_streams for all to authenticated
  using (host_id = (select auth.uid()))
  with check (host_id = (select auth.uid()));

-- Viewers read the roster (to show who's watching) and insert their own row.
drop policy if exists "viewers read live_viewers" on public.live_viewers;
create policy "viewers read live_viewers"
  on public.live_viewers for select to authenticated
  using (true);

drop policy if exists "viewers insert own heartbeat" on public.live_viewers;
create policy "viewers insert own heartbeat"
  on public.live_viewers for insert to authenticated
  with check (user_id = (select auth.uid()));

-- ON CONFLICT DO UPDATE (the heartbeat) needs the UPDATE policy to pass —
-- scoped to the viewer's own row, like insert/delete.
drop policy if exists "viewers update own heartbeat" on public.live_viewers;
create policy "viewers update own heartbeat"
  on public.live_viewers for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "viewers delete own row" on public.live_viewers;
create policy "viewers delete own row"
  on public.live_viewers for delete to authenticated
  using (user_id = (select auth.uid()));

-- ------------------------------------------------------------
-- Realtime: stream state changes broadcast to all clients
-- (live_streams), so viewers learn instantly when a stream ends;
-- live_viewers powers the in-stream viewer counter.
-- Idempotent (safe to re-run).
-- ------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'live_streams'
  ) then
    alter publication supabase_realtime add table public.live_streams;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'live_viewers'
  ) then
    alter publication supabase_realtime add table public.live_viewers;
  end if;
end;
$$;

-- Sanity checks:
--   select * from public.live_streams where status = 'live' order by started_at desc;
--   select * from public.live_viewers where stream_id = '<id>';
