create table if not exists public.video_ai_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  project_id uuid null references public.video_projects(id) on delete cascade,
  operation text not null,
  provider text not null default 'auto',
  status text not null default 'queued' check (status in ('queued','processing','completed','failed','cancelled')),
  progress integer not null default 0 check (progress between 0 and 100),
  input jsonb not null default '{}'::jsonb,
  output jsonb,
  error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists video_ai_jobs_user_created_idx
  on public.video_ai_jobs(user_id, created_at desc);

create index if not exists video_ai_jobs_project_created_idx
  on public.video_ai_jobs(project_id, created_at desc);

alter table public.video_ai_jobs enable row level security;

drop policy if exists "video ai jobs own rows" on public.video_ai_jobs;
create policy "video ai jobs own rows"
  on public.video_ai_jobs
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
