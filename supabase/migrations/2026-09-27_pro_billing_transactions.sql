-- Enotes Pro billing transaction ledger
-- Run this migration once in Supabase SQL Editor.

create table if not exists public.billing_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null default 'maya',
  provider_payment_id text not null,
  provider_checkout_id text,
  request_reference_number text,
  plan text not null default 'pro',
  status text not null default 'pending',
  amount_cents integer not null default 0,
  currency text not null default 'PHP',
  billing_period_days integer not null default 30,
  paid_at timestamptz,
  period_start timestamptz,
  period_end timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  provider_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_transactions_provider_payment_unique
    unique (provider, provider_payment_id),
  constraint billing_transactions_amount_check
    check (amount_cents >= 0),
  constraint billing_transactions_period_check
    check (billing_period_days > 0),
  constraint billing_transactions_status_check
    check (status in ('pending','paid','failed','expired','cancelled','refunded'))
);

create index if not exists billing_transactions_user_id_idx
  on public.billing_transactions(user_id);

create index if not exists billing_transactions_status_idx
  on public.billing_transactions(status);

create index if not exists billing_transactions_created_at_idx
  on public.billing_transactions(created_at desc);

alter table public.billing_transactions enable row level security;

drop policy if exists "Users can view their own billing transactions"
on public.billing_transactions;

create policy "Users can view their own billing transactions"
on public.billing_transactions
for select
to authenticated
using (auth.uid() = user_id);

create or replace function public.set_billing_transactions_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists billing_transactions_updated_at
on public.billing_transactions;

create trigger billing_transactions_updated_at
before update on public.billing_transactions
for each row
execute function public.set_billing_transactions_updated_at();

-- Billing configuration used by the Maya checkout and billing page.
-- Change 34900 to your final price (PHP centavos) before enabling sales.
insert into public.platform_config (key, value)
values (
  'billing',
  '{
    "currency": "PHP",
    "provider": "maya",
    "pro": {
      "amount_cents": 34900,
      "billing_period_days": 30
    }
  }'::jsonb
)
on conflict (key) do update
set value = jsonb_set(
  jsonb_set(
    coalesce(public.platform_config.value, '{}'::jsonb),
    '{provider}',
    '"maya"'::jsonb,
    true
  ),
  '{pro,billing_period_days}',
  '30'::jsonb,
  true
),
updated_at = now();
