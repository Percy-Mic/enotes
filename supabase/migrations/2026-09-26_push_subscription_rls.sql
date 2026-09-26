-- ENOTES — push subscription security hardening
--
-- Browser push endpoints are capability URLs and must never be readable or
-- writable by another authenticated user. The server-side SECURITY DEFINER
-- delivery functions continue to read them for the intended recipient.

alter table public.push_subscriptions enable row level security;

revoke all on table public.push_subscriptions from anon;
grant select, insert, update, delete on table public.push_subscriptions to authenticated;

drop policy if exists "enotes push subscriptions own select" on public.push_subscriptions;
drop policy if exists "enotes push subscriptions own insert" on public.push_subscriptions;
drop policy if exists "enotes push subscriptions own update" on public.push_subscriptions;
drop policy if exists "enotes push subscriptions own delete" on public.push_subscriptions;

create policy "enotes push subscriptions own select"
on public.push_subscriptions
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "enotes push subscriptions own insert"
on public.push_subscriptions
for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "enotes push subscriptions own update"
on public.push_subscriptions
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "enotes push subscriptions own delete"
on public.push_subscriptions
for delete
to authenticated
using ((select auth.uid()) = user_id);
