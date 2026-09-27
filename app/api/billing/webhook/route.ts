import { NextResponse } from 'next/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';

const PRO_ENTITLEMENTS = [
  'video.export.standard',
  'video.export.hd',
  'video.export.4k',
  'video.advanced_effects',
  'video.keyframes',
  'video.masking',
  'video.blend_modes',
  'video.color_grading',
  'video.luts',
  'video.advanced_audio',
  'video.noise_reduction',
  'video.eq',
  'video.compressor',
  'video.audio_ducking',
  'video.advanced_captions',
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

  const { error: transactionError } = await supabase
    .from('billing_transactions')
    .upsert({
      user_id: userId,
      provider: 'maya',
      provider_payment_id: payment.id ?? '',
      plan: 'pro',
      status: 'paid',
      amount_cents: Math.round(amount * 100),
      currency,
      billing_period_days: 30,
      paid_at: now.toISOString(),
      period_start: now.toISOString(),
      period_end: periodEnd.toISOString(),
      provider_payload: payment,
      updated_at: now.toISOString(),
    }, { onConflict: 'provider,provider_payment_id' });
  if (transactionError) throw transactionError;

  const { data: existing } = await supabase
    .from('entitlements')
    .select('key')
    .eq('user_id', userId);

  const have = new Set((existing ?? []).map((row) => row.key));
  const missing = PRO_ENTITLEMENTS
    .filter((key) => !have.has(key))
    .map((key) => ({
      user_id: userId,
      key,
      source: 'plan',
      source_id: payment.id ?? null,
      expires_at: periodEnd.toISOString(),
    }));

  if (missing.length) {
    const { error } = await supabase.from('entitlements').insert(missing);
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from('entitlements')
      .update({ expires_at: periodEnd.toISOString(), source_id: payment.id ?? null })
      .eq('user_id', userId)
      .in('key', PRO_ENTITLEMENTS);
    if (error) throw error;
  }

  const subscriptionPayload = {
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
  };

  const { data: existingSubscription } = await supabase
    .from('subscriptions')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle();

  const { error: subscriptionError } = existingSubscription
    ? await supabase.from('subscriptions').update(subscriptionPayload).eq('id', existingSubscription.id)
    : await supabase.from('subscriptions').insert(subscriptionPayload);

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
