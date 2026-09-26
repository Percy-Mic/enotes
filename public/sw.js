/* enotes Service Worker */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

const QUIET_DB_NAME = 'enotes-notifications';
const QUIET_STORE_NAME = 'settings';
const QUIET_KEY = 'quiet-mode';

function toUrl(path) {
  try { return new URL(path, self.location.origin).toString(); }
  catch { return self.location.origin + '/'; }
}

function cleanBody(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, 240);
}

function getQuietState() {
  return new Promise((resolve) => {
    if (!self.indexedDB) { resolve(null); return; }
    let request;
    try { request = self.indexedDB.open(QUIET_DB_NAME, 1); } catch { resolve(null); return; }
    request.onupgradeneeded = () => {
      try {
        if (!request.result.objectStoreNames.contains(QUIET_STORE_NAME)) request.result.createObjectStore(QUIET_STORE_NAME);
      } catch {}
    };
    request.onsuccess = () => {
      const db = request.result;
      try {
        const get = db.transaction(QUIET_STORE_NAME, 'readonly').objectStore(QUIET_STORE_NAME).get(QUIET_KEY);
        get.onsuccess = () => { const value = get.result || null; db.close(); resolve(value); };
        get.onerror = () => { db.close(); resolve(null); };
      } catch { db.close(); resolve(null); }
    };
    request.onerror = () => resolve(null);
  });
}

async function isQuietForRecipient(userId) {
  if (!userId) return false;
  const state = await getQuietState();
  if (!state || state.userId !== userId) return false;
  // null means "Until I turn it off".
  if (state.until === null) return true;
  return state.until > Date.now();
}

async function forwardToVisibleApp(data) {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  let forwarded = false;
  for (const client of clients) {
    if (client.visibilityState === 'visible' && new URL(client.url).origin === self.location.origin) {
      client.postMessage({ type: 'ENOTES_PUSH_NOTIFICATION', payload: data });
      forwarded = true;
    }
  }
  return forwarded;
}

self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    let data = {};
    try { data = event.data ? event.data.json() : {}; }
    catch { data = { title: 'enotes', body: event.data ? event.data.text() : '', url: '/notifications', type: 'default' }; }

    if (await isQuietForRecipient(data.userId)) return;
    if (await forwardToVisibleApp(data)) return;

    const type = data.type || 'default';
    const isCall = type === 'call';
    const isMessage = type === 'message';
    const title = data.title || (isMessage ? 'New message' : 'enotes');
    const body = cleanBody(data.body || '');

    if (isMessage) {
      const conversationId = data.conversationId || null;
      const targetUrl = data.url || (conversationId ? '/messages/' + conversationId : '/messages');
      const tag = data.tag || (conversationId ? 'message:conversation:' + conversationId : 'message:' + Date.now());
      await self.registration.showNotification(title, {
        body: body || 'You have a new message',
        icon: data.icon || '/icon.svg',
        badge: data.badge || '/icon.svg',
        tag, renotify: true, requireInteraction: false,
        actions: [{ action: 'open', title: 'Open chat' }],
        data: { url: targetUrl, type: 'message', conversationId, notificationId: data.notificationId || null, senderId: data.senderId || null, senderName: data.senderName || title },
      });
      return;
    }

    if (isCall) {
      await self.registration.showNotification(title, {
        body: body || 'Incoming call',
        icon: data.icon || '/icon.svg',
        badge: data.badge || '/icon.svg',
        tag: data.tag || (data.callId ? 'call:' + data.callId : undefined),
        requireInteraction: true, vibrate: [300, 100, 300, 100, 600],
        actions: [{ action: 'answer', title: 'Open call' }, { action: 'dismiss', title: 'Dismiss' }],
        data: { url: data.url || '/notifications', type: 'call', callId: data.callId || null, conversationId: data.conversationId || null, senderId: data.senderId || null, senderName: data.senderName || title },
        renotify: true,
      });
      return;
    }

    await self.registration.showNotification(title, {
      body, icon: data.icon || '/icon.svg', badge: data.badge || '/icon.svg',
      tag: data.tag || undefined, requireInteraction: false,
      data: { url: data.url || '/notifications', type, notificationId: data.notificationId || null },
      renotify: Boolean(data.tag),
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action === 'dismiss') return;
  const target = toUrl((event.notification.data && event.notification.data.url) || '/notifications');
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clients) {
      if ('focus' in client) {
        try { await client.focus(); } catch {}
        if ('navigate' in client && client.url !== target) { try { await client.navigate(target); } catch {} }
        return;
      }
    }
    await self.clients.openWindow(target);
  })());
});

self.addEventListener('pushsubscriptionchange', (event) => event.waitUntil(Promise.resolve()));
