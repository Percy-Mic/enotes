'use client';

import { useEffect, useState } from 'react';
import { Bell, BellOff, ChevronDown, Clock3, X } from 'lucide-react';
import { usePathname } from 'next/navigation';
import {
  clearQuietMode,
  formatQuietRemaining,
  getQuietState,
  setQuietMode,
  type QuietDuration,
} from '@/lib/notifications/quiet';

const OPTIONS = [
  [30, '30 minutes'],
  [60, '1 hour'],
  [120, '2 hours'],
  [0, 'Until I turn it off'],
] as const;

export default function NotificationQuietMode({ userId }: { userId: string | null }) {
  const pathname = usePathname() || '/';
  const [until, setUntil] = useState<number | null>(null);
  const [quietEnabled, setQuietEnabled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const refresh = async () => {
      if (!userId) {
        setUntil(null);
        setQuietEnabled(false);
        setOpen(false);
        return;
      }

      const state = await getQuietState();

      if (!cancelled) {
        const matchesUser = state.userId === userId;
        setUntil(matchesUser ? state.until : null);
        setQuietEnabled(matchesUser);
      }
    };

    void refresh();

    const timer = window.setInterval(() => {
      void refresh();
    }, 30_000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [userId]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  if (!userId) return null;

  const quiet = quietEnabled && (until === null || until > Date.now());

  const enable = async (duration: QuietDuration) => {
    const state = await setQuietMode(userId, duration);
    setUntil(state.until);
    setQuietEnabled(true);
    setOpen(false);
  };

  const disable = async () => {
    await clearQuietMode();
    setUntil(null);
    setQuietEnabled(false);
    setOpen(false);
  };

  const panelContent = (
    <>
      <div className="flex items-start justify-between gap-3 px-3 pb-2 pt-2">
        <div>
          <p className="text-sm font-bold text-[#171315]">
            {quiet ? 'Quiet mode is on' : 'Notification settings'}
          </p>
          <p className="mt-1 text-[11px] leading-4 text-[#766D71]">
            {quiet
              ? 'Notifications are paused for ' + formatQuietRemaining(until) + '.'
              : 'Pause messages, calls, and in-app alerts while you watch.'}
          </p>
        </div>

        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close notification settings"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#766D71] hover:bg-[#F8F3F5] hover:text-[#3C3538]"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {quiet ? (
        <button
          type="button"
          onClick={() => void disable()}
          className="flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-left text-xs font-semibold text-[#E5798F] hover:bg-[#FFF0F3]"
        >
          <Bell className="h-4 w-4" />
          Turn notifications back on
        </button>
      ) : (
        <div className="space-y-1">
          {OPTIONS.map(([duration, label]) => (
            <button
              key={label}
              type="button"
              onClick={() => void enable(duration)}
              className="flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-left text-xs font-semibold text-[#3C3538] hover:bg-[#F8F3F5] active:bg-[#F3EAED]"
            >
              <Clock3 className="h-4 w-4 text-[#E5798F]" />
              {label}
            </button>
          ))}
        </div>
      )}
    </>
  );

  const isChat = /^\/messages(?:\/|$)/.test(pathname);

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-[450] md:hidden"
          role="presentation"
          onClick={() => setOpen(false)}
        >
          <div className="absolute inset-0 bg-black/10 backdrop-blur-[1px]" />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Notification settings"
            onClick={(event) => event.stopPropagation()}
            className="absolute bottom-[calc(8.75rem+env(safe-area-inset-bottom))] left-2 right-2 max-h-[min(70vh,360px)] overflow-y-auto rounded-3xl border border-white/80 bg-white/95 p-2 shadow-[0_24px_70px_rgba(20,12,16,0.24)] backdrop-blur-2xl"
          >
            {panelContent}
          </div>
        </div>
      )}

      <div className="pointer-events-none fixed bottom-4 right-4 z-[390] hidden md:block">
        {open && (
          <div
            role="dialog"
            aria-label="Notification settings"
            className="pointer-events-auto absolute bottom-14 right-0 w-[280px] overflow-hidden rounded-2xl border border-white/70 bg-white/95 p-2 shadow-[0_18px_50px_rgba(20,12,16,0.18)] backdrop-blur-xl"
          >
            {panelContent}
          </div>
        )}

        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-label={quiet ? 'Notification quiet mode is on' : 'Notification settings'}
          title={quiet ? 'Quiet mode' : 'Notification settings'}
          className={
            'pointer-events-auto flex h-11 items-center gap-2 rounded-full border px-4 text-xs font-bold shadow-[0_12px_35px_rgba(20,12,16,0.16)] backdrop-blur-xl transition ' +
            (quiet
              ? 'border-[#F2C1CB] bg-[#FFF0F3] text-[#C85E76]'
              : 'border-white/70 bg-white/90 text-[#4D4549] hover:bg-white')
          }
        >
          {quiet ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
          <span>{quiet ? 'Quiet mode' : 'Notifications'}</span>
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
      </div>

      {!isChat && (
        <div className="pointer-events-none fixed bottom-[calc(9.25rem+env(safe-area-inset-bottom))] right-3 z-[390] md:hidden">
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-label={quiet ? 'Notification quiet mode is on' : 'Notification settings'}
            title={quiet ? 'Quiet mode' : 'Notification settings'}
            className={
              'pointer-events-auto flex h-11 w-11 items-center justify-center rounded-full border shadow-[0_12px_35px_rgba(20,12,16,0.16)] backdrop-blur-xl transition ' +
              (quiet
                ? 'border-[#F2C1CB] bg-[#FFF0F3] text-[#C85E76]'
                : 'border-white/70 bg-white/90 text-[#4D4549]')
            }
          >
            {quiet ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
          </button>
        </div>
      )}
    </>
  );
}
