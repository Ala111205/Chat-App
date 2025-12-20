// Versioned cache
const CACHE_NAME = 'chat-app-cache-v2';
const STATIC_ASSETS = [
  '/index.html',
  '/chat.html',
  '/client.js',
  '/styles/style.css',
  '/icon.png'
];

// Install event
self.addEventListener('install', event => {
  console.log('[SW] Installing...');
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await Promise.all(
        STATIC_ASSETS.map(async asset => {
          try {
            const res = await fetch(asset);
            if (!res.ok) throw new Error(`Failed to fetch ${asset}`);
            await cache.put(asset, res.clone());
          } catch (err) {
            console.warn(`[SW] Skipping ${asset}: ${err.message}`);
          }
        })
      );
    })()
  );
  self.skipWaiting(); // Activate immediately
});

// Activate event - cleanup old caches
self.addEventListener('activate', event => {
  console.log('[SW] Activating...');
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))
    )
  );
  self.clients.claim();
});

// Fetch event - cache-first
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(resp => resp || fetch(event.request).catch(() => {
      if (event.request.url.endsWith('/icon.png')) return caches.match('/icon.png');
      return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
    }))
  );
});

// =========================
// Push event - show notification
// =========================
self.addEventListener('push', event => {
  let payload = {
    title: 'New Message',
    body: 'You have a new chat message.',
    icon: '/icon.png',
    badge: '/icon.png',
    url: '/'
  };

  try {
    if (event.data) {
      const data = event.data.json();
      payload = {
        title: data.title || payload.title,
        body: data.body || payload.body,
        icon: data.icon || payload.icon,
        badge: data.badge || payload.badge,
        url: data.url || payload.url
      };
    }
  } catch (e) {
    console.warn('⚠️ Malformed push payload', e);
    // fallback safely to defaults
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: payload.icon,
      badge: payload.badge,
      data: { url: payload.url },
      tag: 'chat-message', // optional: prevents duplicates
      renotify: true // optional: show new notification even if tag matches
    })
  );
});

// =========================
// Notification click - open app
// =========================
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      // Focus already open window if exists
      for (const client of clientList) {
        if (client.url === url && 'focus' in client) {
          return client.focus();
        }
      }
      // Otherwise, open new window/tab
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});

// Listen for skip waiting messages
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
