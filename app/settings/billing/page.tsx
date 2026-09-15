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
    price: '$6/mo',
    blurb: 'For creators who want the full studio.',
    perks: ['4K export & HD quality', 'Advanced effects (shake, pulse)', 'Premium templates & sounds', '50 GB media storage', 'Ad-free'],
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

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from('subscriptions')
        .select('plan, status, current_period_end')
        .eq('user_id', user.id)
        .maybeSingle();
      if (data && data.status === 'active') setCurrent(data.plan);
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
          Free stays useful forever — paid tiers unlock studio power. Manage or cancel anytime.
        </p>

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
                  <p className="mt-0.5 text-sm font-bold text-[#E5798F]">{plan.price}</p>
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
          Payments are processed by the provider's hosted checkout. Card details never touch eNotes servers.
          Access changes only after the provider confirms payment via webhook.
        </p>
      </div>
    </main>
  );
}
