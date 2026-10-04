-- ============================================================
-- enotes production domain migration
-- Canonical free Vercel domain: https://enotes-ph.vercel.app
--
-- Run this migration against the production Supabase database.
-- It updates the stored Web Push endpoint so database-triggered
-- notifications call the current production deployment.
-- ============================================================

update public.platform_config
set value = '"https://enotes-ph.vercel.app/api/push/send"'::jsonb
where key = 'push_endpoint';

insert into public.platform_config (key, value)
select
  'push_endpoint',
  '"https://enotes-ph.vercel.app/api/push/send"'::jsonb
where not exists (
  select 1
  from public.platform_config
  where key = 'push_endpoint'
);
