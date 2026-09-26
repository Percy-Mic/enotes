/* enotes service worker.
   Responsibilities:
   1. Web Push delivery when enotes is closed/backgrounded.
   2. Notification click focus/open behavior.
   3. Keep stale subscriptions harmless; the server removes dead endpoints.
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
    data = {
      title: 'enotes',
      body: event.data ? event.data.text() : '',
      url: '/notifications',
      type: 'default',
    };
  }

  const title = data.title || 'enotes';
  const isCall = data.type === 'call';

  const options = {
    body: data.body || '',
    icon: data.icon || '/icon.svg',
    badge: data.badge || '/icon.svg',
    tag: data.tag || undefined,
    requireInteraction: isCall,
    vibrate: isCall ? [300, 100, 300, 100, 600] : undefined,
    actions: isCall
      ? [
          { action: 'answer', title: 'Open call' },
          { action: 'dismiss', title: 'Dismiss' },
        ]
      : undefined,
    data: {
      url: data.url || '/notifications',
      type: data.type || 'default',
      callId: data.callId || null,
    },
    renotify: Boolean(data.tag),
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'dismiss') return;

  const target = toUrl(
    (event.notification.data && event.notification.data.url) || '/notifications'
  );

  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });

      for (const client of clientList) {
        if ('focus' in client) {
          await client.focus();
          if ('navigate' in client && client.url !== target) {
            try {
              await client.navigate(target);
            } catch {
              /* The app can still be opened/focused if navigation is blocked. */
            }
          }
          return;
        }
      }

      await self.clients.openWindow(target);
    })()
  );
});

self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(Promise.resolve());
});
