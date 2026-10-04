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
    if (errorParam) {
      setError(decodeURIComponent(errorParam));
    }
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
      const { data, error } = await supabase.auth.signInWithPassword({
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
        /* Middleware sets ?redirect=/path when bouncing anonymous visitors;
           honor it (local paths only — same guard as /auth/callback). */
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

  /* shown when a confirmation link expired or the address isn't confirmed */
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
          <p className="text-sm text-black/55">Don&apos;t have a journal desk yet?{' '}
            <Link href="/auth/sign-up" className="font-semibold text-[#1E90FF] hover:underline">Create an account</Link>
          </p>
          <p className="mt-3 text-xs text-black/40"><Link href="/privacy" className="underline">Privacy</Link><span className="mx-2">·</span><Link href="/terms" className="underline">Terms</Link><span className="mx-2">·</span><Link href="/contact" className="underline">Contact</Link></p>
        </>
      }
    >
      <div className="space-y-6">

        {error && <div className="rounded-2xl border border-red-200 bg-red-50 p-3.5 text-sm leading-5 text-red-700">{error}</div>}

        {showResend && (
          <div className="space-y-2">
            <button
              type="button"
              onClick={resendConfirmation}
              className="w-full rounded-lg border border-[#E8E2E4] py-2.5 text-sm font-semibold transition hover:bg-gray-50"
            >
              Resend confirmation email
            </button>
            {resendStatus && <p className="text-xs font-semibold text-[#6B6B6B]">{resendStatus}</p>}
          </div>
        )}

        <SocialAuthButtons next="/dashboard" />

        <div className="flex items-center gap-3 text-[11px] font-medium uppercase tracking-[0.14em] text-black/35"><span className="h-px flex-1 bg-black/10" /><span>or email</span><span className="h-px flex-1 bg-black/10" /></div>

        <form onSubmit={handleSignIn} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-[#6B6B6B] mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              inputMode="email"
              className="min-h-12 w-full rounded-xl border border-black/10 bg-[#FCFCFC] px-4 py-3 text-sm outline-none transition placeholder:text-black/30 focus:border-[#1E90FF] focus:bg-white focus:ring-4 focus:ring-[#1E90FF]/10"
            />
          </div>

          <div>
            <div className="flex justify-between items-center mb-1">
              <label className="text-xs font-semibold uppercase tracking-wider text-[#6B6B6B]">Password</label>
              <Link href="/auth/forgot-password" className="text-xs text-[#1E90FF] hover:underline">
                Forgot password?
              </Link>
            </div>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                className="min-h-12 w-full rounded-xl border border-black/10 bg-[#FCFCFC] px-4 py-3 pr-11 text-sm outline-none transition focus:border-[#1E90FF] focus:bg-white focus:ring-4 focus:ring-[#1E90FF]/10"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-gray-600 focus:outline-none"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? (
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                  </svg>
                ) : (
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477-2.943-8.268-7-9.542-7z" />
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
            className="w-full min-h-12 rounded-xl bg-black px-4 py-3 font-semibold text-[#FFB6C1] shadow-[0_8px_24px_rgba(0,0,0,.12)] transition hover:-translate-y-0.5 hover:shadow-[0_12px_28px_rgba(0,0,0,.16)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
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
    <Suspense fallback={<div className="grid min-h-[100dvh] place-items-center bg-[#FFF7F8] text-sm text-black/45">Loading...</div>}>
      <SignInForm />
    </Suspense>
  );
}
