'use client';

import { useEffect, useState } from 'react';
import { Bell, Check, Loader2, X } from 'lucide-react';
import {
  enablePush,
  getPushState,
  syncPushSubscription,
  type PushPermissionState,
} from '@/lib/notifications/push';

const SESSION_DISMISSED_KEY = 'enotes:push-onboarding-dismissed';

export default function PushNotificationGate({
  userId,
}: {
  userId: string | null;
}) {
  const [state, setState] = useState<PushPermissionState>('unsupported');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;

    let cancelled = false;

    void getPushState().then((next) => {
      if (cancelled) return;
      setState(next);

      if (next === 'granted' || next === 'subscribed') {
        void syncPushSubscription();
      }

      if (
        (next === 'default' || next === 'granted') &&
        sessionStorage.getItem(SESSION_DISMISSED_KEY) !== '1'
      ) {
        setOpen(true);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [userId]);

  const allowNotifications = async () => {
    setBusy(true);
    setMessage(null);

    const error = await enablePush();
    const next = await getPushState();

    setState(next);

    if (error) {
      setMessage(error);
      setBusy(false);
      return;
    }

    setOpen(false);
    sessionStorage.removeItem(SESSION_DISMISSED_KEY);
    setBusy(false);
  };

  const dismiss = () => {
    sessionStorage.setItem(SESSION_DISMISSED_KEY, '1');
    setOpen(false);
  };

  if (!open || !userId || state === 'unsupported' || state === 'denied') {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="enotes-notification-title"
        className="w-full max-w-sm overflow-hidden rounded-[28px] border border-black/5 bg-white shadow-2xl"
      >
        <div className="relative px-6 pb-7 pt-7 text-center">
          <button
            type="button"
            onClick={dismiss}
            disabled={busy}
            className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full text-[#8A8084] transition hover:bg-[#F7F1F3] disabled:opacity-40"
            aria-label="Not now"
          >
            <X className="h-4 w-4" />
          </button>

          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-[#FFF0F3] text-[#E5798F]">
            <Bell className="h-8 w-8" />
          </div>

          <h2
            id="enotes-notification-title"
            className="mt-5 text-xl font-bold tracking-tight text-[#171315]"
          >
            Stay connected
          </h2>

          <p className="mx-auto mt-2 max-w-xs text-sm leading-6 text-[#6B6266]">
            Allow notifications so enotes can alert you when someone messages
            you or calls you—even when the app is closed.
          </p>

          {message && (
            <div
              role="alert"
              className="mt-4 rounded-xl bg-amber-50 px-3 py-2.5 text-left text-xs leading-5 text-amber-800"
            >
              {message}
            </div>
          )}

          <button
            type="button"
            onClick={() => void allowNotifications()}
            disabled={busy}
            className="mt-6 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#171315] px-5 text-sm font-semibold text-[#FFB6C1] transition hover:bg-[#282024] active:scale-[0.99] disabled:cursor-wait disabled:opacity-60"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4" />
            )}
            {busy ? 'Enabling notifications…' : 'Enable notifications'}
          </button>

          <button
            type="button"
            onClick={dismiss}
            disabled={busy}
            className="mt-3 min-h-10 px-4 text-xs font-semibold text-[#8A8084] hover:text-[#171315] disabled:opacity-40"
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}
