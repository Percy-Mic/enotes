'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';
import { CallProvider } from '@/components/chat/CallProvider';
import { GroupCallProvider } from '@/components/chat/GroupCallProvider';
import CallOverlay from '@/components/chat/CallOverlay';
import AppNav from '@/components/social/AppNav';
import { AlertProvider } from '@/components/ui/Alert';
import PushNotificationGate from '@/components/notifications/PushNotificationGate';
import InAppNotificationCenter from '@/components/notifications/InAppNotificationCenter';
import NotesAside from '@/components/notes/NotesAside';

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
  /* Keep the journal dashboard on the normal app navigation. Individual
     journal viewers/editors/settings remain immersive and keep their own
     focused controls. */
  /^\/journals\/[^/]+(\/|$)/,
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [myId, setMyId] = useState<string | null>(null);
  const pathname = usePathname() || '/';

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => setMyId(user?.id || null));
  }, []);

  const immersive = IMMERSIVE_ROUTES.some((re) => re.test(pathname));
  // Keep the Notes rail on normal app surfaces, but leave focused studio/editor
  // screens unobstructed. This only restores the UI; the notes table/schema is untouched.
  const notesRail = !immersive && !/^\/studio(\/|$)/.test(pathname);

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
      <GroupCallProvider myId={myId}>
        <AlertProvider>
          {showNav && <AppNav />}
          <div
            className={
              immersive
                ? ''
                : `pb-[calc(9rem+env(safe-area-inset-bottom))] md:pb-0 ${showNav ? 'md:pt-14' : ''} ${showNav && notesRail ? 'xl:pl-[21rem]' : ''}`
            }
          >
            {children}
          </div>
          {showNav && notesRail && <NotesAside />}
          <CallOverlay />
          <InAppNotificationCenter userId={myId} />
          <PushNotificationGate userId={myId} />
        </AlertProvider>
      </GroupCallProvider>
    </CallProvider>
  );
}
