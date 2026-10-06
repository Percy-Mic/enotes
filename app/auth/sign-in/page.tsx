'use client';

import React, { useState, useEffect, Suspense, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useRouter, useSearchParams } from 'next/navigation';
import { Eye, EyeOff } from 'lucide-react';
import Link from 'next/link';
import EnotesTurnstile, { TurnstileHandle } from '@/components/auth/Turnstile';
import SocialAuthButtons from '@/components/auth/SocialAuthButtons';

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
      showThemeSelector
      footer={
        <>
          <p className="text-[13px] leading-5 auth-muted">
            Don&apos;t have a journal desk yet?{' '}
            <Link href="/auth/sign-up" className="font-semibold auth-accent hover:underline">
              Create an account
            </Link>
          </p>
          <p className="mt-2.5 text-[11px] leading-4 auth-subtle">
            <Link href="/privacy" className="underline underline-offset-2">Privacy</Link>
            <span className="mx-2">·</span>
            <Link href="/terms" className="underline underline-offset-2">Terms</Link>
            <span className="mx-2">·</span>
            <Link href="/contact" className="underline underline-offset-2">Contact</Link>
          </p>
        </>
      }
    >
      <div className="min-w-0 space-y-6 sm:space-y-7">
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
              className="min-h-11 w-full rounded-xl auth-border auth-surface border px-4 py-2.5 text-[13px] font-semibold auth-ink transition hover:bg-[var(--auth-input-hover)] focus:outline-none focus:ring-4 focus:ring-[#1E90FF]/10"
            >
              Resend confirmation email
            </button>
            {resendStatus && <p className="text-[11px] leading-4 font-medium auth-muted">{resendStatus}</p>}
          </div>
        )}

        <SocialAuthButtons next="/dashboard" />

        <div className="flex items-center gap-3 auth-divider text-[9px] font-semibold uppercase tracking-[0.18em] sm:text-[10px]">
          <span className="h-px min-w-0 flex-1 auth-divider-line" />
          <span className="shrink-0">or email</span>
          <span className="h-px min-w-0 flex-1 auth-divider-line" />
        </div>

        <form onSubmit={handleSignIn} className="space-y-5">
          <div className="space-y-1.5">
            <label htmlFor="signin-email" className="block auth-ink text-[13px] font-semibold leading-4">
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
              className="min-h-[52px] w-full rounded-[14px] auth-border auth-input border px-4 py-3.5 auth-ink text-[15px] leading-5 outline-none transition placeholder:text-[var(--auth-placeholder)] focus:border-[var(--auth-accent)] focus:bg-[var(--auth-input-focus)] focus:ring-4 focus:ring-[var(--auth-accent)]/10"
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="signin-password" className="auth-ink text-[13px] font-semibold leading-4">
                Password
              </label>
              <Link
                href="/auth/forgot-password"
                className="auth-accent shrink-0 text-[12px] font-medium leading-4 hover:underline focus:outline-none focus:ring-2 focus:ring-[var(--auth-accent)]/20"
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
                className="auth-border auth-input auth-ink min-h-[52px] w-full rounded-[14px] border px-4 py-3.5 pr-12 text-[15px] leading-5 outline-none transition placeholder:text-[var(--auth-placeholder)] focus:border-[var(--auth-accent)] focus:bg-[var(--auth-input-focus)] focus:ring-4 focus:ring-[var(--auth-accent)]/10"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-[14px] auth-control-icon transition focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[var(--auth-accent)]/25"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? (
                  <EyeOff className="h-5 w-5" aria-hidden="true" />
                ) : (
                  <Eye className="h-5 w-5" aria-hidden="true" />
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
            className="min-h-[52px] w-full rounded-[14px] auth-primary-button px-4 py-3.5 text-[15px] font-semibold leading-5 shadow-[0_8px_24px_rgba(0,0,0,.12)] transition hover:-translate-y-0.5 hover:shadow-[0_12px_28px_rgba(0,0,0,.16)] focus:outline-none focus:ring-4 focus:ring-black/10 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
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
    <Suspense fallback={<div className="grid min-h-[100dvh] place-items-center auth-page px-4 text-center text-sm auth-muted">Loading...</div>}>
      <SignInForm />
    </Suspense>
  );
}
