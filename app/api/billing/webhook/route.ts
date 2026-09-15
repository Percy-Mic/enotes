import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createHmac, timingSafeEqual } from 'crypto';

/* ============================================================
   Payment webhooks — the ONLY place subscription/purchase state
   is written. Signature-verified; never trusts the browser.

   Supported:
   • Stripe   — checkout.session.completed,
                customer.subscription.deleted/updated,
                invoice.payment_failed
   • Paddle   — signature in Paddle-Signature (v2)
   • Lemon Squeezy — X-Signature (HMAC-SHA256 of raw body)

   The payment-provider SDK is intentionally not a dependency:
   Stripe's REST API is a plain POST, and Paddle/LSQ verification is
   plain HMAC — fewer packages, smaller bundle, no version churn.
   ============================================================ */

const ENTITLEMENTS_BY_PLAN: Record<string, string[]> = {
  pro: [
    'video.export.standard', 'video.export.hd', 'video.export.4k',
    'video.advanced_effects', 'templates.free', 'templates.premium',
    'sounds.free', 'sounds.premium', 'storage.large', 'journal.advanced', 'ads.remove',
  ],
  creator: ['creator.marketplace', 'creator.analytics'],
  business: ['storage.large', 'creator.analytics', 'journal.advanced'],
};

function stripeSigValid(payload: string, header: string | null, secret: string): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(
    header.split(',').map((kv) => kv.split('=') as [string, string])
  );
  const expected = createHmac('sha256', secret).update(`${parts.t}.${payload}`).digest('hex');
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1 ?? ''));
  } catch {
    return false;
  }
}

function hmacValid(payload: string, signature: string | null, secret: string): boolean {
  if (!signature) return false;
  const expected = createHmac('sha256', secret).update(payload).digest('hex');
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

async function grantPlan(userId: string, plan: string, provider: string, providerSubId: string | null, periodEnd: string | null) {
  const supabase = await createClient();

  const keys = ENTITLEMENTS_BY_PLAN[plan] ?? [];
  if (keys.length) {
    const rows = keys.map((key) => ({ user_id: userId, key, source: 'plan', source_id: providerSubId }));
    // idempotent: no dupes on retry
    const { data: existing } = await supabase.from('entitlements').select('key').eq('user_id', userId);
    const have = new Set((existing || []).map((e) => e.key));
    const missing = rows.filter((r) => !have.has(r.key));
    if (missing.length) await supabase.from('entitlements').insert(missing);
  }

  await supabase.from('subscriptions').upsert(
    {
      user_id: userId,
      plan,
      status: 'active',
      provider,
      provider_subscription_id: providerSubId,
      current_period_end: periodEnd,
    },
    { onConflict: 'user_id' }
  );
}

async function revokeToFree(userId: string) {
  const supabase = await createClient();
  const freeKeys = ['video.export.hd', 'video.export.4k', 'video.advanced_effects', 'templates.premium', 'sounds.premium', 'creator.marketplace', 'creator.analytics', 'ads.remove'];
  await supabase.from('entitlements').delete().eq('user_id', userId).in('key', freeKeys);
  await supabase.from('subscriptions').update({ plan: 'free', status: 'canceled' }).eq('user_id', userId);
}

export async function POST(request: Request) {
  const raw = await request.text();
  const provider = process.env.PAYMENT_PROVIDER;

  /* ------------------------- Stripe ------------------------- */
  if (provider === 'stripe') {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 501 });
    if (!stripeSigValid(raw, request.headers.get('stripe-signature'), secret)) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
    }

    const event = JSON.parse(raw) as {
      type: string;
      data: { object: Record<string, unknown> };
    };
    const obj = event.data?.object ?? {};
    const userId = (obj.client_reference_id ?? (obj.metadata as Record<string, string> | undefined)?.user_id) as string | undefined;
    const plan = ((obj.metadata as Record<string, string> | undefined)?.plan ?? 'pro') as string;

    switch (event.type) {
      case 'checkout.session.completed':
        if (!userId) break;
        await grantPlan(userId, plan, 'stripe', (obj.subscription as string) ?? null, null);
        break;
      case 'customer.subscription.deleted':
      case 'invoice.payment_failed': {
        // look up who owns this subscription
        const subId = (obj.subscription as string) ?? (obj.id as string);
        if (subId) {
          const supabase = await createClient();
          const { data } = await supabase
            .from('subscriptions')
            .select('user_id')
            .eq('provider_subscription_id', subId)
            .maybeSingle();
          if (data) await revokeToFree(data.user_id);
        }
        break;
      }
      default:
        break;
    }
    return NextResponse.json({ received: true });
  }

  /* ------------------------- Lemon Squeezy ------------------------- */
  if (provider === 'lemonsqueezy') {
    const secret = process.env.LSQ_SIGNING_SECRET;
    if (!secret) return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 501 });
    if (!hmacValid(raw, request.headers.get('x-signature'), secret)) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
    }
    const event = JSON.parse(raw) as {
      meta: { event_name: string; custom_data?: { user_id?: string } };
      data: { attributes: Record<string, unknown> };
    };
    const userId = event.meta?.custom_data?.user_id;
    const status = String(event.data.attributes?.status ?? '');
    if (event.meta.event_name === 'subscription_created' && userId) {
      await grantPlan(userId, 'pro', 'lemonsqueezy', String(event.data.attributes?.first_subscription_item ?? ''), String(event.data.attributes?.renews_at ?? '') || null);
    } else if ((event.meta.event_name === 'subscription_cancelled' || event.meta.event_name === 'subscription_expired') && userId) {
      await revokeToFree(userId);
    } else if (event.meta.event_name === 'subscription_payment_failed' && userId) {
      await revokeToFree(userId);
    }
    if (status === 'expired' && userId) await revokeToFree(userId);
    return NextResponse.json({ received: true });
  }

  /* ------------------------- Paddle ------------------------- */
  if (provider === 'paddle') {
    const secret = process.env.PADDLE_WEBHOOK_SECRET;
    if (!secret) return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 501 });
    // Paddle v2: ts + h1 from the Paddle-Signature header, HMAC-SHA256 over "ts:body"
    const sigHeader = request.headers.get('paddle-signature') ?? '';
    const m = sigHeader.match(/ts=(\d+);h1=([a-f0-9]+)/);
    if (!m || !hmacValid(`${m[1]}:${raw}`, m[2], secret)) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
    }
    const event = JSON.parse(raw) as {
      event_type: string;
      data: { custom_data?: { user_id?: string }; items?: unknown[]; id?: string; current_period_end?: string };
    };
    const userId = event.data?.custom_data?.user_id;
    if (event.event_type === 'subscription.created' && userId) {
      await grantPlan(userId, 'pro', 'paddle', event.data.id ?? null, event.data.current_period_end ?? null);
    } else if ((event.event_type === 'subscription.canceled' || event.event_type === 'subscription.past_due') && userId) {
      await revokeToFree(userId);
    }
    return NextResponse.json({ received: true });
  }

  return NextResponse.json(
    { error: 'PAYMENT_PROVIDER not set — webhooks are inert until billing is configured.' },
    { status: 501 }
  );
}
