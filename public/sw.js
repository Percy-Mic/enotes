/* ============================================================
   enotes Service Worker

   Web Push is browser/device based, not page-login based.

   If a visible enotes window exists, push is handed to the app's
   custom notification UI. If no visible window exists, the worker
   shows the native browser/OS notification so closed/background
   delivery continues to work.
   ============================================================ */

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

function cleanBody(value) {
  if (typeof value !== 'string') return '';

  return value
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}

async function hasVisibleEnotesWindow() {
  const clients = await self.clients.matchAll({
    type: 'window',
    includeUncontrolled: true,
  });

  return clients.some(
    (client) =>
      client.visibilityState === 'visible' &&
      new URL(client.url).origin === self.location.origin
  );
}

async function forwardToVisibleApp(data) {
  const clients = await self.clients.matchAll({
    type: 'window',
    includeUncontrolled: true,
  });

  let forwarded = false;

  for (const client of clients) {
    if (
      client.visibilityState === 'visible' &&
      new URL(client.url).origin === self.location.origin
    ) {
      client.postMessage({
        type: 'ENOTES_PUSH_NOTIFICATION',
        payload: data,
      });
      forwarded = true;
    }
  }

  return forwarded;
}

self.addEventListener('push', (event) => {
  event.waitUntil(
    (async () => {
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

      /*
       * Never show two notifications for an active user:
       * visible enotes window -> custom in-app notification.
       * no visible enotes window -> native Web Push notification.
       */
      if (await forwardToVisibleApp(data)) {
        return;
      }

      const type = data.type || 'default';
      const isCall = type === 'call';
      const isMessage = type === 'message';

      const title =
        data.title ||
        (isMessage ? 'New message' : 'enotes');

      const body = cleanBody(data.body || '');

      if (isMessage) {
        const conversationId =
          data.conversationId || null;

        const targetUrl =
          data.url ||
          (
            conversationId
              ? '/messages/' + conversationId
              : '/messages'
          );

        const tag =
          data.tag ||
          (
            conversationId
              ? 'message:conversation:' + conversationId
              : 'message:' + Date.now()
          );

        await self.registration.showNotification(
          title,
          {
            body:
              body ||
              'You have a new message',

            icon:
              data.icon ||
              '/icon.svg',

            badge:
              data.badge ||
              '/icon.svg',

            tag,

            renotify: true,

            requireInteraction: false,

            actions: [
              {
                action: 'open',
                title: 'Open chat',
              },
            ],

            data: {
              url: targetUrl,
              type: 'message',
              conversationId,
              notificationId:
                data.notificationId || null,
              senderId:
                data.senderId || null,
              senderName:
                data.senderName || title,
            },
          }
        );

        return;
      }

      if (isCall) {
        await self.registration.showNotification(
          title,
          {
            body:
              body ||
              'Incoming call',

            icon:
              data.icon ||
              '/icon.svg',

            badge:
              data.badge ||
              '/icon.svg',

            tag:
              data.tag ||
              (
                data.callId
                  ? 'call:' + data.callId
                  : undefined
              ),

            requireInteraction: true,

            vibrate: [
              300,
              100,
              300,
              100,
              600,
            ],

            actions: [
              {
                action: 'answer',
                title: 'Open call',
              },
              {
                action: 'dismiss',
                title: 'Dismiss',
              },
            ],

            data: {
              url:
                data.url ||
                '/notifications',

              type: 'call',

              callId:
                data.callId ||
                null,
            },

            renotify: true,
          }
        );

        return;
      }

      await self.registration.showNotification(
        title,
        {
          body,

          icon:
            data.icon ||
            '/icon.svg',

          badge:
            data.badge ||
            '/icon.svg',

          tag:
            data.tag ||
            undefined,

          requireInteraction: false,

          data: {
            url:
              data.url ||
              '/notifications',

            type,

            notificationId:
              data.notificationId ||
              null,
          },

          renotify:
            Boolean(data.tag),
        }
      );
    })()
  );
});

self.addEventListener(
  'notificationclick',
  (event) => {
    event.notification.close();

    if (event.action === 'dismiss') {
      return;
    }

    const target =
      toUrl(
        (
          event.notification.data &&
          event.notification.data.url
        ) ||
        '/notifications'
      );

    event.waitUntil(
      (async () => {
        const clients =
          await self.clients.matchAll({
            type: 'window',
            includeUncontrolled: true,
          });

        for (const client of clients) {
          if ('focus' in client) {
            try {
              await client.focus();
            } catch {
              /* Best effort. */
            }

            if (
              'navigate' in client &&
              client.url !== target
            ) {
              try {
                await client.navigate(target);
              } catch {
                /* Browser may block navigation. */
              }
            }

            return;
          }
        }

        await self.clients.openWindow(target);
      })()
    );
  }
);

self.addEventListener(
  'pushsubscriptionchange',
  (event) => {
    /*
     * Do not unsubscribe or delete anything here.
     * The browser subscription is intentionally allowed to remain
     * active when the user logs out.
     */
    event.waitUntil(Promise.resolve());
  }
);
