'use client';

import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';

/* The install flow comes from the browser's beforeinstallprompt event:
   we stash it the moment it fires and hand it to whichever button is on
   screen. Chrome/Edge desktop + Android fire it once the PWA criteria
   (manifest + service worker + HTTPS) are met; Safari iOS and Firefox
   have no such event, so those users get honest "how to install"
   instructions instead of a dead button. The button itself is ALWAYS
   visible (except when already running as the installed app) — an
   invisible button would be indistinguishable from a missing one. */

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

let deferredPrompt: InstallPromptEvent | null = null;

if (typeof window !== 'undefined') {
  /* Installability needs an active service worker; register it here so the
     button's own feature doesn't depend on the notifications flow. */
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  }
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e as InstallPromptEvent;
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
  });
}

export default function DownloadAppButton({ compact = false }: { compact?: boolean }) {
  const [standalone, setStandalone] = useState(true); // pre-hydration: assume installed, correct on mount
  const [isIos, setIsIos] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(display-mode: standalone)');
    const apply = () => setStandalone(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    setIsIos(
      /iphone|ipad|ipod/i.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
    );
    return () => mq.removeEventListener('change', apply);
  }, []);

  /* Already installed → nothing to download. */
  if (standalone) return null;

  const onClick = async () => {
    if (deferredPrompt) {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') deferredPrompt = null;
      return;
    }
    /* No native prompt this session (iOS, Firefox, or criteria not yet
       met) — tell the user exactly how to install instead. */
    if (isIos) {
      alert('In Safari, tap the Share icon, then "Add to Home Screen".');
    } else {
      alert('Use your browser menu → "Install app" (or "Add to Home screen").');
    }
  };

  if (compact) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="flex min-h-[48px] w-full items-center gap-3 px-4 text-sm font-semibold text-[#111111] transition hover:bg-[#FFF7F8]"
      >
        <Download className="h-4.5 w-4.5 text-[#E5798F]" /> Download app
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      title="Install enotes on this device"
      className="flex h-10 items-center gap-1.5 rounded-xl border border-[#E8E2E4] bg-white px-4 text-sm font-semibold text-[#111111] shadow-sm transition hover:bg-[#FFF7F8]"
    >
      <Download className="h-4 w-4 shrink-0" />
      Download app
    </button>
  );
}
