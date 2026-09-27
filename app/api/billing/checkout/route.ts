import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const VALID_PLANS = new Set(['pro']);

type BillingConfig = {
  pro?: { amount_cents?: number; billing_period_days?: number; auto_renew?: boolean };
  providers?: Record<string, { enabled?: boolean; checkout?: string }>;
};

async function billingConfig(): Promise<BillingConfig> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('platform_config')
    .select('value')
    .eq('key', 'billing')
    .maybeSingle();

  return (data?.value as BillingConfig | null) ?? {};
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { plan?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const plan = body.plan ?? '';
  if (!VALID_PLANS.has(plan)) {
    return NextResponse.json({ error: 'Only the Pro plan is available.' }, { status: 400 });
  }

  const cfg = await billingConfig();
  const publicKey = process.env.MAYA_PUBLIC_KEY;
  if (cfg.providers?.maya?.enabled === false || !publicKey) {
    return NextResponse.json({ error: 'Maya checkout is not available yet.' }, { status: 501 });
  }

  const amountCents = Number(cfg.pro?.amount_cents ?? 0);
  const billingPeriodDays = Number(cfg.pro?.billing_period_days ?? 30);
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    return NextResponse.json(
      { error: 'Pro pricing is not configured. Set billing.pro.amount_cents in platform_config.' },
      { status: 500 }
    );
  }
  if (!Number.isInteger(billingPeriodDays) || billingPeriodDays <= 0) {
    return NextResponse.json({ error: 'Pro billing period is not configured correctly.' }, { status: 500 });
  }

  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? new URL(request.url).origin;
  // Maya requires requestReferenceNumber to be 1–36 characters.
  // Keep it deterministic enough to trace while staying inside that limit.
  const requestReferenceNumber = `en-${user.id.replaceAll('-', '').slice(0, 20)}-${Date.now().toString(36)}`;
  const amount = (amountCents / 100).toFixed(2);

  const payload = {
    totalAmount: {
      value: amount,
      currency: 'PHP',
    },
    buyer: {
      firstName: user.user_metadata?.first_name ?? undefined,
      lastName: user.user_metadata?.last_name ?? undefined,
      contact: {
        email: user.email ?? undefined,
      },
    },
    items: [
      {
        name: `enotes Pro — ${billingPeriodDays} days`,
        quantity: 1,
        totalAmount: {
          value: amount,
          currency: 'PHP',
        },
      },
    ],
    redirectUrl: {
      success: `${origin}/settings/billing?status=success`,
      failure: `${origin}/settings/billing?status=failed`,
      cancel: `${origin}/settings/billing?status=cancelled`,
    },
    requestReferenceNumber,
    metadata: {
      user_id: user.id,
      plan,
      transaction_type: 'pro_subscription',
      billing_period_days: String(billingPeriodDays),
      auto_renew: String(cfg.pro?.auto_renew === true),
    },
  };

  const apiBase = process.env.MAYA_ENV === 'production'
    ? 'https://pg.maya.ph'
    : 'https://pg-sandbox.paymaya.com';

  const encodedKey = Buffer.from(`${publicKey}:`).toString('base64');
  const response = await fetch(`${apiBase}/checkout/v1/checkouts`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${encodedKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    cache: 'no-store',
  });

  const json = (await response.json().catch(() => ({}))) as {
    redirectUrl?: string;
    checkoutId?: string;
    id?: string;
    message?: string;
    error?: string;
  };

  if (!response.ok || !json.redirectUrl) {
    return NextResponse.json(
      { error: json.message ?? json.error ?? 'Maya Checkout could not be created.' },
      { status: 502 }
    );
  }

  const checkoutId = json.checkoutId ?? json.id ?? null;

  if (checkoutId) {
    const { error: ledgerError } = await supabase
      .from('billing_transactions')
      .insert({
        user_id: user.id,
        provider: 'maya',
        provider_payment_id: checkoutId,
        provider_checkout_id: checkoutId,
        request_reference_number: requestReferenceNumber,
        transaction_type: 'pro_subscription',
        plan,
        status: 'pending',
        amount_cents: amountCents,
        currency: 'PHP',
        billing_period_days: billingPeriodDays,
        metadata: { user_id: user.id, plan, transaction_type: 'pro_subscription' },
      });

    if (ledgerError) console.error('[billing-checkout-ledger]', ledgerError);
  }

  return NextResponse.json({
    url: json.redirectUrl,
    provider: 'maya',
    checkoutId,
    billingPeriodDays,
    autoRenew: cfg.pro?.auto_renew === true,
  });
}
