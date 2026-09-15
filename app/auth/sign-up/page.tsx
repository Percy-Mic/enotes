'use client';

import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function SignUpPage() {
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [usernameStatus, setUsernameStatus] = useState<
    '' | 'checking' | 'free' | 'taken' | 'invalid'
  >('');

  const [showPassword, setShowPassword] = useState(false);
  const [agreed, setAgreed] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [needsConfirmation, setNeedsConfirmation] = useState(false);
  const [resent, setResent] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendError, setResendError] = useState<string | null>(null);

  /*
   * IMPORTANT:
   *
   * This is calculated from the actual domain the user is currently
   * visiting.
   *
   * Production:
   * https://your-domain.com/auth/callback?next=/dashboard
   *
   * Local development:
   * http://localhost:3000/auth/callback?next=/dashboard
   *
   * Supabase must allow the production URL in:
   * Authentication → URL Configuration → Redirect URLs
   */
  const getEmailRedirectTo = () => {
    if (typeof window === 'undefined') {
      return '/auth/callback?next=/dashboard';
    }

    return `${window.location.origin}/auth/callback?next=/dashboard`;
  };

  const handle = username
    .trim()
    .replace(/^@/, '')
    .toLowerCase();

  /*
   * Check username availability.
   */
  useEffect(() => {
    if (!handle) {
      setUsernameStatus('');
      return;
    }

    if (!/^[a-z0-9_]{3,24}$/.test(handle)) {
      setUsernameStatus('invalid');
      return;
    }

    setUsernameStatus('checking');

    let cancelled = false;

    const timer = setTimeout(async () => {
      const { data, error: usernameError } = await supabase
        .from('profiles')
        .select('id')
        .eq('username', handle)
        .maybeSingle();

      if (cancelled) return;

      if (usernameError) {
        /*
         * Do not incorrectly tell the user that a username is free
         * if the database request failed.
         */
        setUsernameStatus('');
        return;
      }

      setUsernameStatus(data ? 'taken' : 'free');
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [handle]);

  /*
   * CREATE ACCOUNT
   */
  const handleSignUp = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    setLoading(true);
    setError(null);
    setResendError(null);

    if (!/^[a-z0-9_]{3,24}$/.test(handle)) {
      setError(
        'Username must be 3–24 characters using lowercase letters, numbers, and underscores.'
      );
      setLoading(false);
      return;
    }

    if (usernameStatus === 'taken') {
      setError('That username is already taken. Please choose another.');
      setLoading(false);
      return;
    }

    if (usernameStatus === 'checking') {
      setError('Please wait while we check your username.');
      setLoading(false);
      return;
    }

    if (!agreed) {
      setError('You must agree to the Terms of Service and Privacy Policy.');
      setLoading(false);
      return;
    }

    const redirectTo = getEmailRedirectTo();

    const { data, error: signUpError } = await supabase.auth.signUp({
      email: email.trim().toLowerCase(),
      password,
      options: {
        emailRedirectTo: redirectTo,

        data: {
          username: handle,
          full_name: handle,
        },
      },
    });

    if (signUpError) {
      setError(signUpError.message);
      setLoading(false);
      return;
    }

    /*
     * If Supabase returns a session, email confirmation is currently
     * disabled for the project.
     */
    if (data.session) {
      router.replace('/dashboard');
      router.refresh();
      return;
    }

    /*
     * No session means the account requires email confirmation.
     */
    setNeedsConfirmation(true);
    setLoading(false);
  };

  /*
   * RESEND CONFIRMATION EMAIL
   */
  const resendConfirmation = async () => {
    setResending(true);
    setResendError(null);
    setError(null);

    const redirectTo = getEmailRedirectTo();

    const { error: resendError } = await supabase.auth.resend({
      type: 'signup',
      email: email.trim().toLowerCase(),
      options: {
        emailRedirectTo: redirectTo,
      },
    });

    setResending(false);

    if (resendError) {
      setResendError(resendError.message);
      return;
    }

    setResent(true);

    window.setTimeout(() => {
      setResent(false);
    }, 6000);
  };

  /*
   * CONFIRMATION SCREEN
   */
  if (needsConfirmation) {
    return (
      <main className="min-h-screen bg-[#FFF7F8] flex items-center justify-center p-6 text-[#111111]">
        <div className="bg-white w-full max-w-md p-8 rounded-[20px] shadow-xl border border-[#E8E2E4] space-y-5 text-center">
          <div className="text-5xl">💌</div>

          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Check your inbox ♡
            </h1>

            <p className="text-sm text-[#6B6B6B] mt-2 leading-relaxed">
              We sent a confirmation link to{' '}
              <span className="font-semibold text-[#111111] break-all">
                {email}
              </span>
              .
            </p>
          </div>

          <div className="rounded-lg bg-blue-50 border border-blue-100 p-4 text-left">
            <p className="text-xs text-blue-800 leading-relaxed">
              Open the confirmation email and click the verification link.
              You will then be redirected back to your enotes account.
            </p>
          </div>

          <div className="rounded-lg bg-amber-50 border border-amber-100 p-4 text-left">
            <p className="text-xs text-amber-800 leading-relaxed">
              <strong>Not receiving the email?</strong>
              <br />
              Check your spam or junk folder first. You can also resend the
              confirmation email below.
            </p>
          </div>

          {resent && (
            <div className="rounded-lg bg-green-50 border border-green-100 p-3">
              <p className="text-xs font-semibold text-green-700">
                Confirmation email sent again ✓
              </p>
            </div>
          )}

          {resendError && (
            <div className="rounded-lg bg-red-50 border border-red-100 p-3 text-left">
              <p className="text-xs text-red-600">
                {resendError}
              </p>
            </div>
          )}

          <button
            type="button"
            onClick={resendConfirmation}
            disabled={resending || resent}
            className="w-full rounded-lg border border-[#E8E2E4] py-3 text-sm font-semibold text-[#111111] transition hover:bg-gray-50 disabled:opacity-50"
          >
            {resending
              ? 'Sending…'
              : resent
                ? 'Email sent ✓'
                : 'Resend confirmation email'}
          </button>

          <Link
            href="/auth/sign-in"
            className="inline-block w-full bg-black text-[#FFB6C1] py-3 rounded-lg font-medium shadow hover:opacity-90 transition"
          >
            Back to sign in
          </Link>
        </div>
      </main>
    );
  }

  /*
   * SIGNUP FORM
   */
  return (
    <main className="min-h-screen bg-[#FFF7F8] flex items-center justify-center p-6 text-[#111111]">
      <div className="bg-white w-full max-w-md p-8 rounded-[20px] shadow-xl border border-[#E8E2E4] space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Create your space ♡
          </h1>

          <p className="text-sm text-[#6B6B6B] mt-1">
            Start your artistic digital journaling journey.
          </p>
        </div>

        {error && (
          <div className="p-3 bg-red-50 border border-red-100 text-red-600 text-sm rounded-lg">
            {error}
          </div>
        )}

        <form onSubmit={handleSignUp} className="space-y-4">
          {/* USERNAME */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-[#6B6B6B] mb-1">
              Username
            </label>

            <div className="flex items-center rounded border border-[#E8E2E4] focus-within:border-[#1E90FF]">
              <span className="pl-3 text-[#9B9B9B]">
                @
              </span>

              <input
                type="text"
                value={username}
                onChange={(e) => {
                  const value = e.target.value
                    .replace(/[^a-zA-Z0-9_]/g, '')
                    .toLowerCase();

                  setUsername(value);
                }}
                required
                minLength={3}
                maxLength={24}
                autoCapitalize="none"
                autoComplete="username"
                className="w-full bg-transparent px-2 py-2 focus:outline-none"
                placeholder="alex"
              />

              {usernameStatus === 'checking' && (
                <span className="pr-3 text-xs text-[#9B9B9B]">
                  checking…
                </span>
              )}

              {usernameStatus === 'free' && (
                <span className="pr-3 text-xs font-semibold text-emerald-600">
                  available ✓
                </span>
              )}

              {usernameStatus === 'taken' && (
                <span className="pr-3 text-xs font-semibold text-red-500">
                  taken
                </span>
              )}

              {usernameStatus === 'invalid' && (
                <span className="pr-3 text-xs font-semibold text-red-500">
                  invalid
                </span>
              )}
            </div>

            <p className="mt-1 text-xs text-[#9B9B9B]">
              3–24 characters: letters, numbers, underscores.
              People find you at /u/{handle || 'username'}.
            </p>
          </div>

          {/* EMAIL */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-[#6B6B6B] mb-1">
              Email
            </label>

            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              inputMode="email"
              className="w-full px-4 py-2 border border-[#E8E2E4] rounded focus:outline-none focus:border-[#1E90FF]"
              placeholder="you@example.com"
            />
          </div>

          {/* PASSWORD */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-[#6B6B6B] mb-1">
              Password
            </label>

            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                autoComplete="new-password"
                className="w-full px-4 py-2 pr-10 border border-[#E8E2E4] rounded focus:outline-none focus:border-[#1E90FF]"
                placeholder="••••••••"
              />

              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-gray-600 focus:outline-none"
                aria-label={
                  showPassword ? 'Hide password' : 'Show password'
                }
              >
                {showPassword ? (
                  <svg
                    className="h-5 w-5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
                    />
                  </svg>
                ) : (
                  <svg
                    className="h-5 w-5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                    />

                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                    />
                  </svg>
                )}
              </button>
            </div>
          </div>

          {/* TERMS */}
          <label className="flex items-start gap-2.5 text-xs leading-relaxed text-[#6B6B6B]">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              required
              className="mt-0.5 h-4 w-4 shrink-0 accent-black"
            />

            <span>
              I agree to the{' '}
              <Link
                href="/terms"
                target="_blank"
                className="font-medium text-[#1E90FF] hover:underline"
              >
                Terms of Service
              </Link>{' '}
              and{' '}
              <Link
                href="/privacy"
                target="_blank"
                className="font-medium text-[#1E90FF] hover:underline"
              >
                Privacy Policy
              </Link>
              .
            </span>
          </label>

          {/* SUBMIT */}
          <button
            type="submit"
            disabled={
              loading ||
              !agreed ||
              !handle ||
              usernameStatus === 'taken' ||
              usernameStatus === 'invalid' ||
              usernameStatus === 'checking'
            }
            className="w-full bg-black text-[#FFB6C1] py-3 rounded-lg font-medium shadow hover:opacity-90 disabled:opacity-50 transition"
          >
            {loading ? 'Creating account...' : 'Sign Up'}
          </button>
        </form>

        <p className="text-center text-sm text-[#6B6B6B]">
          Already have an account?{' '}
          <Link
            href="/auth/sign-in"
            className="text-[#1E90FF] font-medium hover:underline"
          >
            Sign in
          </Link>
        </p>

        <p className="text-center text-xs text-[#9B9B9B]">
          <Link href="/privacy" className="underline">
            Privacy
          </Link>

          <span className="mx-2">·</span>

          <Link href="/terms" className="underline">
            Terms
          </Link>

          <span className="mx-2">·</span>

          <Link href="/contact" className="underline">
            Contact
          </Link>
        </p>
      </div>
    </main>
  );
}
