'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';

function SignInForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resendStatus, setResendStatus] = useState<string | null>(null);
  const router = useRouter();
  const searchParams = useSearchParams();

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

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        console.error('Sign-in error:', error.message);
        setError(error.message);
        setLoading(false);
      } else {
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
    <main className="min-h-screen bg-[#FFF7F8] flex items-center justify-center p-6 text-[#111111]">
      <div className="bg-white w-full max-w-md p-8 rounded-[20px] shadow-xl border border-[#E8E2E4] space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Welcome back ♡</h1>
          <p className="text-sm text-[#6B6B6B] mt-1">Sign in to open your journals.</p>
        </div>

        {error && <div className="p-3 bg-red-50 text-red-600 text-sm rounded border border-red-200">{error}</div>}

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
              className="w-full px-4 py-2 border border-[#E8E2E4] rounded focus:outline-none focus:border-[#1E90FF]"
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
                className="w-full px-4 py-2 pr-10 border border-[#E8E2E4] rounded focus:outline-none focus:border-[#1E90FF]"
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
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-black text-[#FFB6C1] py-3 rounded-lg font-medium shadow hover:opacity-90 disabled:opacity-50 transition"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <p className="text-center text-sm text-[#6B6B6B]">
          Don't have a journal desk yet?{' '}
          <Link href="/auth/sign-up" className="text-[#1E90FF] font-medium hover:underline">
            Create an account
          </Link>
        </p>

        <p className="text-center text-xs text-[#9B9B9B]">
          <Link href="/privacy" className="underline">Privacy</Link>
          <span className="mx-2">·</span>
          <Link href="/terms" className="underline">Terms</Link>
          <span className="mx-2">·</span>
          <Link href="/contact" className="underline">Contact</Link>
        </p>
      </div>
    </main>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#FFF7F8] flex items-center justify-center">Loading...</div>}>
      <SignInForm />
    </Suspense>
  );
}