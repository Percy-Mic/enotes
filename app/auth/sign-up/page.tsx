'use client';

import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function SignUpPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [usernameStatus, setUsernameStatus] = useState<'' | 'checking' | 'free' | 'taken' | 'invalid'>('');
  const [showPassword, setShowPassword] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [needsConfirmation, setNeedsConfirmation] = useState(false);
  const [resent, setResent] = useState(false);
  const [resending, setResending] = useState(false);
  const router = useRouter();

  /* Where Supabase should send the user after they click the
     confirmation link. Must be listed in Supabase Auth → URL
     Configuration → Redirect URLs (see SETUP-CHECKLIST.md). */
  const emailRedirectTo =
    typeof window !== 'undefined'
      ? `${window.location.origin}/auth/callback?next=/dashboard`
      : '/auth/callback?next=/dashboard';

  const handle = username.trim().replace(/^@/, '').toLowerCase();

  /* Live username availability check */
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
    const timer = setTimeout(async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id')
        .eq('username', handle)
        .maybeSingle();
      setUsernameStatus(data ? 'taken' : 'free');
    }, 350);
    return () => clearTimeout(timer);
  }, [handle]);

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    if (!/^[a-z0-9_]{3,24}$/.test(handle)) {
      setError('Username must be 3–24 characters: lowercase letters, numbers, underscores.');
      setLoading(false);
      return;
    }
    if (usernameStatus === 'taken') {
      setError('That username is already taken — pick another.');
      setLoading(false);
      return;
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          username: handle,
          full_name: handle,
        },
        emailRedirectTo,
      },
    });

    if (error) {
      /* A 500 from /auth/v1/signup is almost always mail-delivery
         configuration on the auth service (SMTP not verified / sender
         identity missing), not anything the user did. Say so clearly. */
      setError(
        (error as { status?: number }).status === 500
          ? 'We could not create the account because the confirmation email could not be sent (a mail-delivery problem on our side, not your details). Please try again shortly — if it keeps failing, contact support.'
          : /rate.?limit/i.test(error.message)
            ? 'Too many confirmation emails have been sent from the platform in the last hour, so this one was skipped. Please try again in a little while — your details were not the problem.'
            : error.message
      );
      setLoading(false);
    } else if (data.session) {
      // Email confirmation disabled — go straight to the dashboard
      router.push('/dashboard');
      router.refresh();
    } else {
      // Email confirmation enabled — tell the user instead of dead-ending on a blank dashboard
      setNeedsConfirmation(true);
      setLoading(false);
    }
  };

  const resendConfirmation = async () => {
    setResending(true);
    const { error: resendError } = await supabase.auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo },
    });
    setResending(false);
    if (!resendError) {
      setResent(true);
      setTimeout(() => setResent(false), 6000);
    }
  };

  if (needsConfirmation) {
    return (
      <main className="min-h-screen bg-[#FFF7F8] flex items-center justify-center p-6 text-[#111111]">
        <div className="bg-white w-full max-w-md p-8 rounded-[20px] shadow-xl border border-[#E8E2E4] space-y-4 text-center">
          <div className="text-4xl">💌</div>
          <h1 className="text-2xl font-bold tracking-tight">Check your inbox ♡</h1>
          <p className="text-sm text-[#6B6B6B]">
            We sent a confirmation link to <span className="font-medium text-[#111111]">{email}</span>.
            Open it on this device to activate your journal desk.
          </p>
          <p className="rounded-lg bg-amber-50 p-3 text-xs leading-relaxed text-amber-800">
            <b>Not arriving?</b> Check spam and the Promotions tab first. Still nothing after a
            few minutes? Use “Resend email” below — and if it never arrives, the fix is usually
            in Supabase → Authentication → SMTP (see SETUP-CHECKLIST.md).
          </p>
          {resent && (
            <p className="rounded-lg bg-green-50 p-3 text-xs font-semibold text-green-700">
              Confirmation email re-sent — check your inbox again.
            </p>
          )}
          <button
            onClick={resendConfirmation}
            disabled={resending || resent}
            className="w-full rounded-lg border border-[#E8E2E4] py-3 text-sm font-semibold text-[#111111] transition hover:bg-gray-50 disabled:opacity-50"
          >
            {resending ? 'Sending…' : resent ? 'Email sent ✓' : 'Resend confirmation email'}
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

  return (
    <main className="min-h-screen bg-[#FFF7F8] flex items-center justify-center p-6 text-[#111111]">
      <div className="bg-white w-full max-w-md p-8 rounded-[20px] shadow-xl border border-[#E8E2E4] space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Create your space ♡</h1>
          <p className="text-sm text-[#6B6B6B] mt-1">Start your artistic digital journaling journey.</p>
        </div>

        {error && <div className="p-3 bg-red-50 text-red-600 text-sm rounded">{error}</div>}

        <form onSubmit={handleSignUp} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-[#6B6B6B] mb-1">Username</label>
            <div className="flex items-center rounded border border-[#E8E2E4] focus-within:border-[#1E90FF]">
              <span className="pl-3 text-[#9B9B9B]">@</span>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase())}
                required
                minLength={3}
                maxLength={24}
                autoCapitalize="none"
                autoComplete="username"
                className="w-full bg-transparent px-2 py-2 focus:outline-none"
                placeholder="alex"
              />
              {usernameStatus === 'checking' && (
                <span className="pr-3 text-xs text-[#9B9B9B]">checking…</span>
              )}
              {usernameStatus === 'free' && (
                <span className="pr-3 text-xs font-semibold text-emerald-600">available ✓</span>
              )}
              {usernameStatus === 'taken' && (
                <span className="pr-3 text-xs font-semibold text-red-500">taken</span>
              )}
            </div>
            <p className="mt-1 text-xs text-[#9B9B9B]">
              3–24 characters: letters, numbers, underscores. People find you at /u/{handle || 'username'}.
            </p>
          </div>

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
            <label className="block text-xs font-semibold uppercase tracking-wider text-[#6B6B6B] mb-1">Password</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                autoComplete="new-password"
                className="w-full px-4 py-2 pr-10 border border-[#E8E2E4] rounded focus:outline-none focus:border-[#1E90FF]"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-gray-600 focus:outline-none"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? (
                  // EyeOff SVG
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                  </svg>
                ) : (
                  // Eye SVG
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                )}
              </button>
            </div>
          </div>

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
              <Link href="/terms" target="_blank" className="font-medium text-[#1E90FF] hover:underline">
                Terms of Service
              </Link>{' '}
              and{' '}
              <Link href="/privacy" target="_blank" className="font-medium text-[#1E90FF] hover:underline">
                Privacy Policy
              </Link>
              .
            </span>
          </label>

          <button
            type="submit"
            disabled={loading || !agreed || !handle || usernameStatus === 'taken' || usernameStatus === 'invalid'}
            className="w-full bg-black text-[#FFB6C1] py-3 rounded-lg font-medium shadow hover:opacity-90 disabled:opacity-50 transition"
          >
            {loading ? 'Creating account...' : 'Sign Up'}
          </button>
        </form>

        <p className="text-center text-sm text-[#6B6B6B]">
          Already have an account?{' '}
          <Link href="/auth/sign-in" className="text-[#1E90FF] font-medium hover:underline">
            Sign in
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