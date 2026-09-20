-- ============================================================
-- COMMUNITY ICON IMAGES — add communities.icon_url
--
-- Lets a community carry an uploaded image icon alongside (and
-- preferred over) the emoji badge. Uploads go to the existing
-- 'avatars' bucket under community-<id>/, so the cover policies
-- (can_manage_community_cover: creator or moderator) authorize
-- them with no new storage rules.
--
-- Platform admins (profiles.is_admin) may also change any
-- community's icon; the update policy below adds that path.
-- ============================================================

alter table public.communities add column if not exists icon_url text;

-- Update access: creator, moderator, or platform admin (NOT plain members).
drop policy if exists communities_update_with_admin on public.communities;
create policy communities_update_with_admin on public.communities
  for update to authenticated
  using (
    public.is_current_user_admin()
    or created_by = auth.uid()
    or exists (
      select 1 from public.community_members m
      where m.community_id = id
        and m.user_id = auth.uid()
        and m.role = 'moderator'
    )
  )
  with check (
    public.is_current_user_admin()
    or created_by = auth.uid()
    or exists (
      select 1 from public.community_members m
      where m.community_id = id
        and m.user_id = auth.uid()
        and m.role = 'moderator'
    )
  );

-- Platform admins may upload/replace/delete icons in any community-<id>/
-- folder, reusing the cover helper plus an admin branch.
create or replace function public.can_manage_community_icon(p_path text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_current_user_admin()
  or exists (
    select 1
      from public.communities c
      join public.community_members m on m.community_id = c.id
     where split_part(p_path, '/', 1) = 'community-' || c.id::text
       and (
         c.created_by = auth.uid()
         or (m.user_id = auth.uid() and m.role = 'moderator')
       )
  );
$$;

drop policy if exists avatars_community_icon_insert on storage.objects;
create policy avatars_community_icon_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and public.can_manage_community_icon(name)
  );

drop policy if exists avatars_community_icon_update on storage.objects;
create policy avatars_community_icon_update on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and public.can_manage_community_icon(name))
  with check (bucket_id = 'avatars' and public.can_manage_community_icon(name));

drop policy if exists avatars_community_icon_delete on storage.objects;
create policy avatars_community_icon_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and public.can_manage_community_icon(name));
