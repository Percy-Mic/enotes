-- Keep the production push endpoint aligned with the current enotes deployment.
-- This is idempotent and intentionally changes only the public push endpoint.
insert into public.platform_config (key, value)
values (
  'push_endpoint',
  '"https://enotes-ph.vercel.app/api/push/send"'::jsonb
)
on conflict (key)
do update set value = excluded.value;
