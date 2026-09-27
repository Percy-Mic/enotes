'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Check, Loader2, Sparkles } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';

/**
 * /settings/billing — your plan + upgrade paths.
 * The Upgrade button hits /api/billing/checkout, which either opens the
 * provider's hosted checkout or honestly reports billing isn't configured.
 * Entitlements only change when the provider's webhook confirms payment.
 */

const PLANS: { id: string; name: string; price: string; blurb: string; perks: string[] }[] = [
  {
    id: 'free',
    name: 'Free',
    price: '$0',
    blurb: 'Everything you need to journal, post, and create.',
    perks: ['Journals & social feed', 'Real-time messaging & calls', 'Video editor (720p/1080p export)', 'Free templates & sounds', 'Communities'],
  },
  {
    id: 'pro',
    name: 'Pro',
    price: 'Pro',
    blurb: 'For creators who want the full studio.',
    perks: [
      '4K export & higher-quality rendering',
      'Advanced effects & transitions',
      'Keyframes, masking & blend modes',
      'Advanced color grading & LUT support',
      'Advanced audio: noise reduction, EQ & compression',
      'Advanced captions & subtitle tools',
      'Premium templates & sounds',
      '50 GB media storage',
      'Advanced journal customization',
      'Ad-free experience',
    ],
  },
  {
    id: 'creator',
    name: 'Creator',
    price: 'Coming soon',
    blurb: 'Sell templates, sounds, and asset packs.',
    perks: ['Marketplace publishing', 'Creator analytics', 'Payout dashboard', 'Everything in Pro'],
  },
];

