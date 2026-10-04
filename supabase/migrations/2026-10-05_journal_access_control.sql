/*
  enotes journal access control
  Owner: full control.
  Editor: may edit journal/pages only when explicitly shared with
          can_edit=true or role='editor' and status='active'.
  Commenter/viewer/link readers: read-only.
*/

create or replace function public.journal_role(p_journal_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when exists (
      select 1 from public.journals j
      where j.id = p_journal_id and j.owner_id = auth.uid()
    ) then 'owner'
    when exists (
      select 1 from public.journal_shares s
      where s.journal_id = p_journal_id
        and s.shared_with = auth.uid()
        and s.status = 'active'
        and (s.can_edit = true or s.role = 'editor')
    ) then 'editor'
    when exists (
      select 1 from public.journal_shares s
      where s.journal_id = p_journal_id
        and s.shared_with = auth.uid()
        and s.status = 'active'
    ) then 'viewer'
    else null
  end;
$$;

create or replace function public.can_view_journal(p_journal_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.journals j
    where j.id = p_journal_id
      and (
        j.owner_id = auth.uid()
        or j.visibility in ('public', 'link')
        or exists (
          select 1 from public.journal_shares s
          where s.journal_id = j.id
            and s.shared_with = auth.uid()
            and s.status = 'active'
        )
      )
  );
$$;

revoke all on function public.journal_role(uuid) from public;
grant execute on function public.journal_role(uuid) to authenticated;

revoke all on function public.can_view_journal(uuid) from public;
grant execute on function public.can_view_journal(uuid) to authenticated;

alter table public.journals enable row level security;
alter table public.journal_pages enable row level security;
alter table public.journal_shares enable row level security;

/*
  RLS policies are permissive (OR-ed), so leaving an older broad UPDATE policy
  in place would still allow unauthorized edits. Remove every pre-existing
  policy on these three tables before installing the owner/editor policies.
*/
do $
declare
  p record;
begin
  for p in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('journals', 'journal_pages', 'journal_shares')
  loop
    execute format(
      'drop policy if exists %I on %I.%I',
      p.policyname,
      p.schemaname,
      p.tablename
    );
  end loop;
end
$;

drop policy if exists journals_select_access on public.journals;
drop policy if exists journals_insert_owner on public.journals;
drop policy if exists journals_update_owner on public.journals;
drop policy if exists journals_delete_owner on public.journals;

create policy journals_select_access
on public.journals for select to authenticated
using (public.can_view_journal(id));

create policy journals_insert_owner
on public.journals for insert to authenticated
with check (owner_id = auth.uid());

create policy journals_update_owner
on public.journals for update to authenticated
using (public.journal_role(id) = 'owner')
with check (owner_id = auth.uid());

create policy journals_delete_owner
on public.journals for delete to authenticated
using (public.journal_role(id) = 'owner');

drop policy if exists journal_pages_select_access on public.journal_pages;
drop policy if exists journal_pages_insert_editor on public.journal_pages;
drop policy if exists journal_pages_update_editor on public.journal_pages;
drop policy if exists journal_pages_delete_editor on public.journal_pages;

create policy journal_pages_select_access
on public.journal_pages for select to authenticated
using (public.can_view_journal(journal_id));

create policy journal_pages_insert_editor
on public.journal_pages for insert to authenticated
with check (public.journal_role(journal_id) in ('owner', 'editor'));

create policy journal_pages_update_editor
on public.journal_pages for update to authenticated
using (public.journal_role(journal_id) in ('owner', 'editor'))
with check (public.journal_role(journal_id) in ('owner', 'editor'));

create policy journal_pages_delete_editor
on public.journal_pages for delete to authenticated
using (public.journal_role(journal_id) in ('owner', 'editor'));

drop policy if exists journal_shares_select_participant on public.journal_shares;
drop policy if exists journal_shares_insert_owner on public.journal_shares;
drop policy if exists journal_shares_update_owner on public.journal_shares;
drop policy if exists journal_shares_delete_owner on public.journal_shares;

create policy journal_shares_select_participant
on public.journal_shares for select to authenticated
using (
  shared_with = auth.uid()
  or exists (
    select 1 from public.journals j
    where j.id = journal_shares.journal_id and j.owner_id = auth.uid()
  )
);

create policy journal_shares_insert_owner
on public.journal_shares for insert to authenticated
with check (
  exists (
    select 1 from public.journals j
    where j.id = journal_shares.journal_id and j.owner_id = auth.uid()
  )
);

create policy journal_shares_update_owner
on public.journal_shares for update to authenticated
using (
  exists (
    select 1 from public.journals j
    where j.id = journal_shares.journal_id and j.owner_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.journals j
    where j.id = journal_shares.journal_id and j.owner_id = auth.uid()
  )
);

create policy journal_shares_delete_owner
on public.journal_shares for delete to authenticated
using (
  exists (
    select 1 from public.journals j
    where j.id = journal_shares.journal_id and j.owner_id = auth.uid()
  )
);
