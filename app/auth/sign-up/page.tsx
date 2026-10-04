'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import EnotesTurnstile, { TurnstileHandle } from '@/components/auth/Turnstile';
import SocialAuthButtons from '@/components/auth/SocialAuthButtons';
import AuthShell from '@/components/auth/AuthShell';

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
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const turnstileRef = useRef<TurnstileHandle | null>(null);
  const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '';
  const router = useRouter();

  /* Where Supabase should send the user after they click the
     confirmation link. Must be listed in Supabase Auth → URL
     Configuration → Redirect URLs (see SETUP-CHECKLIST.md). */
  const emailRedirectTo =
    typeof window !== 'undefined'
      ? `${window.location.origin}/auth/callback?next=/dashboard`
      : '/auth/callback?next=/dashboard';

  const handle = username.trim().replace(/^@/, '').toLowerCase();

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
      turnstileRef.current?.reset();
      setCaptchaToken(null);
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
      <AuthShell eyebrow="Check your inbox" title="Check your inbox ♡" description="We sent a confirmation link to your email. Open it on this device to activate your journal desk." asideTitle="One small step, then your space is yours.">
        <div className="space-y-5 text-center">
          <div className="text-4xl" aria-hidden="true">💌</div>
          <p className="auth-muted text-sm leading-6">We sent a confirmation link to <span className="auth-ink font-medium">{email}</span>.</p>
          <p className="rounded-xl border border-amber-300/40 bg-amber-50 p-3 text-left text-xs leading-relaxed text-amber-800"><b>Not arriving?</b> Check spam and Promotions first. If it still does not arrive, use “Resend email” below.</p>
          {resent && <p className="rounded-xl border border-emerald-300/40 bg-emerald-50 p-3 text-xs font-semibold text-emerald-700">Confirmation email re-sent — check your inbox again.</p>}
          <button onClick={resendConfirmation} disabled={resending || resent} className="auth-surface auth-border auth-ink min-h-11 w-full rounded-xl border px-4 py-3 text-sm font-semibold transition hover:bg-[var(--auth-input-hover)] disabled:opacity-50">{resending ? 'Sending…' : resent ? 'Email sent ✓' : 'Resend confirmation email'}</button>
          <Link href="/auth/sign-in" className="auth-primary-button inline-flex min-h-11 w-full items-center justify-center rounded-xl px-4 py-3 font-medium shadow transition hover:opacity-90">Back to sign in</Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell eyebrow="Create your space" title="Create your space ♡" description="Start your artistic digital journaling journey." asideTitle="Make a space that feels like you." footer={
      <>
        <p className="auth-muted text-[13px] leading-5">Already have an account? <Link href="/auth/sign-in" className="auth-accent font-semibold hover:underline">Sign in</Link></p>
        <p className="mt-2.5 auth-subtle text-[11px] leading-4"><Link href="/privacy" className="underline underline-offset-2">Privacy</Link><span className="mx-2">·</span><Link href="/terms" className="underline underline-offset-2">Terms</Link><span className="mx-2">·</span><Link href="/contact" className="underline underline-offset-2">Contact</Link></p>
      </>
    }>
      <div className="min-w-0 space-y-6 sm:space-y-7">
        {error && <div role="alert" className="rounded-xl border border-red-300/40 bg-red-50 px-3.5 py-3 text-[13px] leading-5 text-red-700">{error}</div>}
        <SocialAuthButtons next="/dashboard" />
        <div className="auth-divider flex items-center gap-3 text-[9px] font-semibold uppercase tracking-[0.18em] sm:text-[10px]"><span className="auth-divider-line h-px min-w-0 flex-1" /><span>or email</span><span className="auth-divider-line h-px min-w-0 flex-1" /></div>
        <form onSubmit={handleSignUp} className="space-y-5">
          <div className="space-y-1.5">
            <label htmlFor="signup-username" className="block auth-ink text-[13px] font-semibold leading-4">Username</label>
            <div className="auth-border auth-input flex min-h-[52px] items-center rounded-[14px] border transition focus-within:border-[var(--auth-accent)] focus-within:ring-4 focus-within:ring-[var(--auth-accent)]/10">
              <span className="auth-muted pl-4">@</span>
              <input id="signup-username" type="text" value={username} onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase())} required minLength={3} maxLength={24} autoCapitalize="none" autoComplete="username" className="auth-ink w-full bg-transparent px-2 py-3.5 text-[15px] outline-none" placeholder="alex" />
              {usernameStatus === 'checking' && <span className="auth-muted pr-3 text-xs">checking…</span>}
              {usernameStatus === 'free' && <span className="pr-3 text-xs font-semibold text-emerald-600">available ✓</span>}
              {usernameStatus === 'taken' && <span className="pr-3 text-xs font-semibold text-red-500">taken</span>}
            </div>
            <p className="auth-subtle mt-1 text-xs leading-5">3–24 characters: letters, numbers, underscores. People find you at /u/{handle || 'username'}.</p>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="signup-email" className="block auth-ink text-[13px] font-semibold leading-4">Email</label>
            <input id="signup-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" inputMode="email" placeholder="you@example.com" className="auth-border auth-input auth-ink min-h-[52px] w-full rounded-[14px] border px-4 py-3.5 text-[15px] outline-none transition focus:border-[var(--auth-accent)] focus:bg-[var(--auth-input-focus)] focus:ring-4 focus:ring-[var(--auth-accent)]/10" />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="signup-password" className="block auth-ink text-[13px] font-semibold leading-4">Password</label>
            <div className="relative">
              <input id="signup-password" type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} autoComplete="new-password" placeholder="Create a password" className="auth-border auth-input auth-ink min-h-[52px] w-full rounded-[14px] border px-4 py-3.5 pr-12 text-[15px] outline-none transition focus:border-[var(--auth-accent)] focus:bg-[var(--auth-input-focus)] focus:ring-4 focus:ring-[var(--auth-accent)]/10" />
              <button type="button" onClick={() => setShowPassword(!showPassword)} className="auth-control-icon absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-[14px] transition focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[var(--auth-accent)]/25" aria-label={showPassword ? 'Hide password' : 'Show password'}>
                {showPassword ? <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg> : <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 7-9.542 7-1.274 4.057-5.064 7-9.542 7z" /></svg>}
              </button>
            </div>
          </div>
          <label className="auth-muted flex items-start gap-2.5 text-xs leading-5"><input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} required className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--auth-primary-bg)]" /><span>I agree to the <Link href="/terms" target="_blank" className="auth-accent font-medium hover:underline">Terms of Service</Link> and <Link href="/privacy" target="_blank" className="auth-accent font-medium hover:underline">Privacy Policy</Link>.</span></label>
          <EnotesTurnstile ref={turnstileRef} siteKey={turnstileSiteKey} action="signup" onToken={handleCaptchaToken} onExpire={handleCaptchaReset} onError={handleCaptchaError} />
          <button type="submit" disabled={loading || !agreed || !handle || usernameStatus === 'taken' || usernameStatus === 'invalid' || !turnstileSiteKey || !captchaToken} className="auth-primary-button min-h-[52px] w-full rounded-[14px] px-4 py-3.5 text-[15px] font-semibold shadow-[0_8px_24px_rgba(0,0,0,.12)] transition hover:-translate-y-0.5 hover:shadow-[0_12px_28px_rgba(0,0,0,.16)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0">{loading ? 'Creating account...' : 'Sign Up'}</button>
        </form>
      </div>
    </AuthShell>
  );
}
