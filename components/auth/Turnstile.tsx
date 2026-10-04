'use client';

import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';

type TurnstileWidget = {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      theme?: 'auto' | 'light' | 'dark';
      size?: 'normal' | 'flexible' | 'compact';
      action?: string;
      callback?: (token: string) => void;
      'expired-callback'?: () => void;
      'error-callback'?: () => void;
    }
  ) => string;
  reset: (widgetId?: string) => void;
  remove?: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileWidget;
  }
}

let turnstileReady: Promise<void> | null = null;

function loadTurnstile(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.turnstile) return Promise.resolve();
  if (turnstileReady) return turnstileReady;

  turnstileReady = new Promise<void>((resolve, reject) => {
    const existing = document.getElementById('enotes-turnstile-script') as HTMLScriptElement | null;

    const finish = () => {
      if (window.turnstile) resolve();
      else reject(new Error('Cloudflare Turnstile loaded without its API.'));
    };

    if (existing) {
      existing.addEventListener('load', finish, { once: true });
      existing.addEventListener(
        'error',
        () => reject(new Error('Could not load Cloudflare Turnstile.')),
        { once: true }
      );
      return;
    }

    const script = document.createElement('script');
    script.id = 'enotes-turnstile-script';
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.defer = true;
    script.onload = finish;
    script.onerror = () => reject(new Error('Could not load Cloudflare Turnstile.'));
    document.head.appendChild(script);
  });

  return turnstileReady;
}

export type TurnstileHandle = {
  reset: () => void;
  getToken: () => string | null;
};

type TurnstileProps = {
  siteKey: string;
  action: string;
  onToken: (token: string) => void;
  onExpire?: () => void;
  onError?: () => void;
};

const EnotesTurnstile = forwardRef<TurnstileHandle, TurnstileProps>(function EnotesTurnstile(
  { siteKey, action, onToken, onExpire, onError },
  ref
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const tokenRef = useRef<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useImperativeHandle(
    ref,
    () => ({
      reset() {
        tokenRef.current = null;
        if (widgetIdRef.current && window.turnstile) {
          window.turnstile.reset(widgetIdRef.current);
        }
      },
      getToken() {
        return tokenRef.current;
      },
    }),
    []
  );

  useEffect(() => {
    let cancelled = false;

    if (!siteKey) {
      setLoadError('Turnstile site key is not configured.');
      return;
    }

    loadTurnstile()
      .then(() => {
        if (cancelled || !containerRef.current || !window.turnstile) return;

        if (widgetIdRef.current) {
          window.turnstile.remove?.(widgetIdRef.current);
          widgetIdRef.current = null;
        }

        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          theme: 'light',
          // Flexible mode lets Cloudflare size the challenge to the available
          // width instead of forcing the desktop 300px widget onto small phones.
          size: 'flexible',
          action,
          callback: (token) => {
            tokenRef.current = token;
            onToken(token);
          },
          'expired-callback': () => {
            tokenRef.current = null;
            onExpire?.();
          },
          'error-callback': () => {
            tokenRef.current = null;
            onError?.();
          },
        });
      })
      .catch((error) => {
        if (!cancelled) {
          console.error('Turnstile error:', error);
          setLoadError('The security check could not load. Please refresh and try again.');
          onError?.();
        }
      });

    return () => {
      cancelled = true;
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove?.(widgetIdRef.current);
        widgetIdRef.current = null;
      }
      tokenRef.current = null;
    };
  }, [siteKey, action, onToken, onExpire, onError]);

  if (loadError) {
    return (
      <div className="w-full min-w-0 rounded-2xl border border-amber-200/80 bg-amber-50/80 px-3 py-3 text-xs leading-relaxed text-amber-900 shadow-sm sm:px-4">
        <div className="flex min-w-0 items-start gap-2.5">
          <span
            aria-hidden="true"
            className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-100 text-[11px] font-bold"
          >
            !
          </span>
          <div className="min-w-0">
            <p className="font-semibold">Security check unavailable</p>
            <p className="mt-0.5 text-amber-800">{loadError}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <section
      className="w-full min-w-0 max-w-full overflow-hidden rounded-2xl border border-black/[0.07] bg-white/75 p-2.5 shadow-[0_8px_24px_rgba(0,0,0,0.05)] backdrop-blur-sm sm:p-3.5"
      aria-label="Security verification"
    >
      <div className="mb-2.5 flex min-w-0 items-center justify-between gap-2 px-0.5 sm:gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden="true"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#1e90ff]/10 text-[#1e90ff]"
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 3 5 6v5c0 4.5 2.9 8.4 7 10 4.1-1.6 7-5.5 7-10V6l-7-3Z" />
              <path d="m9.2 12 1.8 1.8 3.8-4" />
            </svg>
          </span>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold leading-tight text-black">Security check</p>
            <p className="mt-0.5 text-[11px] leading-tight text-black/50">
              Verify that you’re human to continue.
            </p>
          </div>
        </div>
        <span className="shrink-0 rounded-full bg-black/[0.035] px-1.5 py-1 text-[8px] font-medium uppercase tracking-[0.1em] text-black/40 sm:px-2 sm:text-[9px] sm:tracking-[0.12em]">
          Protected
        </span>
      </div>

      <div
        ref={containerRef}
        className="flex min-h-[65px] w-full min-w-0 max-w-full items-center justify-center overflow-hidden rounded-xl bg-white [&>div]:w-full [&>div]:max-w-full [&_iframe]:max-w-full"
      />
    </section>
  );
});

export default EnotesTurnstile;
