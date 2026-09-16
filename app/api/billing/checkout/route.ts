import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/* ============================================================
   POST /api/billing/checkout — start a subscription checkout.

   Architecture (per platform requirements):
   • Entitlements are NEVER written from the browser. The checkout
     only creates a provider session; the webhook (separate route,
     signature-verified) does all database writes.
   • Prices live in platform_config (admin-editable), not hardcoded.
   • INERT UNTIL CONFIGURED: with no PAYMENT_PROVIDER set, it
     responds 501 with guidance instead of pretending to work.

   Environment (whichever provider you pick):
     PAYMENT_PROVIDER=stripe | paddle | lemonsqueezy
     STRIPE_SECRET_KEY=sk_live_… / sk_test_…
     STRIPE_PRICE_PRO=price_…
     NEXT_PUBLIC_SITE_URL=https://your-domain
   ============================================================ */

const VALID_PLANS = new Set(['pro', 'creator', 'business']);

async function platformPrice(plan: string): Promise<{ priceId: string | null; amountCents: number }> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('platform_config')
    .select('value')
    .eq('key', 'billing')
    .maybeSingle();
  const cfg = (data?.value as Record<string, { price_id?: string; amount_cents?: number }> | null) ?? {};
  return {
    priceId: cfg[plan]?.price_id ?? null,
    amountCents: cfg[plan]?.amount_cents ?? 0,
  };
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { plan?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const plan = body.plan ?? '';
  if (!VALID_PLANS.has(plan)) {
    return NextResponse.json({ error: 'Unknown plan' }, { status: 400 });
  }

  const provider = process.env.PAYMENT_PROVIDER;
  if (!provider) {
    return NextResponse.json(
      {
        error: 'Billing is not configured yet. Set PAYMENT_PROVIDER + provider keys (see SETUP-CHECKLIST.md).',
        configured: false,
      },
      { status: 501 }
    );
  }

  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? new URL(request.url).origin;
  const { priceId } = await platformPrice(plan);

  /* ---------------- Stripe ---------------- */
  if (provider === 'stripe') {
    if (!process.env.STRIPE_SECRET_KEY) {
      return NextResponse.json({ error: 'STRIPE_SECRET_KEY missing' }, { status: 501 });
    }
    if (!priceId) {
      return NextResponse.json(
        { error: `No Stripe price configured for "${plan}". Add it to platform_config.billing.` },
        { status: 500 }
      );
    }
    const params = new URLSearchParams({
      mode: 'subscription',
      'line_items[0][price]': priceId,
      'line_items[0][quantity]': '1',
      success_url: `${origin}/settings/billing?status=success`,
      cancel_url: `${origin}/settings/billing?status=cancelled`,
      client_reference_id: user.id,
      'metadata[user_id]': user.id,
      'metadata[plan]': plan,
      'subscription_data[metadata][user_id]': user.id,
      'subscription_data[metadata][plan]': plan,
    });
    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params,
    });
    const json = (await res.json()) as { url?: string; error?: { message?: string } };
    if (!res.ok || !json.url) {
      return NextResponse.json({ error: json.error?.message ?? 'Stripe checkout failed' }, { status: 502 });
    }
    return NextResponse.json({ url: json.url, provider: 'stripe' });
  }

  /* ---------------- Paddle / Lemon Squeezy ----------------
     Both use a hosted checkout that is usually opened client-side with a
     signed/templated link; wiring their exact SDKs needs your account
     region + storefront IDs. The webhook route below already verifies
     them. For now: explicit, honest 501 with what's missing. */
  return NextResponse.json(
    {
      error: `Provider "${provider}" selected but its checkout integration needs storefront credentials. The webhook + entitlement pipeline is ready; add the checkout call for ${provider} here.`,
      configured: false,
    },
    { status: 501 }
  );
}
