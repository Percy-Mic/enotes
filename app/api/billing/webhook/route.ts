import { NextResponse } from 'next/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';

const PRO_ENTITLEMENTS = [
  'video.export.standard',
  'video.export.hd',
  'video.export.4k',
  'video.advanced_effects',
  'templates.free',
  'templates.premium',
  'sounds.free',
  'sounds.premium',
  'storage.large',
  'journal.advanced',
  'ads.remove',
];

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error('Supabase service role is not configured');
  return createSupabaseClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function mayaBaseUrl() {
  return process.env.MAYA_ENV === 'production'
    ? 'https://pg.maya.ph'
    : 'https://pg-sandbox.paymaya.com';
}

async function verifyMayaPayment(paymentId: string) {
  const secretKey = process.env.MAYA_SECRET_KEY;
  if (!secretKey) throw new Error('MAYA_SECRET_KEY is not configured');

  const encodedKey = Buffer.from(`${secretKey}:`).toString('base64');
  const response = await fetch(`${mayaBaseUrl()}/payments/v1/payments/${encodeURIComponent(paymentId)}`, {
    method: 'GET',
    headers: {
      Authorization: `Basic ${encodedKey}`,
      Accept: 'application/json',
    },
    cache: 'no-store',
  });

  const payment = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payment?.message ?? 'Unable to verify Maya payment');

  return payment as {
    id?: string;
    paymentStatus?: string;
    requestReferenceNumber?: string;
    totalAmount?: { value?: string | number; currency?: string };
    metadata?: { user_id?: string; plan?: string; billing_period?: string };
  };
}

async function grantPro(userId: string, payment: {
  id?: string;
  totalAmount?: { value?: string | number; currency?: string };
}) {
  const supabase = getAdminClient();
  const now = new Date();
  const periodEnd = new Date(now);
  periodEnd.setUTCDate(periodEnd.getUTCDate() + 30);

  const amount = Number(payment.totalAmount?.value ?? 0);
  const currency = String(payment.totalAmount?.currency ?? 'PHP');

  const { error: entitlementError } = await supabase
    .from('entitlements')
    .upsert(
      PRO_ENTITLEMENTS.map((key) => ({
        user_id: userId,
        key,
        source: 'plan',
        source_id: payment.id ?? null,
      })),
      { onConflict: 'user_id,key' }
    );

  if (entitlementError) throw entitlementError;

  const { error: subscriptionError } = await supabase
    .from('subscriptions')
    .upsert(
      {
        user_id: userId,
        plan: 'pro',
        status: 'active',
        provider: 'maya',
        provider_subscription_id: payment.id ?? null,
        price_cents: Math.round(amount * 100),
        currency,
        current_period_end: periodEnd.toISOString(),
        canceled_at: null,
        updated_at: now.toISOString(),
      },
      { onConflict: 'user_id' }
    );

  if (subscriptionError) throw subscriptionError;
}

export async function POST(request: Request) {
  try {
    const raw = await request.text();
    let event: {
      id?: string;
      paymentStatus?: string;
      metadata?: { user_id?: string; plan?: string };
    };

    try {
      event = JSON.parse(raw);
    } catch {
      return NextResponse.json({ error: 'Invalid webhook JSON' }, { status: 400 });
    }

    const paymentId = event.id;
    if (!paymentId) {
      return NextResponse.json({ received: true });
    }

    /*
     * Maya Checkout webhook payloads are not treated as proof of payment.
     * We retrieve the payment directly from Maya using the secret key and
     * only grant Pro when Maya reports PAYMENT_SUCCESS.
     */
    const payment = await verifyMayaPayment(paymentId);

    if (payment.paymentStatus !== 'PAYMENT_SUCCESS') {
      return NextResponse.json({
        received: true,
        status: payment.paymentStatus ?? 'unknown',
      });
    }

    const userId = payment.metadata?.user_id;
    const plan = payment.metadata?.plan;

    if (!userId || plan !== 'pro') {
      return NextResponse.json({ error: 'Missing or invalid payment metadata' }, { status: 400 });
    }

    await grantPro(userId, payment);

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('[maya-webhook]', error);
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 });
  }
}
