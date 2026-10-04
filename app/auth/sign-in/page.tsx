'use client';

import React, { useState, useEffect, Suspense, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import EnotesTurnstile, { TurnstileHandle } from '@/components/auth/Turnstile';
import SocialAuthButtons from '@/components/auth/SocialAuthButtons';
import AuthShell from '@/components/auth/AuthShell';

function SignInForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resendStatus, setResendStatus] = useState<string | null>(null);
  const turnstileRef = useRef<TurnstileHandle | null>(null);
  const router = useRouter();
  const searchParams = useSearchParams();
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

  useEffect(() => {
    const errorParam = searchParams.get('error');
    if (errorParam) setError(decodeURIComponent(errorParam));
  }, [searchParams]);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    if (!turnstileSiteKey) {
      setError('The security check is not configured yet. Please contact support.');
      setLoading(false);
      return;
    }

    if (!captchaToken) {
      setError('Please complete the security check before signing in.');
      setLoading(false);
      return;
    }

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
        options: { captchaToken },
      });

      if (error) {
        console.error('Sign-in error:', error.message);
        setError(error.message);
        turnstileRef.current?.reset();
        setCaptchaToken(null);
        setLoading(false);
      } else {
        turnstileRef.current?.reset();
        setCaptchaToken(null);
        const raw = searchParams.get('redirect');
        const next = raw && raw.startsWith('/') && !raw.startsWith('//') ? raw : '/dashboard';
        router.push(next);
        router.refresh();
      }
    } catch (err: any) {
      console.error('Unexpected sign-in exception:', err);
      setError(err.message || 'An unexpected error occurred during sign in.');
      turnstileRef.current?.reset();
      setCaptchaToken(null);
      setLoading(false);
    }
  };

  const showResend = searchParams.get('resend') === '1' || /confirm|verified/i.test(error || '');

  const resendConfirmation = async () => {
    setResendStatus(null);
    const { error: resendError } = await supabase.auth.resend({
      type: 'signup',
      email,
      options: {
        emailRedirectTo:
          typeof window !== 'undefined'
            ? `${window.location.origin}/auth/callback?next=/dashboard`
            : '/auth/callback?next=/dashboard',
      },
    });
    setResendStatus(
      resendError
        ? /rate.?limit/i.test(resendError.message)
          ? 'Too many confirmation emails have been sent in the last hour. Please try again in a little while.'
          : resendError.message
        : 'Confirmation email sent — check your inbox (and spam folder).'
    );
  };

  return (
    <AuthShell
      eyebrow="Welcome back"
      title="Welcome back ♡"
      description="Sign in to open your journals and pick up where you left off."
      asideTitle="Your journal is waiting for you."
      footer={
        <>
          <p className="text-[13px] leading-5 text-black/55">
            Don&apos;t have a journal desk yet?{' '}
            <Link href="/auth/sign-up" className="font-semibold text-[#1E90FF] hover:underline">
              Create an account
            </Link>
          </p>
          <p className="mt-2.5 text-[11px] leading-4 text-black/40">
            <Link href="/privacy" className="underline underline-offset-2">Privacy</Link>
            <span className="mx-2">·</span>
            <Link href="/terms" className="underline underline-offset-2">Terms</Link>
            <span className="mx-2">·</span>
            <Link href="/contact" className="underline underline-offset-2">Contact</Link>
          </p>
        </>
      }
    >
      <div className="min-w-0 space-y-5 sm:space-y-6">
        {error && (
          <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-[13px] leading-5 text-red-700">
            {error}
          </div>
        )}

        {showResend && (
          <div className="space-y-2.5">
            <button
              type="button"
              onClick={resendConfirmation}
              className="min-h-11 w-full rounded-xl border border-[#E8E2E4] bg-white px-4 py-2.5 text-[13px] font-semibold text-[#111] transition hover:bg-gray-50 focus:outline-none focus:ring-4 focus:ring-[#1E90FF]/10"
            >
              Resend confirmation email
            </button>
            {resendStatus && <p className="text-[11px] leading-4 font-medium text-[#6B6B6B]">{resendStatus}</p>}
          </div>
        )}

        <SocialAuthButtons next="/dashboard" />

        <div className="flex items-center gap-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-black/35">
          <span className="h-px min-w-0 flex-1 bg-black/10" />
          <span className="shrink-0">or email</span>
          <span className="h-px min-w-0 flex-1 bg-black/10" />
        </div>

        <form onSubmit={handleSignIn} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="signin-email" className="block text-[12px] font-semibold leading-4 text-[#343434]">
              Email
            </label>
            <input
              id="signin-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              inputMode="email"
              placeholder="you@example.com"
              className="min-h-12 w-full rounded-xl border border-black/10 bg-[#FCFCFC] px-3.5 py-3 text-[15px] leading-5 text-[#111] outline-none transition placeholder:text-black/30 focus:border-[#1E90FF] focus:bg-white focus:ring-4 focus:ring-[#1E90FF]/10"
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="signin-password" className="text-[12px] font-semibold leading-4 text-[#343434]">
                Password
              </label>
              <Link
                href="/auth/forgot-password"
                className="shrink-0 text-[12px] font-medium leading-4 text-[#1E90FF] hover:underline focus:outline-none focus:ring-2 focus:ring-[#1E90FF]/20"
              >
                Forgot password?
              </Link>
            </div>
            <div className="relative">
              <input
                id="signin-password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                placeholder="Enter your password"
                className="min-h-12 w-full rounded-xl border border-black/10 bg-[#FCFCFC] px-3.5 py-3 pr-12 text-[15px] leading-5 text-[#111] outline-none transition placeholder:text-black/30 focus:border-[#1E90FF] focus:bg-white focus:ring-4 focus:ring-[#1E90FF]/10"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-xl text-black/40 transition hover:text-black/70 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[#1E90FF]/20"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? (
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                  </svg>
                ) : (
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268 2.943-9.542 7z" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          <EnotesTurnstile
            ref={turnstileRef}
            siteKey={turnstileSiteKey}
            action="login"
            onToken={handleCaptchaToken}
            onExpire={handleCaptchaReset}
            onError={handleCaptchaError}
          />

          <button
            type="submit"
            disabled={loading || !turnstileSiteKey || !captchaToken}
            className="min-h-12 w-full rounded-xl bg-black px-4 py-3 text-[15px] font-semibold leading-5 text-[#FFB6C1] shadow-[0_8px_24px_rgba(0,0,0,.12)] transition hover:-translate-y-0.5 hover:shadow-[0_12px_28px_rgba(0,0,0,.16)] focus:outline-none focus:ring-4 focus:ring-black/10 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </div>
    </AuthShell>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={<div className="grid min-h-[100dvh] place-items-center bg-[#FFF7F8] px-4 text-center text-sm text-black/45">Loading...</div>}>
      <SignInForm />
    </Suspense>
  );
}
