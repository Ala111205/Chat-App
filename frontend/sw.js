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

// Push event - show notification
self.addEventListener('push', event => {
  let data = { title: 'New Message', body: 'You have a new chat message.', icon: new URL('/icon.png', self.location.origin).href };
  if (event.data) data = event.data.json();

  event.waitUntil(
    self.registration.showNotification(data.title, { body: data.body, icon: data.icon })
  );
});

// Notification click - focus or open
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then(windows => {
      if (windows.length) return windows[0].focus();
      return clients.openWindow('/');
    })
  );
});

// Listen for skip waiting messages
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
