'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Bell, BookOpen, Compass, Home, ImagePlus, MessageCircle, NotebookPen, Pencil, Plus, StickyNote, User, Users, X } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { THEME_ICONS, THEME_LABELS } from '@/components/ThemeToggle';
import { useTheme } from '@/lib/theme';

const TABS = [
  { href: '/feed', label: 'Feed', icon: Home },
  { href: '/journals', label: 'Journals', icon: BookOpen },
  { href: '/search', label: 'Search', icon: Compass },
  { href: '/messages', label: 'Chats', icon: MessageCircle },
  { href: '/notifications', label: 'Alerts', icon: Bell },
  { href: '__profile__', label: 'You', icon: User },
] as const;

/* Desktop gets one extra quick link; on mobile Communities lives in the
   bottom bar and in the create sheet. Notes is desktop-only via the fixed
   sidebar — the nav intentionally has no Notes entry on any screen size. */
const DESKTOP_EXTRA_TABS = [
  { href: '/communities', label: 'Groups', icon: Users },
] as const;

const COMMUNITIES_TAB = { href: '/communities', label: 'Groups', icon: Users };

/* Notes lives in the mobile bottom bar (desktop gets it via DESKTOP_EXTRA_TABS). */
const NOTES_TAB = { href: '/notes', label: 'Notes', icon: StickyNote };