export default function BillingSettingsPage() {
  const [current, setCurrent] = useState('free');
  const [loading, setLoading] = useState(true);
  const [busyPlan, setBusyPlan] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [proPrice, setProPrice] = useState<number | null>(null);
  const [proPeriodDays, setProPeriodDays] = useState(30);
  const [proAutoRenew, setProAutoRenew] = useState(false);
  const [periodEnd, setPeriodEnd] = useState<string | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<string | null>(null);

  useEffect(() => {
    const status = new URLSearchParams(window.location.search).get('status');
    if (status) setPaymentStatus(status);

    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from('subscriptions')
        .select('plan, status, current_period_end')
        .eq('user_id', user.id)
        .maybeSingle();
      const { data: billingConfig } = await supabase.from('platform_config').select('value').eq('key', 'billing').maybeSingle();
      const billingValue = billingConfig?.value as {
        pro?: { amount_cents?: number; billing_period_days?: number; auto_renew?: boolean };
      } | null;
      if (billingValue?.pro?.amount_cents) setProPrice(billingValue.pro.amount_cents / 100);
      if (billingValue?.pro?.billing_period_days) setProPeriodDays(billingValue.pro.billing_period_days);
      setProAutoRenew(billingValue?.pro?.auto_renew === true);

      const activeEnd = data?.current_period_end ? new Date(data.current_period_end) : null;
      const isActive = data?.status === 'active' && !!activeEnd && activeEnd.getTime() > Date.now();
      if (isActive) {
        setCurrent(data.plan);
        setPeriodEnd(data.current_period_end);
      }
      setLoading(false);
    })();
  }, []);

  const upgrade = async (plan: string) => {
    setBusyPlan(plan);
    setMessage(null);
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan }),
      });
      const json = await res.json();
      if (res.ok && json.url) {
        window.location.href = json.url;
        return;
      }
      setMessage(json.error ?? 'Checkout is not available yet.');
    } catch {
      setMessage('Network error — try again.');
    } finally {
      setBusyPlan(null);
    }
  };

  return (
    <main className="min-h-[100dvh] bg-[#FFF7F8] px-3 pb-24 pt-5 text-[#111111] sm:px-6 md:pb-10">
      <div className="mx-auto w-full max-w-2xl">
        <Link href="/settings" className="mb-4 inline-block text-sm font-semibold text-[#6B6B6B] hover:text-[#111111]">
          ← Settings
        </Link>

        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Subscription</h1>
        <p className="mt-1 text-sm text-[#6B6B6B]">
          Free stays useful forever. Pro unlocks the advanced creator tools across enotes.
        </p>

        {paymentStatus === 'success' && (
          <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            Payment submitted. Pro access is activated after Maya confirms the payment with enotes.
          </div>
        )}
        {paymentStatus === 'failed' && (
          <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            The payment was not completed. You can try again when checkout is available.
          </div>
        )}
        {paymentStatus === 'cancelled' && (
          <div className="mt-4 rounded-2xl border border-[#E8E2E4] bg-white px-4 py-3 text-sm text-[#6B6B6B]">
            Checkout was cancelled. No Pro access was added.
          </div>
        )}

        {current === 'pro' && periodEnd && (
          <div className="mt-4 rounded-2xl border border-[#E8E2E4] bg-white px-4 py-3">
            <p className="text-sm font-bold">Pro is active</p>
            <p className="mt-0.5 text-xs text-[#6B6B6B]">
              Access until {new Date(periodEnd).toLocaleDateString('en-PH', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}. {proAutoRenew ? 'Automatic renewal is enabled.' : 'This is prepaid access and does not renew automatically.'}
            </p>
          </div>
        )}

        {loading ? (
          <div className="mt-6 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-[#E5798F]" /></div>
        ) : (
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {PLANS.map((plan) => {
              const isCurrent = current === plan.id;
              const isUpgrade = !isCurrent && plan.id !== 'free';
              return (
                <section
                  key={plan.id}
                  className={`relative rounded-2xl border bg-white p-5 shadow-sm ${
                    isCurrent ? 'border-[#E5798F] ring-1 ring-[#E5798F]' : 'border-[#E8E2E4]'
                  }`}
                >
                  {isCurrent && (
                    <span className="absolute -top-2.5 left-4 rounded-full bg-[#E5798F] px-2.5 py-0.5 text-[10px] font-bold text-white">
                      Your plan
                    </span>
                  )}
                  <h2 className="flex items-center gap-1.5 text-base font-bold">
                    {plan.id === 'pro' && <Sparkles className="h-4 w-4 text-[#E5798F]" />} {plan.name}
                  </h2>
                  <p className="mt-0.5 text-sm font-bold text-[#E5798F]">{plan.id === 'pro' && proPrice !== null ? `₱${proPrice.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / ${proPeriodDays} days` : plan.price}</p>
                  <p className="mt-1 text-xs text-[#6B6B6B]">{plan.blurb}</p>
                  <ul className="mt-3 space-y-1.5">
                    {plan.perks.map((perk) => (
                      <li key={perk} className="flex items-start gap-1.5 text-xs text-[#3D3D3D]">
                        <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#E5798F]" /> {perk}
                      </li>
                    ))}
                  </ul>
                  <button
                    onClick={() => isUpgrade && upgrade(plan.id)}
                    disabled={!isUpgrade || busyPlan === plan.id}
                    className={`mt-4 w-full rounded-xl py-2.5 text-sm font-bold transition ${
                      isCurrent
                        ? 'bg-[#FFF7F8] text-[#6B6B6B]'
                        : isUpgrade
                          ? 'bg-black text-[#FFB6C1] hover:opacity-90'
                          : 'bg-white text-[#6B6B6B] ring-1 ring-[#E8E2E4]'
                    }`}
                  >
                    {busyPlan === plan.id ? (
                      <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                    ) : isCurrent ? 'Current plan' : plan.id === 'free' ? 'Included' : 'Upgrade'}
                  </button>
                </section>
              );
            })}
          </div>
        )}

        {message && (
          <p className="mt-5 rounded-xl border border-[#F0EAEC] bg-white px-4 py-3 text-xs text-[#6B6B6B]">
            {message}
          </p>
        )}

        <p className="mt-6 text-center text-[11px] text-[#9B9B9B]">
          Pro is prepaid for the displayed period and does not renew automatically unless the plan configuration explicitly says otherwise.
          Payments are processed through Maya's hosted checkout. Payment details are handled by Maya, and Pro access is granted only after server-side payment confirmation.
        </p>
      </div>
    </main>
  );
}
