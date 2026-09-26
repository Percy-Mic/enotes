-- Public-feed read access for signed-out visitors.
--
-- Only rows explicitly marked visibility='public' are exposed to the anon role.
-- Write/update/delete access remains governed by the existing authenticated policies.

alter table public.posts enable row level security;

grant select on table public.posts to anon;

drop policy if exists "Public posts are viewable by everyone" on public.posts;
create policy "Public posts are viewable by everyone"
  on public.posts
  for select
  to anon
  using (visibility = 'public');

create index if not exists posts_public_created_at_idx
  on public.posts (created_at desc)
  where visibility = 'public';
