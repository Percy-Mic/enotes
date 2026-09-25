/* ============================================================================
   2026-09-25_social_media_storage.sql

   Feed uploads use the public "post-media" bucket and store objects as:
     post-media/<auth.uid()>/<uuid>.<ext>

   This migration is idempotent and fixes the common mobile upload failure where
   the database tables exist but the Storage bucket/RLS policies do not.
   ==========================================================================*/

begin;

do $$
begin
  if not exists (select 1 from storage.buckets where id = 'post-media') then
    insert into storage.buckets (id, name, public, file_size_limit)
    values ('post-media', 'post-media', true, 26214400);
  else
    update storage.buckets
       set public = true,
           file_size_limit = greatest(coalesce(file_size_limit, 0), 26214400)
     where id = 'post-media';
  end if;
end $$;

drop policy if exists "post_media_public_read" on storage.objects;
drop policy if exists "post_media_owner_insert" on storage.objects;
drop policy if exists "post_media_owner_update" on storage.objects;
drop policy if exists "post_media_owner_delete" on storage.objects;

create policy "post_media_public_read"
on storage.objects for select
using (bucket_id = 'post-media');

create policy "post_media_owner_insert"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'post-media'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "post_media_owner_update"
on storage.objects for update
to authenticated
using (
  bucket_id = 'post-media'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'post-media'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "post_media_owner_delete"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'post-media'
  and (storage.foldername(name))[1] = auth.uid()::text
);

commit;
