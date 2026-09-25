/* enotes service worker.
   Responsibilities:
   1. Web Push delivery — shows OS notifications when the site is CLOSED.
      (Supabase Realtime only works in open tabs; push is the closed-app path.)
   2. Notification click focus/open behavior.
   3. Stale-subscription cleanup via pushsubscriptionchange.

   Web Push payloads carry the notification text; nothing user-private is
   stored by the worker itself.
   */

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

function toUrl(path) {
  try {
    return new URL(path, self.location.origin).toString();
  } catch {
    return self.location.origin + '/';
  }
}

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'enotes', body: event.data ? event.data.text() : '' };
  }

  const title = data.title || 'enotes';
  const isCall = data.type === 'call';
  const options = {
    body: data.body || '',
    icon: data.icon || '/icon.svg',
    badge: '/icon.svg',
    tag: data.tag || undefined, // replaces instead of stacking duplicates
    requireInteraction: isCall,
    vibrate: isCall ? [300, 100, 300, 100, 600] : undefined,
    actions: isCall
      ? [
          { action: 'answer', title: 'Open call' },
          { action: 'dismiss', title: 'Dismiss' },
        ]
      : undefined,
    data: { url: data.url || '/notifications', type: data.type || 'default' },
    data: { url: data.url || '/notifications' },
    renotify: Boolean(data.tag),
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action === 'dismiss') return;
  const target = toUrl((event.notification.data && event.notification.data.url) || '/notifications');

  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of clientList) {
        /* same origin already open → focus it and navigate */
        if ('focus' in client) {
          await client.focus();
          if ('navigate' in client && client.url !== target) {
            try { await client.navigate(target); } catch { /* cross-window navigation may fail; the app shows /notifications by default */ }
          }
          return;
        }
      }
      await self.clients.openWindow(target);
    })()
  );
});

/* Browser rotated the push keys (or subscription expired) — the page can't
   always react while closed, so re-derive what we can: dropping dead
   subscriptions happens server-side via Web Push 404/410 responses. */
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      /* without an old subscription payload we cannot silently re-subscribe
         (permission + applicationServerKey are required); the app
         re-subscribes on next visit. Nothing to do here but stay quiet. */
      return;
    })()
  );
});
