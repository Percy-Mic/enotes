'use client';

import React, { useState } from 'react';
import { supabase } from '@/lib/supabase/client';

type Props = {
  next?: string;
};

export default function SocialAuthButtons({ next = '/dashboard' }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const continueWithFacebook = async () => {
    setLoading(true);
    setError(null);

    const redirectTo =
      typeof window !== 'undefined'
        ? `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`
        : `/auth/callback?next=${encodeURIComponent(next)}`;

    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: 'facebook',
      options: {
        redirectTo,
        scopes: 'email,public_profile',
      },
    });

    if (oauthError) {
      setError(oauthError.message);
      setLoading(false);
    }
  };

  return (
    <div className="space-y-2.5">
      <button
        type="button"
        onClick={continueWithFacebook}
        disabled={loading}
        className="flex min-h-12 w-full items-center justify-center gap-3 rounded-xl border border-[#E8E2E4] bg-white px-4 py-3 text-sm font-semibold text-[#111111] shadow-sm transition hover:border-[#D8D1D4] hover:bg-[#FAFAFA] focus:outline-none focus:ring-2 focus:ring-[#1E90FF]/20 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span aria-hidden="true" className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#1877F2] text-sm font-bold text-white">
          f
        </span>
        {loading ? 'Connecting to Facebook…' : 'Continue with Facebook'}
      </button>
      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
