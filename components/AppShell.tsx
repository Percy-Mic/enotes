'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';
import { CallProvider } from '@/components/chat/CallProvider';
import { GroupCallProvider } from '@/components/chat/GroupCallProvider';
import CallOverlay from '@/components/chat/CallOverlay';
import AppNav from '@/components/social/AppNav';
import NotesAside from '@/components/notes/NotesAside';
import { AlertProvider } from '@/components/ui/Alert';
import PushNotificationGate from '@/components/notifications/PushNotificationGate';
import InAppNotificationCenter from '@/components/notifications/InAppNotificationCenter';
import NotificationQuietMode from '@/components/notifications/NotificationQuietMode';

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

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1280px)');
    const apply = () => setAsideEnabled(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  const immersive = IMMERSIVE_ROUTES.some((re) => re.test(pathname));

  const NO_ASIDE_ROUTES = [
    /^\/journals(\/|$)/,
    /^\/admin(\/|$)/,
  ];
  const asideHidden = NO_ASIDE_ROUTES.some((re) => re.test(pathname));
  const showAside = asideEnabled && !asideHidden;

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
                : `pb-[calc(9rem+env(safe-area-inset-bottom))] md:pb-0 ${showNav ? 'md:pt-14' : ''} ${
                    showAside ? 'xl:pl-[21rem]' : ''
                  }`
            }
          >
            {children}
          </div>
          {showNav && showAside && <NotesAside />}
          <CallOverlay />
          <InAppNotificationCenter userId={myId} />
          <NotificationQuietMode userId={myId} />
          <PushNotificationGate userId={myId} />
        </AlertProvider>
      </GroupCallProvider>
    </CallProvider>
  );
}
