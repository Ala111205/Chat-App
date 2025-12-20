// Service Worker version
const CACHE_NAME = 'chat-app-cache-v2';

// Files to cache for offline usage
const STATIC_ASSETS = [
  '/index.html',
  '/chat.html',
  '/client.js',
  '/styles/style.css',
  '/icon.png'          
];

self.addEventListener('install', event => {
  console.log('[SW] Installing...');

  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(CACHE_NAME);
        console.log('[SW] Caching static assets...');

        // Cache all static assets that exist
        await Promise.all(
          STATIC_ASSETS.map(async asset => {
            try {
              const response = await fetch(asset);
              if (!response.ok) throw new Error(`Failed to fetch ${asset}`);
              await cache.put(asset, response.clone());
            } catch (err) {
              console.warn(`[SW] Skipping ${asset}:`, err.message);
            }
          })
        );

      } catch (err) {
        console.error('[SW] Cache installation failed:', err);
      }
    })()
  );

  // Take control of the page immediately after installation
  self.skipWaiting();
});


// Activate event - cleanup old caches
self.addEventListener('activate', event => {
  console.log('[Service Worker] Activating...');
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME)
            .map(key => caches.delete(key))
      );
    })
  );
  self.clients.claim(); // Take control of all clients
});

// Fetch event - respond with cache first, then network
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(response => {
      // If found in cache, return it
      if (response) return response;

      // Otherwise try network
      return fetch(event.request).catch(() => {
        // If it's the icon, return cached fallback
        if (event.request.url.endsWith('icon.png')) {
          return caches.match('/icon.png');
        }

        // Otherwise, return a fallback Response instead of undefined
        return new Response('Offline', {
          status: 503,
          statusText: 'Service Unavailable',
          headers: { 'Content-Type': 'text/plain' }
        });
      });
    })
  );
});


// Push event - show notifications
self.addEventListener('push', event => {
  let data = { title: 'New Message', body: 'You have a new chat message.', icon: '/icon.png' };
  
  if (event.data) {
    data = event.data.json(); // Use payload sent from backend
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: data.icon || '/icon.png'
    })
  );
});

// Notification click event
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then(windowClients => {
      // Focus an existing tab if possible
      if (windowClients.length > 0) {
        windowClients[0].focus();
      } else {
        clients.openWindow('/'); // open homepage if no window is open
      }
    })
  );
});