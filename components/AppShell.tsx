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
 * Everything else gets ONE nav, mounted exactly once by the shell, so the
 * fixed bar's spacer can never land in the wrong place per-page.
 */
const IMMERSIVE_ROUTES = [/^\/studio\/video(\/|$)/, /^\/messages\/[^/]+$/, /^\/videos$/];

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

  return (
    <CallProvider myId={myId}>
      <AlertProvider>
      {!immersive && <AppNav />}
      {/* plain div (pages render their own <main>). Mobile: bottom runway so
          the LAST item can always scroll clear of the fixed bottom nav AND
          the floating create button (its top reaches ~136px above the viewport
          bottom). Desktop: padding offsets the fixed top bar; wide screens
          also reserve the right rail so content never slides under it. */}
      <div
        className={
          immersive
            ? ''
            : `pb-[calc(9rem+env(safe-area-inset-bottom))] md:pb-0 md:pt-14 ${
                asideEnabled ? 'xl:pr-[21rem]' : ''
              }`
        }
      >
        {children}
      </div>
      {!immersive && asideEnabled && <NotesAside />}
      <CallOverlay />
      </AlertProvider>
    </CallProvider>
  );
}
