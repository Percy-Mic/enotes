-- Quote reposts: extend the existing repost relationship without duplicating posts.
-- Safe to run after the existing repost migration.

alter table public.reposts
  add column if not exists id uuid default gen_random_uuid();

update public.reposts
set id = gen_random_uuid()
where id is null;

alter table public.reposts
  alter column id set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.reposts'::regclass
      and conname = 'reposts_id_key'
  ) then
    alter table public.reposts add constraint reposts_id_key unique (id);
  end if;
end $$;

alter table public.reposts
  add column if not exists quote text;

alter table public.reposts
  add column if not exists updated_at timestamptz not null default timezone('utc', now());

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.reposts'::regclass
      and conname = 'reposts_quote_length'
  ) then
    alter table public.reposts
      add constraint reposts_quote_length
      check (quote is null or char_length(quote) <= 20000);
  end if;
end $$;

create index if not exists reposts_created_at_idx
  on public.reposts (created_at desc);

create index if not exists reposts_user_created_at_idx
  on public.reposts (user_id, created_at desc);

alter table public.reposts enable row level security;

-- Replace every pre-existing repost policy so permissive OR-combination
-- cannot bypass the access rules below.
do $
declare
  policy_name text;
begin
  for policy_name in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'reposts'
  loop
    execute format('drop policy if exists %I on public.reposts', policy_name);
  end loop;
end $;

create policy "reposts_select"
on public.reposts for select
to authenticated
using (
  user_id = auth.uid()
  or exists (
    select 1 from public.posts p
    where p.id = reposts.post_id
      and (
        p.author_id = auth.uid()
        or p.visibility = 'public'
        or (
          p.visibility = 'followers'
          and exists (
            select 1 from public.follows f
            where f.follower_id = auth.uid()
              and f.following_id = p.author_id
          )
        )
      )
  )
);

create policy "reposts_insert"
on public.reposts for insert
to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.posts p
    where p.id = reposts.post_id
      and p.deleted_at is null
      and p.author_id is not null
      and (
        p.visibility = 'public'
        or p.author_id = auth.uid()
        or (
          p.visibility = 'followers'
          and exists (
            select 1 from public.follows f
            where f.follower_id = auth.uid()
              and f.following_id = p.author_id
          )
        )
      )
  )
);

create policy "reposts_update_own"
on public.reposts for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "reposts_delete_own"
on public.reposts for delete
to authenticated
using (user_id = auth.uid());

-- Keep notification creation server-side and idempotent.
create or replace function public.notify_post_repost()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  post_author uuid;
  actor_name text;
begin
  select p.author_id into post_author
  from public.posts p
  where p.id = new.post_id;

  if post_author is null or post_author = new.user_id then
    return new;
  end if;

  select coalesce(username, full_text_name, 'Someone')
    into actor_name
  from public.profiles
  where id = new.user_id;

  insert into public.notifications (
    user_id,
    actor_id,
    type,
    entity_type,
    entity_id,
    message,
    dedupe_key
  )
  values (
    post_author,
    new.user_id,
    'repost',
    'post',
    new.post_id::text,
    case
      when nullif(trim(new.quote), '') is not null
        then actor_name || ' quoted your post: "' ||
             left(regexp_replace(trim(new.quote), '[[:space:]]+', ' ', 'g'), 120) || '"'
      else actor_name || ' reposted your post'
    end,
    'repost:' || new.post_id::text || ':' || new.user_id::text
  )
  on conflict (dedupe_key) where dedupe_key is not null do update
    set message = excluded.message,
        actor_id = excluded.actor_id,
        created_at = timezone('utc', now()),
        read = false;

  return new;
end;
$$;

drop trigger if exists trg_notify_post_repost on public.reposts;
create trigger trg_notify_post_repost
after insert or update of quote on public.reposts
for each row execute function public.notify_post_repost();

-- Add repost to the application's notification type contract.