export default function AppNav() {
  const pathname = usePathname();
  const { mode: themeMode, cycle: cycleThemeMobile } = useTheme();
  const [me, setMe] = useState<{ username?: string; id: string } | null>(null);
  const [unread, setUnread] = useState(0);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [signedOut, setSignedOut] = useState(false);

  useEffect(() => {
    let active = true;

    /* Paint the header immediately from the local session — the nav links
       (Feed/Journals/…) must never wait on a network roundtrip or a manual
       refresh. The profile fetch below only refines the profile link after. */
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!active) return;
      if (!session?.user) {
        setSignedOut(true);
        return;
      }
      setMe((prev) => prev ?? { id: session.user.id });
    });

    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        /* Anonymous visitor on a public page (/, /auth/*, /privacy …):
           render nothing — the signed-in app nav (Feed/Journals/Chats…)
           is meaningless here and every tab just dead-ends at sign-in. */
        if (active) setSignedOut(true);
        return;
      }
      if (!active) {
        return;
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('id, username')
        .eq('id', user.id)
        .maybeSingle();

      if (active && profile) {
        setMe(profile as { id: string; username?: string });
      }
    })();

    /* Unread notifications + new-message badge via realtime */
    const channel = supabase
      .channel('nav-badges')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications' },
        () => setUnread((n) => n + 1),
      )
      .subscribe();

    (async () => {
      const { count } = await supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('read', false);
      if (active) {
        setUnread(count || 0);
      }
    })();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [pathname]);

  const isActive = (tab: { href: string }) => {
    if (tab.href === '__profile__') {
      /* Your content: profile, settings, stories */
      return pathname.startsWith('/u/') || pathname.startsWith('/settings') || pathname.startsWith('/stories');
    }
    if (tab.href === '/journals') {
      /* Journal book/edit/settings views belong to the Journals tab */
      return pathname === '/journals' || pathname.startsWith('/journals/') || pathname === '/dashboard' || pathname.startsWith('/dashboard');
    }
    return pathname.startsWith(tab.href);
  };

  const profileHref = me?.username ? `/u/${me.username}` : '/settings/profile';

  if (signedOut) return null;

  return (
    <>
      {/* Desktop top links — FIXED to the viewport so they never scroll away.
          Rendered ONCE by AppShell; spacing is handled there (md:pt-14). */}
      <nav className="fixed inset-x-0 top-0 z-50 hidden border-b border-[#E8E2E4] bg-white/90 backdrop-blur md:block">
        <div className="mx-auto flex max-w-6xl items-center justify-end gap-1 px-6 py-2">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const active = isActive(tab);
            const href = tab.href === '__profile__' ? profileHref : tab.href;
            return (
              <Link
                key={tab.href}
                href={href}
                className={`relative flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium transition ${
                  active ? 'bg-black/5 text-[#111111]' : 'text-[#6B6B6B] hover:bg-black/5'
                }`}
              >
                <Icon className="h-4.5 w-4.5" />
                {tab.label}
                {tab.href === '/notifications' && unread > 0 && (
                  <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#E5798F] px-1 text-[10px] font-bold text-white">
                    {unread > 9 ? '9+' : unread}
                  </span>
                )}
              </Link>
            );
          })}

          {DESKTOP_EXTRA_TABS.map((tab) => {
            const Icon = tab.icon;
            const active = isActive(tab);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`relative flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium transition ${
                  active ? 'bg-black/5 text-[#111111]' : 'text-[#6B6B6B] hover:bg-black/5'
                }`}
              >
                <Icon className="h-4.5 w-4.5" />
                {tab.label}
              </Link>
            );
          })}

          <Link
            href="/feed?compose=1"
            aria-label="Create a post"
            className="flex items-center gap-1.5 rounded-xl bg-black px-3 py-2 text-sm font-semibold text-[#FFB6C1] shadow transition hover:opacity-90"
          >
            <Pencil className="h-4 w-4" />
            Post
          </Link>
        </div>
      </nav>

      {/* Mobile bottom tab bar: 8 tabs arranged 5/3 around the floating FAB */}
      <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-[#E8E2E4] bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        <div className="mx-auto grid max-w-lg grid-cols-8">
          {/* left cluster: Feed / Journals / Search / Chats / Notes */}
          {TABS.slice(0, 4).map((tab) => {
            const Icon = tab.icon;
            const active = isActive(tab);
            const href = tab.href;
            return (
              <Link
                key={tab.href}
                href={href}
                className={`relative flex flex-col items-center gap-0.5 py-2.5 text-[9px] font-semibold ${
                  active ? 'text-[#111111]' : 'text-[#9B9B9B]'
                }`}
              >
                <Icon className="h-5.5 w-5.5" />
                {tab.label}
                {active && <span className="mt-0.5 h-1 w-5 rounded-full bg-[#E5798F]" />}
              </Link>
            );
          })}
          {/* right cluster: Notes / Alerts / Groups / You */}
          {[NOTES_TAB, TABS[4], COMMUNITIES_TAB, TABS[5]].map((tab) => {
            const Icon = tab.icon;
            const active = isActive(tab);
            const href = tab.href === '__profile__' ? profileHref : tab.href;
            return (
              <Link
                key={tab.href}
                href={href}
                className={`relative flex flex-col items-center gap-0.5 py-2.5 text-[9px] font-semibold ${
                  active ? 'text-[#111111]' : 'text-[#9B9B9B]'
                }`}
              >
                <Icon className="h-5.5 w-5.5" />
                {tab.label}
                {tab.href === '/notifications' && unread > 0 && (
                  <span className="absolute right-1/2 top-1 flex h-4 min-w-4 translate-x-4 items-center justify-center rounded-full bg-[#E5798F] px-1 text-[9px] font-bold text-white">
                    {unread > 9 ? '9+' : unread}
                  </span>
                )}
                {active && <span className="mt-0.5 h-1 w-5 rounded-full bg-[#E5798F]" />}
              </Link>
            );
          })}
        </div>
      </nav>
      {sheetOpen && (
        <>
          <button
            aria-label="Close menu"
            className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px] md:hidden"
            onClick={() => setSheetOpen(false)}
          />
          <div className="fixed bottom-36 right-4 z-50 w-56 overflow-hidden rounded-2xl border border-[#E8E2E4] bg-white shadow-xl md:hidden">
            <p className="border-b border-[#F0EAEC] px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-[#9B9B9B]">
              Create
            </p>
            <Link
              href="/feed?compose=1"
              onClick={() => setSheetOpen(false)}
              className="flex min-h-[48px] items-center gap-3 px-4 text-sm font-semibold text-[#111111] transition hover:bg-[#FFF7F8]"
            >
              <Pencil className="h-4.5 w-4.5 text-[#E5798F]" /> Post, note, photo or video
            </Link>
            <Link
              href="/stories/new"
              onClick={() => setSheetOpen(false)}
              className="flex min-h-[48px] items-center gap-3 px-4 text-sm font-semibold text-[#111111] transition hover:bg-[#FFF7F8]"
            >
              <ImagePlus className="h-4.5 w-4.5 text-[#E5798F]" /> Add a story
            </Link>
            <Link
              href="/dashboard/create-journal"
              onClick={() => setSheetOpen(false)}
              className="flex min-h-[48px] items-center gap-3 px-4 text-sm font-semibold text-[#111111] transition hover:bg-[#FFF7F8]"
            >
              <NotebookPen className="h-4.5 w-4.5 text-[#E5798F]" /> New journal
            </Link>
            <Link
              href="/communities"
              onClick={() => setSheetOpen(false)}
              className="flex min-h-[48px] items-center gap-3 px-4 text-sm font-semibold text-[#111111] transition hover:bg-[#FFF7F8]"
            >
              <Users className="h-4.5 w-4.5 text-[#E5798F]" /> Communities
            </Link>
            <button
              type="button"
              onClick={cycleThemeMobile}
              className="flex min-h-[48px] w-full items-center gap-3 border-t border-[#F0EAEC] px-4 text-sm font-semibold text-[#111111] transition hover:bg-[#FFF7F8]"
            >
              {(() => {
                const ThemeIcon = THEME_ICONS[themeMode];
                return <ThemeIcon className="h-4.5 w-4.5 text-[#E5798F]" />;
              })()}
              Theme: {THEME_LABELS[themeMode]}
            </button>
          </div>
        </>
      )}
      <button
        aria-label={sheetOpen ? 'Close create menu' : 'Open create menu'}
        onClick={() => setSheetOpen((v) => !v)}
        className="fixed bottom-20 right-4 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-black text-[#FFB6C1] shadow-lg shadow-black/25 transition active:scale-95 md:hidden"
      >
        {sheetOpen ? <X className="h-6 w-6" /> : <Plus className="h-7 w-7" />}
      </button>
    </>
  );
}
