/* ============================================================
   Browser Web Push subscription (free, browser-native — no third
   party beyond the browser's own push service).

   How this fits the architecture:
   • In-app realtime: Supabase Realtime postgres_changes (already used
     by AppNav + notifications page). Works while a tab is open.
   • Site closed: this module registers the browser's PushManager
     subscription; a Supabase Edge Function (supabase/functions/
     send-push, see the migration report) sends Web Push via the
     VAPID keys. The service worker (public/sw.js) shows the OS
     notification. No paid provider required.

   Env required:
   NEXT_PUBLIC_VAPID_PUBLIC_KEY — the VAPID *public* key (safe to
   expose; it is public by design). The PRIVATE key lives only in
   the Edge Function's secrets, never in client code.
   ============================================================ */

import { supabase } from '@/lib/supabase/client';

export type PushPermissionState = 'unsupported' | 'denied' | 'default' | 'granted' | 'subscribed';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

async function registerWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!pushSupported()) return null;
  try {
    return await navigator.serviceWorker.register('/sw.js');
  } catch {
    return null;
  }
}

/** Current permission + subscription state, for the settings toggle UI. */
export async function getPushState(): Promise<PushPermissionState> {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.getRegistration();
  const existing = reg ? await reg.pushManager.getSubscription() : null;
  if (existing) return 'subscribed';
  if (Notification.permission === 'granted') return 'granted';
  return 'default';
}

/** Ask permission, subscribe, and persist the subscription. Returns an error message or null. */
export async function enablePush(): Promise<string | null> {
  if (!pushSupported()) return 'This browser does not support push notifications.';
  const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!vapidKey) return 'Push is not configured yet (missing VAPID public key).';

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return 'Notification permission was not granted.';

  const reg = await registerWorker();
  if (!reg) return 'Could not register the notification service worker.';

  try {
    const existing = await reg.pushManager.getSubscription();
    const subscription =
      existing ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey) as BufferSource,
      }));

    const json = subscription.toJSON();
    const endpoint = json.endpoint;
    const keys = (json.keys || {}) as { p256dh?: string; auth?: string };
    if (!endpoint || !keys.p256dh || !keys.auth) return 'The browser returned an invalid push subscription.';

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return 'Sign in to enable push notifications.';

    const { error } = await supabase.from('push_subscriptions').upsert(
      {
        user_id: user.id,
        endpoint,
        p256dh: keys.p256dh,
        auth_key: keys.auth,
        user_agent: navigator.userAgent.slice(0, 300),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'endpoint' }
    );
    if (error) return `Could not save the subscription — ${error.message}`;
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : 'Subscribing to push failed.';
  }
}

/** Remove the subscription locally and from the database. */
export async function disablePush(): Promise<string | null> {
  const reg = await navigator.serviceWorker?.getRegistration?.();
  const subscription = reg ? await reg.pushManager.getSubscription() : null;
  if (!subscription) return null;
  const { error } = await supabase.from('push_subscriptions').delete().eq('endpoint', subscription.endpoint);
  if (error) return `Could not remove the subscription — ${error.message}`;
  const unsubscribed = await subscription.unsubscribe();
  return unsubscribed ? null : 'The browser refused to unsubscribe — reload and try again.';
}

/** iOS Safari ≥16.4 requires the app to be added to the home screen for push — surfaced in the UI. */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}
