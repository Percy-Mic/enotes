'use client';

import React, { useState } from 'react';
import { supabase } from '@/lib/supabase/client';

type Props = { next?: string };

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
      <path fill="#4285F4" d="M21.35 12.23c0-.73-.06-1.43-.19-2.1H12v3.98h5.24a4.48 4.48 0 0 1-1.94 2.94v2.45h3.14c1.84-1.69 2.91-4.18 2.91-7.27Z"/>
      <path fill="#34A853" d="M12 21.82c2.63 0 4.84-.87 6.45-2.32l-3.14-2.45c-.87.58-1.98.92-3.31.92-2.54 0-4.69-1.72-5.46-4.03H3.29v2.53A9.75 9.75 0 0 0 12 21.82Z"/>
      <path fill="#FBBC05" d="M6.54 13.94A5.86 5.86 0 0 1 6.23 12c0-.68.12-1.34.31-1.94V7.53H3.29A9.76 9.76 0 0 0 2.25 12c0 1.57.38 3.05 1.04 4.47l3.25-2.53Z"/>
      <path fill="#EA4335" d="M12 6.03c1.43 0 2.71.49 3.72 1.45l2.79-2.79C16.84 3.1 14.63 2.18 12 2.18a9.75 9.75 0 0 0-8.71 5.35l3.25 2.53C7.31 7.75 9.46 6.03 12 6.03Z"/>
    </svg>
  );
}

function FacebookIcon() {
  return <span aria-hidden="true" className="grid h-5 w-5 place-items-center rounded-full bg-[#1877F2] text-[13px] font-bold text-white">f</span>;
}

export default function SocialAuthButtons({ next = '/dashboard' }: Props) {
  const [loading, setLoading] = useState<'google' | 'facebook' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const continueWith = async (provider: 'google' | 'facebook') => {
    setLoading(provider);
    setError(null);
    const redirectTo =
      typeof window !== 'undefined'
        ? `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`
        : `/auth/callback?next=${encodeURIComponent(next)}`;

    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo,
        ...(provider === 'facebook' ? { scopes: 'email,public_profile' } : { scopes: 'openid email profile' }),
      },
    });

    if (oauthError) {
      setError(oauthError.message);
      setLoading(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <button type="button" onClick={() => continueWith('google')} disabled={!!loading}
          className="flex min-h-12 items-center justify-center gap-2.5 rounded-xl border border-[#E8E2E4] bg-white px-4 py-3 text-sm font-semibold text-[#111] shadow-sm transition hover:border-[#CFC7CB] hover:bg-[#FAFAFA] focus:outline-none focus:ring-2 focus:ring-[#1E90FF]/20 disabled:cursor-not-allowed disabled:opacity-60">
          <GoogleIcon />
          {loading === 'google' ? 'Connecting…' : 'Google'}
        </button>
        <button type="button" onClick={() => continueWith('facebook')} disabled={!!loading}
          className="flex min-h-12 items-center justify-center gap-2.5 rounded-xl border border-[#E8E2E4] bg-white px-4 py-3 text-sm font-semibold text-[#111] shadow-sm transition hover:border-[#CFC7CB] hover:bg-[#FAFAFA] focus:outline-none focus:ring-2 focus:ring-[#1E90FF]/20 disabled:cursor-not-allowed disabled:opacity-60">
          <FacebookIcon />
          {loading === 'facebook' ? 'Connecting…' : 'Facebook'}
        </button>
      </div>
      {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs leading-relaxed text-red-600">{error}</p>}
    </div>
  );
}
