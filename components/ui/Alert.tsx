'use client';

import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, Loader2, X, XCircle } from 'lucide-react';

/**
 * App-wide styled alert — replaces window.alert(). Provider lives in
 * AppShell; any client component calls `const alert = useAlert()` and
 * `await alert({ title, message, tone })`. The promise resolves when the
 * dialog is dismissed, so existing `alert(...)` call sites convert with an
 * `await` and keep their surrounding control flow.
 */

export type AlertTone = 'info' | 'success' | 'error' | 'warning';

export interface AlertOptions {
  title?: string;
  message: React.ReactNode;
  tone?: AlertTone;
  confirmLabel?: string;
  /** second button; when present the dialog becomes confirm/cancel */
  cancelLabel?: string;
  /** called only when the confirm button is pressed (not on cancel/Escape) */
  onConfirm?: () => void;
}

interface ActiveAlert extends AlertOptions {
  key: number;
  resolve: () => void;
}

const AlertContext = createContext<((opts: AlertOptions) => Promise<void>) | null>(null);

const TONE_STYLES: Record<AlertTone, { icon: React.ReactNode; ring: string }> = {
  info: { icon: <Info className="h-5 w-5 text-[#5B8DEF]" />, ring: 'bg-[#5B8DEF]/10' },
  success: { icon: <CheckCircle2 className="h-5 w-5 text-emerald-500" />, ring: 'bg-emerald-500/10' },
  error: { icon: <XCircle className="h-5 w-5 text-red-500" />, ring: 'bg-red-500/10' },
  warning: { icon: <AlertTriangle className="h-5 w-5 text-amber-500" />, ring: 'bg-amber-500/10' },
};

export function AlertProvider({ children }: { children: React.ReactNode }) {
  const [queue, setQueue] = useState<ActiveAlert[]>([]);

  const alert = useCallback((opts: AlertOptions) => {
    return new Promise<void>((resolve) => {
      setQueue((q) => [...q, { ...opts, key: Date.now() + Math.random(), resolve }]);
    });
  }, []);

  const dismiss = useCallback((key: number, confirmed = false) => {
    setQueue((q) => {
      const found = q.find((a) => a.key === key);
      if (found && confirmed) found.onConfirm?.();
      found?.resolve();
      return q.filter((a) => a.key !== key);
    });
  }, []);

  const value = useMemo(() => alert, [alert]);
  const current = queue[0];

  return (
    <AlertContext.Provider value={value}>
      {children}
      {current && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
          role="alertdialog"
          aria-modal="true"
          aria-label={current.title || 'Alert'}
          onKeyDown={(e) => { if (e.key === 'Escape') dismiss(current.key); }}
          tabIndex={-1}
          ref={(el) => el?.focus()}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <span className={`flex h-10 w-10 items-center justify-center rounded-full ${TONE_STYLES[current.tone || 'info'].ring}`}>
                {TONE_STYLES[current.tone || 'info'].icon}
              </span>
              <button
                onClick={() => dismiss(current.key)}
                className="flex h-8 w-8 items-center justify-center rounded-full text-[#6B6B6B] transition hover:bg-gray-100"
                aria-label="Dismiss"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {current.title && <h2 className="mb-1 text-base font-bold text-[#111111]">{current.title}</h2>}
            <div className="text-sm text-[#6B6B6B]">{current.message}</div>
            {current.cancelLabel && (
              <button
                onClick={() => dismiss(current.key)}
                className="mt-4 min-h-[44px] w-full rounded-xl border border-[#E8E2E4] py-2.5 text-sm font-bold text-[#6B6B6B] transition hover:bg-gray-50"
              >
                {current.cancelLabel}
              </button>
            )}
            <button
              onClick={() => dismiss(current.key, true)}
              className={`mt-4 min-h-[44px] w-full rounded-xl py-2.5 text-sm font-bold transition ${
                current.tone === 'error' || current.tone === 'warning'
                  ? 'bg-red-600 text-white hover:bg-red-700'
                  : 'bg-black text-[#FFB6C1] hover:opacity-90'
              }`}
            >
              {current.confirmLabel || 'OK'}
            </button>
          </div>
        </div>
      )}
    </AlertContext.Provider>
  );
}

export function useAlert() {
  const ctx = useContext(AlertContext);
  if (!ctx) {
    /* No provider above (shouldn't happen — AppShell mounts one). Fall back
       to native alert so a wiring mistake never eats a user-facing error. */
    return (opts: AlertOptions) => {
      window.alert(typeof opts.message === 'string' ? opts.message : opts.title || 'Alert');
      return Promise.resolve();
    };
  }
  return ctx;
}
