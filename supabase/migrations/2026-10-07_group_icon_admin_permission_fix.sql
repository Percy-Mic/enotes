/* ============================================================================
   2026-10-07 — Group icon admin permission repair

   The chat UI correctly allows group creators/admins to edit the group icon,
   but Storage RLS is the final gate for the actual upload. Keep the permission
   rule identical across conversation updates and avatars storage:

     - group creator
     - conversation role = admin
     - conversation role = moderator (legacy admin role)

   This migration is intentionally self-contained so it repairs databases where
   the earlier group-icon policy was not applied or the helper function differed.
   ========================================================================== */

begin;

create or replace function public.is_conversation_admin(conv uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.conversations c
     where c.id = conv
       and c.created_by = auth.uid()
  )
  or exists (
    select 1
      from public.conversation_members m
     where m.conversation_id = conv
       and m.user_id = auth.uid()
       and m.role in ('admin', 'moderator')
  );
$$;

grant execute on function public.is_conversation_admin(uuid) to authenticated;

drop policy if exists "avatars_group_read" on storage.objects;
drop policy if exists "avatars_group_write" on storage.objects;
drop policy if exists "avatars_group_manage" on storage.objects;
drop policy if exists "avatars_group_delete" on storage.objects;

create policy "avatars_group_read"
on storage.objects
for select
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] like 'group-%'
);

create policy "avatars_group_write"
on storage.objects
for insert
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] ~
      '^group-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  and public.is_conversation_admin(
        substr((storage.foldername(name))[1] from 7)::uuid
      )
);

create policy "avatars_group_manage"
on storage.objects
for update
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] ~
      '^group-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  and public.is_conversation_admin(
        substr((storage.foldername(name))[1] from 7)::uuid
      )
)
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] ~
      '^group-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  and public.is_conversation_admin(
        substr((storage.foldername(name))[1] from 7)::uuid
      )
);

create policy "avatars_group_delete"
on storage.objects
for delete
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] ~
      '^group-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  and public.is_conversation_admin(
        substr((storage.foldername(name))[1] from 7)::uuid
      )
);

notify pgrst, 'reload schema';

commit;
