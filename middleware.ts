import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/* ============================================================
   Default-deny route protection.

   PUBLIC_PREFIXES is the ONLY way an anonymous visitor reaches
   a page, with the exception of explicitly public verification
   files such as the Google Search Console verification file.

   Supabase Storage, /api/* webhooks, and static assets are
   excluded by the matcher below.
   ============================================================ */

const PUBLIC_PREFIXES = [
  '/', // landing
  '/auth', // sign-in / sign-up / callback / password reset
  '/contact',
  '/privacy',
  '/terms',
];

// Google Search Console verification file.
// This MUST remain publicly accessible without authentication.
const GOOGLE_VERIFICATION_PATH =
  '/googlea8a22c5aff9efc8a.html';

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  /*
   * IMPORTANT:
   * Google Search Console must be able to access this file
   * without being redirected to /auth/sign-in.
   *
   * Return immediately BEFORE initializing Supabase.
   */
  if (pathname === GOOGLE_VERIFICATION_PATH) {
    return NextResponse.next();
  }

  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },

        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });

          supabaseResponse = NextResponse.next({
            request,
          });

          cookiesToSet.forEach(({ name, value, options }) => {
            supabaseResponse.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  // IMPORTANT:
  // Always run getUser() so expired access tokens can be refreshed.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isPublic = PUBLIC_PREFIXES.some((p) =>
    p === '/'
      ? pathname === '/'
      : pathname === p || pathname.startsWith(`${p}/`)
  );

  /*
   * Anonymous users can only access explicitly public routes.
   */
  if (!user && !isPublic) {
    const url = request.nextUrl.clone();

    url.pathname = '/auth/sign-in';
    url.search = '';
    url.searchParams.set('redirect', pathname);

    return NextResponse.redirect(url);
  }

  /*
   * Signed-in users don't need the auth pages.
   */
  if (
    user &&
    (pathname.startsWith('/auth/sign-in') ||
      pathname.startsWith('/auth/sign-up'))
  ) {
    const url = request.nextUrl.clone();

    url.pathname = '/dashboard';
    url.search = '';

    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    /*
     * Run on application routes except:
     *
     * - Google Search Console verification file
     * - Next.js static assets
     * - Next.js image optimization
     * - favicon
     * - common image/font assets
     * - Supabase Storage
     * - API routes
     */
    '/((?!_next/static|_next/image|favicon.ico|storage/|api/|googlea8a22c5aff9efc8a\\.html|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)',
  ],
};
