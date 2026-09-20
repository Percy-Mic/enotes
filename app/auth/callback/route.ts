import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * Auth callback — handles BOTH link styles Supabase can send:
 *  - PKCE code links:      /auth/callback?code=…&next=/dashboard
 *  - OTP token-hash links: /auth/callback?token_hash=…&type=signup
 *
 * `next` is restricted to local paths so a crafted link can never bounce
 * users to an external site (open-redirect protection).
 */
function safeNext(raw: string | null): string {
  if (!raw) return '/dashboard';
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/dashboard';
  return raw;
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type');
  const oauthError = searchParams.get('error');
  const oauthErrorDescription = searchParams.get('error_description');
  const next = safeNext(searchParams.get('next'));

  /* Supabase redirects here with ?error=… when the link is expired/already used */
  if (oauthError) {
    const reason =
      /expired|invalid|revoked/i.test(oauthErrorDescription || '')
        ? 'This confirmation link has expired or was already used. Sign in to request a fresh one.'
        : oauthErrorDescription || oauthError;
    return NextResponse.redirect(`${origin}/auth/sign-in?error=${encodeURIComponent(reason)}&resend=1`);
  }

  if (code) {
    try {
      const supabase = await createClient();
      const { error } = await supabase.auth.exchangeCodeForSession(code);

      if (!error) {
        return NextResponse.redirect(`${origin}${next}`);
      }

      console.error('Supabase code exchange error:', error.message);
      const friendly = /expired|used|invalid/i.test(error.message)
        ? 'This link has expired or was already used. Sign in to request a fresh confirmation email.'
        : error.message;
      return NextResponse.redirect(`${origin}/auth/sign-in?error=${encodeURIComponent(friendly)}&resend=1`);
    } catch (err: any) {
      console.error('Unexpected callback exception:', err);
      return NextResponse.redirect(
        `${origin}/auth/sign-in?error=${encodeURIComponent(err.message || 'Server error during authentication')}`
      );
    }
  }

  /* token_hash flow (OTP-style confirmation links) */
  if (tokenHash && type) {
    try {
      const supabase = await createClient();
      const { error } = await supabase.auth.verifyOtp({ type: type as any, token_hash: tokenHash });
      if (!error) {
        return NextResponse.redirect(`${origin}${next}`);
      }
      const friendly = /expired|used|invalid/i.test(error.message)
        ? 'This link has expired or was already used. Sign in to request a fresh confirmation email.'
        : error.message;
      return NextResponse.redirect(`${origin}/auth/sign-in?error=${encodeURIComponent(friendly)}&resend=1`);
    } catch (err: any) {
      return NextResponse.redirect(
        `${origin}/auth/sign-in?error=${encodeURIComponent(err.message || 'Verification failed')}`
      );
    }
  }

  return NextResponse.redirect(
    `${origin}/auth/sign-in?error=${encodeURIComponent('No authorization code provided')}`
  );
}
