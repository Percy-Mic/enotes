'use client';

import React, { useCallback, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import Link from 'next/link';
import EnotesTurnstile, { TurnstileHandle } from '@/components/auth/Turnstile';
import AuthShell from '@/components/auth/AuthShell';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const turnstileRef = useRef<TurnstileHandle | null>(null);
  const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '';

  const handleCaptchaToken = useCallback((token: string) => {
    setCaptchaToken(token);
    setError(null);
  }, []);

  const handleCaptchaReset = useCallback(() => {
    setCaptchaToken(null);
  }, []);

  const handleCaptchaError = useCallback(() => {
    setCaptchaToken(null);
    setError('The security check could not be completed. Please try again.');
  }, []);

  const handlePasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !captchaToken) return;

    setLoading(true);
    setError(null);
    setMessage(null);

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/update-password`,
      captchaToken,
    });

    if (error) {
      console.error('Password-reset error:', error.message);
      setError(
        /rate.?limit/i.test(error.message)
          ? 'Too many recovery emails have been sent in the last hour. Please try again in a little while.'
          : error.message
      );
    } else {
      setMessage('Check your email for the password reset link.');
    }
    setLoading(false);
  };

  return (
    <main className="min-h-screen bg-[#FFF7F8] flex items-center justify-center p-6 text-[#111111]">
      <div className="bg-white w-full max-w-md p-8 rounded-[20px] shadow-xl border border-[#E8E2E4] space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Reset password ♡</h1>
          <p className="text-sm text-[#6B6B6B] mt-1">We will send you a recovery link.</p>
        </div>

          {error && <div className="break-words rounded-xl bg-red-50 p-3 text-sm leading-5 text-red-600">{error}</div>}
          {message && <div className="break-words rounded-xl bg-green-50 p-3 text-sm leading-5 text-green-600">{message}</div>}

          <form onSubmit={handlePasswordReset} className="min-w-0 space-y-4">
          <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-[#6B6B6B]">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="min-h-12 w-full min-w-0 rounded-xl border border-black/10 bg-[#FCFCFC] px-3.5 py-3 text-sm outline-none transition focus:border-[#1E90FF] focus:bg-white focus:ring-4 focus:ring-[#1E90FF]/10 sm:px-4"
            />
          </div>

          {turnstileSiteKey ? (
            <EnotesTurnstile
              ref={turnstileRef}
              siteKey={turnstileSiteKey}
              action="password_reset"
              onToken={handleCaptchaToken}
              onExpire={handleCaptchaReset}
              onError={handleCaptchaError}
            />
          ) : (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              Security verification is temporarily unavailable. Please refresh and try again.
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !email.trim() || !turnstileSiteKey || !captchaToken}
            className="w-full min-h-12 rounded-xl bg-black px-4 py-3 font-semibold text-[#FFB6C1] shadow-[0_8px_24px_rgba(0,0,0,.12)] transition hover:-translate-y-0.5 disabled:opacity-50"
          >
            {loading ? 'Sending link...' : !turnstileSiteKey ? 'Security check unavailable' : !captchaToken ? 'Complete security check' : 'Send Reset Link'}
          </button>
        </form>

            <p className="pt-1 text-center text-sm leading-5 text-[#6B6B6B]">
          Remember your password?{' '}
          <Link href="/auth/sign-in" className="text-[#1E90FF] font-medium hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}