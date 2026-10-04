/* 2026-10-04 — repair template moderation RPC argument-name drift
   Fixes live PostgREST errors such as:
   "Could not find function public.admin_reject_template(p_note, p_template_id)"
   PostgreSQL cannot rename input parameters with CREATE OR REPLACE, so any
   existing overload with the same UUID/TEXT types is dropped first.
*/
begin;

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure::text as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'admin_approve_template',
         'admin_reject_template',
         'admin_archive_template'
       )
       and pg_get_function_identity_arguments(p.oid) in (
         'uuid, text',
         'uuid, text, text',
         'p_template_id uuid',
         'p_note text, p_template_id uuid',
         'p_template_id uuid, p_note text'
       )
  loop
    execute format('drop function if exists %s', r.sig);
  end loop;
end $$;

create function public.admin_approve_template(
  p_template_id uuid,
  p_note text default null
)
returns setof public.templates
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous_status text;
begin
  if not public.is_current_user_admin() then
    raise exception 'Admins only';
  end if;

  select status into v_previous_status
    from public.templates
   where id = p_template_id
   for update;

  if not found then
    raise exception 'Template not found';
  end if;

  update public.templates
     set status = 'published',
         published_at = now(),
         reviewed_at = now(),
         reviewed_by = auth.uid(),
         review_note = nullif(btrim(coalesce(p_note, '')), ''),
         rejection_reason = null
   where id = p_template_id;

  insert into public.template_reviews
    (template_id, reviewer_id, action, note, previous_status, new_status)
  values
    (p_template_id, auth.uid(), 'approved', nullif(btrim(coalesce(p_note, '')), ''),
     v_previous_status, 'published');

  return query
    select * from public.templates where id = p_template_id;
end;
$$;

create function public.admin_reject_template(
  p_template_id uuid,
  p_note text default null
)
returns setof public.templates
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous_status text;
  v_note text;
begin
  if not public.is_current_user_admin() then
    raise exception 'Admins only';
  end if;

  v_note := left(btrim(coalesce(p_note, '')), 500);

  if v_note = '' then
    raise exception 'A rejection note is required';
  end if;

  select status into v_previous_status
    from public.templates
   where id = p_template_id
   for update;

  if not found then
    raise exception 'Template not found';
  end if;

  update public.templates
     set status = 'rejected',
         reviewed_at = now(),
         reviewed_by = auth.uid(),
         rejection_reason = v_note,
         review_note = v_note
   where id = p_template_id;

  insert into public.template_reviews
    (template_id, reviewer_id, action, note, previous_status, new_status)
  values
    (p_template_id, auth.uid(), 'rejected', v_note,
     v_previous_status, 'rejected');

  return query
    select * from public.templates where id = p_template_id;
end;
$$;

create function public.admin_archive_template(
  p_template_id uuid,
  p_note text default null
)
returns setof public.templates
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous_status text;
  v_note text;
begin
  if not public.is_current_user_admin() then
    raise exception 'Admins only';
  end if;

  v_note := nullif(btrim(coalesce(p_note, '')), '');

  select status into v_previous_status
    from public.templates
   where id = p_template_id
   for update;

  if not found then
    raise exception 'Template not found';
  end if;

  update public.templates
     set status = 'archived',
         reviewed_at = now(),
         reviewed_by = auth.uid(),
         review_note = v_note
   where id = p_template_id;

  insert into public.template_reviews
    (template_id, reviewer_id, action, note, previous_status, new_status)
  values
    (p_template_id, auth.uid(), 'archived', v_note,
     v_previous_status, 'archived');

  return query
    select * from public.templates where id = p_template_id;
end;
$$;

grant execute on function public.admin_approve_template(uuid, text) to authenticated;
grant execute on function public.admin_reject_template(uuid, text) to authenticated;
grant execute on function public.admin_archive_template(uuid, text) to authenticated;

notify pgrst, 'reload schema';

commit;
