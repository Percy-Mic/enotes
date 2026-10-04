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
      existing.addEventListener('error', () => reject(new Error('Could not load Cloudflare Turnstile.')), {
        once: true,
      });
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
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
        {loadError}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="flex min-h-[65px] w-full justify-center overflow-hidden rounded-lg"
      aria-label="Security verification"
    />
  );
});

export default EnotesTurnstile;
