'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';
import { CallProvider } from '@/components/chat/CallProvider';
import CallOverlay from '@/components/chat/CallOverlay';
import AppNav from '@/components/social/AppNav';
import NotesAside from '@/components/notes/NotesAside';
import { AlertProvider } from '@/components/ui/Alert';

/**
 * Routes that render their own chrome (fixed top bars, editors, viewers).
 * They intentionally DON'T get the global nav + desktop top spacer:
 *  - /studio/video  → full-screen editing workspace (own dark chrome)
 *  - /messages/[id] → conversation view (own header with back button)
 *  - /videos        → full-screen dark video feed (own header + actions)
 *  - / , /auth/*    → marketing landing + auth forms (own minimal chrome)
 *  - /notes/[id]    → note editor (own toolbar, focus surface)
 * Everything else gets ONE nav, mounted exactly once by the shell, so the
 * fixed bar's spacer can never land in the wrong place per-page.
 */
const IMMERSIVE_ROUTES = [
  /^\/studio\/video(\/|$)/,
  /^\/messages\/[^/]+$/,
  /^\/videos$/,
  /^\/$/,
  /^\/auth(\/|$)/,
  /^\/notes\/[^/]+$/,
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [myId, setMyId] = useState<string | null>(null);
  const [asideEnabled, setAsideEnabled] = useState(false);
  const pathname = usePathname() || '/';

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => setMyId(user?.id || null));
  }, []);

  /* The notes sidebar is viewport-driven and always mounted once signed in,
     so it never depends on a per-page choice and never needs a refresh. */
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1280px)');
    const apply = () => setAsideEnabled(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  const immersive = IMMERSIVE_ROUTES.some((re) => re.test(pathname));

  /* Pages that own their full layout and must not carry the notes aside:
     the feed, every journal surface (view, Studio editor, settings) and
     the admin console (dashboard, template moderation, reports). */
  const NO_ASIDE_ROUTES = [
    /^\/journals(\/|$)/,
    /^\/admin(\/|$)/,
  ];
  const asideHidden = NO_ASIDE_ROUTES.some((re) => re.test(pathname));
  const showAside = asideEnabled && !asideHidden;

  /* Signed-out visitors never see the app nav (the landing page and auth
     pages carry their own chrome). Applied on the NEXT paint after the
     session resolves, so a refresh on a signed-out page removes it without
     a flicker of wrong chrome. */
  const [showNav, setShowNav] = useState(false);
  useEffect(() => {
    if (immersive) {
      setShowNav(false);
      return;
    }
    let active = true;
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (active) setShowNav(!!session?.user);
    });
    return () => {
      active = false;
    };
  }, [immersive, pathname]);

  return (
    <CallProvider myId={myId}>
      <AlertProvider>
      {showNav && <AppNav />}
      {/* plain div (pages render their own <main>). Mobile: bottom runway so
          the LAST item can always scroll clear of the fixed bottom nav AND
          the floating create button (its top reaches ~136px above the viewport
          bottom). Desktop: padding offsets the fixed top bar; wide screens
          also reserve the right rail so content never slides under it. */}
      <div
        className={
          immersive
            ? ''
            : `pb-[calc(9rem+env(safe-area-inset-bottom))] md:pb-0 ${showNav ? 'md:pt-14' : ''} ${
                showAside ? 'xl:pl-[21rem]' : ''
              }`
        }
      >
        {children}
      </div>
      {/* Wide screens: the notes aside rides beside signed-in content pages
          except the ones that own their layout (feed, journals, editors,
          viewers) and signed-out visitors. */}
      {showNav && showAside && <NotesAside />}
      <CallOverlay />
      </AlertProvider>
    </CallProvider>
  );
}
