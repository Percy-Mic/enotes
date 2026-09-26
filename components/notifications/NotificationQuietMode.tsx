'use client';

import { useEffect, useState } from 'react';
import { Bell, BellOff, ChevronDown, Clock3 } from 'lucide-react';
import {
  clearQuietMode,
  formatQuietRemaining,
  getQuietState,
  setQuietMode,
  type QuietDuration,
} from '@/lib/notifications/quiet';

export default function NotificationQuietMode({ userId }: { userId: string | null }) {
  const [until, setUntil] = useState<number | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      if (!userId) { setUntil(null); return; }
      const state = await getQuietState();
      if (!cancelled) setUntil(state.userId === userId ? state.until : null);
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [userId]);

  if (!userId) return null;
  const quiet = Boolean(until && until > Date.now());

  const enable = async (duration: QuietDuration) => {
    const state = await setQuietMode(userId, duration);
    setUntil(state.until);
    setOpen(false);
  };

  const disable = async () => {
    await clearQuietMode();
    setUntil(null);
    setOpen(false);
  };

  return (
    <div className="fixed bottom-[calc(5.75rem+env(safe-area-inset-bottom))] right-3 z-[390] md:bottom-4 md:right-4">
      {open && (
        <div className="absolute bottom-14 right-0 w-[250px] overflow-hidden rounded-2xl border border-white/70 bg-white/95 p-2 shadow-[0_18px_50px_rgba(20,12,16,0.18)] backdrop-blur-xl">
          <div className="px-3 pb-2 pt-2">
            <p className="text-sm font-bold text-[#171315]">{quiet ? 'Quiet mode is on' : 'Notification settings'}</p>
            <p className="mt-1 text-[11px] leading-4 text-[#766D71]">
              {quiet ? 'Notifications are paused for ' + formatQuietRemaining(until) + '.' : 'Pause messages, calls, and in-app alerts while you watch.'}
            </p>
          </div>
          {quiet ? (
            <button type="button" onClick={() => void disable()} className="flex min-h-10 w-full items-center gap-2 rounded-xl px-3 text-left text-xs font-semibold text-[#E5798F] hover:bg-[#FFF0F3]">
              <Bell className="h-4 w-4" /> Turn notifications back on
            </button>
          ) : (
            <div className="space-y-1">
              {([[30, '30 minutes'], [60, '1 hour'], [120, '2 hours'], [0, 'Until I turn it off']] as const).map(([duration, label]) => (
                <button key={label} type="button" onClick={() => void enable(duration)} className="flex min-h-10 w-full items-center gap-2 rounded-xl px-3 text-left text-xs font-semibold text-[#3C3538] hover:bg-[#F8F3F5]">
                  <Clock3 className="h-4 w-4 text-[#E5798F]" /> {label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <button type="button" onClick={() => setOpen((v) => !v)} aria-label={quiet ? 'Notification quiet mode is on' : 'Notification settings'} title={quiet ? 'Quiet mode' : 'Notification settings'} className={'flex h-11 items-center gap-2 rounded-full border px-4 text-xs font-bold shadow-[0_12px_35px_rgba(20,12,16,0.16)] backdrop-blur-xl transition ' + (quiet ? 'border-[#F2C1CB] bg-[#FFF0F3] text-[#C85E76]' : 'border-white/70 bg-white/90 text-[#4D4549] hover:bg-white')}>
        {quiet ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
        <span className="hidden sm:inline">{quiet ? 'Quiet mode' : 'Notifications'}</span>
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
