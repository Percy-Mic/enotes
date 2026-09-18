import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/* ============================================================
   Default-deny route protection.

   PUBLIC_PREFIXES is the ONLY way an anonymous visitor reaches a page.
   Everything else — feed, search, messages, journals, studio, settings,
   communities, any route added in the future — requires an account.
   This is the guarantee that no intruder can browse the platform.

   Note: journal SHARE links now also require sign-in (deliberate — the
   platform is account-only). Once signed in, visibility of a shared
   journal is still decided by RLS (can_view_journal), never the client.

   Supabase Storage, /api/* webhooks, and static assets are excluded
   by the matcher below.
   ============================================================ */

const PUBLIC_PREFIXES = [
  '/',                        // landing
  '/auth',                    // sign-in / sign-up / callback / password reset
  '/contact',                 // static mailto page, linked from every auth + landing footer
  '/privacy',
  '/terms',
];

export async function middleware(request: NextRequest) {
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
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // IMPORTANT: always run getUser() — it refreshes expired access tokens.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  const isPublic = PUBLIC_PREFIXES.some((p) =>
    p === '/' ? pathname === '/' : pathname === p || pathname.startsWith(`${p}/`)
  );

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = '/auth/sign-in';
    url.search = '';
    url.searchParams.set('redirect', pathname);
    return NextResponse.redirect(url);
  }

  // Signed-in users don't need the auth pages
  if (user && (pathname.startsWith('/auth/sign-in') || pathname.startsWith('/auth/sign-up'))) {
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
     * Run on everything except:
     * - static assets (_next/static, images, fonts)
     * - Supabase Storage object paths (/storage/v1/...) — auth is enforced
     *   by bucket policies, not cookies
     * - API routes (/api/*) — each route authenticates itself; payment
     *   provider webhooks MUST NOT require app cookies
     */
    '/((?!_next/static|_next/image|favicon.ico|storage/|api/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)',
  ],
};