-- Enotes provider-agnostic billing and creator commerce foundation.
-- Run this migration once in Supabase SQL Editor.
--
-- This schema deliberately stores payment metadata, not government/KYC documents.
-- Provider onboarding/KYC remains with the payment provider (Maya, Stripe, PayPal,
-- GCash gateway, etc.). Provider credentials are environment secrets, never DB data.

create table if not exists public.billing_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,

  -- Provider-independent transaction identity.
  provider text not null,
  provider_payment_id text,
  provider_checkout_id text,
  provider_customer_id text,
  request_reference_number text,

  -- What the customer bought.
  transaction_type text not null default 'pro_subscription',
  plan text,
  product_id uuid,
  status text not null default 'pending',

  amount_cents integer not null default 0,
  currency text not null default 'PHP',
  billing_period_days integer,

  paid_at timestamptz,
  period_start timestamptz,
  period_end timestamptz,

  metadata jsonb not null default '{}'::jsonb,
  provider_payload jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint billing_transactions_provider_payment_unique
    unique (provider, provider_payment_id),

  constraint billing_transactions_provider_check
    check (provider in ('maya', 'stripe', 'paypal', 'gcash', 'other')),

  constraint billing_transactions_type_check
    check (transaction_type in ('pro_subscription', 'template_purchase', 'asset_purchase', 'other')),

  constraint billing_transactions_status_check
    check (status in (
      'pending',
      'paid',
      'failed',
      'expired',
      'cancelled',
      'refunded',
      'partially_refunded',
      'disputed'
    )),

  constraint billing_transactions_amount_check
    check (amount_cents >= 0),

  constraint billing_transactions_period_check
    check (billing_period_days is null or billing_period_days > 0)
);

create index if not exists billing_transactions_user_id_idx
  on public.billing_transactions(user_id);

create index if not exists billing_transactions_provider_idx
  on public.billing_transactions(provider);

create index if not exists billing_transactions_status_idx
  on public.billing_transactions(status);

create index if not exists billing_transactions_type_idx
  on public.billing_transactions(transaction_type);

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

drop policy if exists "Users can create their own billing transactions"
on public.billing_transactions;

create policy "Users can create their own billing transactions"
on public.billing_transactions
for insert
to authenticated
with check (auth.uid() = user_id);

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


-- Keep the existing subscriptions table as the application's plan state,
-- but add provider-neutral fields needed for both prepaid and recurring providers.
alter table public.subscriptions
  add column if not exists provider_customer_id text,
  add column if not exists provider_transaction_id text,
  add column if not exists billing_period_days integer,
  add column if not exists started_at timestamptz,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create index if not exists subscriptions_user_id_idx
  on public.subscriptions(user_id);

create index if not exists subscriptions_period_end_idx
  on public.subscriptions(current_period_end);

-- The current enotes Pro flow is a one-time 30-day entitlement, so a user
-- should have one current plan row rather than accumulating parallel active rows.
create unique index if not exists subscriptions_one_row_per_user_idx
  on public.subscriptions(user_id);


-- Existing purchases are retained for compatibility with the template system.
alter table public.purchases
  add column if not exists provider_checkout_id text,
  add column if not exists provider_customer_id text,
  add column if not exists transaction_id uuid references public.billing_transactions(id),
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create index if not exists purchases_transaction_id_idx
  on public.purchases(transaction_id);


-- Creator identity/settings are intentionally separate from provider KYC data.
create table if not exists public.creator_profiles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  display_name text not null default '',
  bio text not null default '',
  avatar_url text,
  status text not null default 'pending',
  payout_provider text,
  payout_account_id text,
  payout_email text,
  verification_status text not null default 'unverified',
  country_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint creator_profiles_status_check
    check (status in ('pending', 'active', 'suspended', 'rejected')),

  constraint creator_profiles_verification_check
    check (verification_status in ('unverified', 'pending', 'verified', 'rejected'))
);

alter table public.creator_profiles enable row level security;

drop policy if exists "Creators can view their own creator profile"
on public.creator_profiles;

create policy "Creators can view their own creator profile"
on public.creator_profiles
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Creators can create their own creator profile"
on public.creator_profiles;

create policy "Creators can create their own creator profile"
on public.creator_profiles
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Creators can update their own creator profile"
on public.creator_profiles;

create policy "Creators can update their own creator profile"
on public.creator_profiles
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);


-- A separate purchase record lets template/asset commerce mature without
-- overloading the Pro subscription table.
create table if not exists public.template_purchases (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references public.profiles(id) on delete cascade,
  template_id uuid not null references public.templates(id) on delete restrict,
  transaction_id uuid references public.billing_transactions(id),
  price_cents integer not null default 0,
  currency text not null default 'PHP',
  status text not null default 'pending',
  purchased_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint template_purchases_price_check
    check (price_cents >= 0),

  constraint template_purchases_status_check
    check (status in ('pending', 'paid', 'refunded', 'disputed')),

  constraint template_purchases_unique_buyer_template
    unique (buyer_id, template_id)
);

create index if not exists template_purchases_template_id_idx
  on public.template_purchases(template_id);

create index if not exists template_purchases_transaction_id_idx
  on public.template_purchases(transaction_id);

alter table public.template_purchases enable row level security;

drop policy if exists "Buyers can view their template purchases"
on public.template_purchases;

create policy "Buyers can view their template purchases"
on public.template_purchases
for select
to authenticated
using (auth.uid() = buyer_id);


-- Extend the existing creator earnings ledger with transaction and payout
-- reconciliation fields. Existing columns remain compatible with /studio.
alter table public.creator_earnings
  add column if not exists transaction_id uuid references public.billing_transactions(id),
  add column if not exists payment_fee_cents integer not null default 0,
  add column if not exists available_at timestamptz,
  add column if not exists paid_at timestamptz;

create index if not exists creator_earnings_transaction_id_idx
  on public.creator_earnings(transaction_id);

create index if not exists creator_earnings_creator_status_idx
  on public.creator_earnings(creator_id, status);


-- Extend the existing payout ledger without storing sensitive KYC documents.
alter table public.payouts
  add column if not exists provider_customer_id text,
  add column if not exists processed_at timestamptz,
  add column if not exists failure_reason text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create index if not exists payouts_creator_status_idx
  on public.payouts(creator_id, status);


-- Provider configuration is data-driven. Keep secrets in Vercel/Supabase
-- environment configuration, never in platform_config.
insert into public.platform_config (key, value)
values (
  'billing',
  '{
    "currency": "PHP",
    "pro": {
      "amount_cents": 34900,
      "billing_period_days": 30,
      "auto_renew": false
    },
    "providers": {
      "maya": { "enabled": true, "checkout": "hosted" },
      "stripe": { "enabled": false },
      "paypal": { "enabled": false },
      "gcash": { "enabled": false }
    }
  }'::jsonb
)
on conflict (key) do update
set value = jsonb_set(
  jsonb_set(
    coalesce(public.platform_config.value, '{}'::jsonb),
    '{pro,billing_period_days}',
    '30'::jsonb,
    true
  ),
  '{pro,auto_renew}',
  'false'::jsonb,
  true
),
updated_at = now();
