import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const VALID_PLANS = new Set(['pro']);

async function platformPrice(plan: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from('platform_config')
    .select('value')
    .eq('key', 'billing')
    .maybeSingle();

  const cfg = (data?.value as Record<string, { amount_cents?: number }> | null) ?? {};
  return Number(cfg[plan]?.amount_cents ?? 0);
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

  const publicKey = process.env.MAYA_PUBLIC_KEY;
  if (!publicKey) {
    return NextResponse.json({ error: 'Maya payment integration is not configured.' }, { status: 501 });
  }

  const amountCents = await platformPrice(plan);
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    return NextResponse.json(
      { error: 'Pro pricing is not configured. Set billing.pro.amount_cents in platform_config.' },
      { status: 500 }
    );
  }

  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? new URL(request.url).origin;
  const requestReferenceNumber = `enotes-${user.id}-${Date.now()}`;
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
        name: 'enotes Pro — 30 days',
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
      billing_period: '30_days',
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

  return NextResponse.json({
    url: json.redirectUrl,
    provider: 'maya',
    checkoutId: json.checkoutId ?? json.id ?? null,
  });
}
