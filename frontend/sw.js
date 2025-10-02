// Service Worker version
const CACHE_NAME = 'chat-app-cache-v1';

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
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[SW] Caching static assets...');
        // Only add assets that exist
        return Promise.all(
          STATIC_ASSETS.map(asset => 
            fetch(asset).then(resp => {
              if (!resp.ok) throw new Error(`Failed to fetch ${asset}`);
              return cache.put(asset, resp);
            })
          )
        );
      })
  );
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

const FALLBACK_ICON = '/icon.png'; // cached version in SW

// Fetch event - respond with cache first, then network
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => response || fetch(event.request).catch(() => {
        // fallback for icon.png if offline
        if (event.request.url.endsWith('icon.png')) {
          return caches.match(FALLBACK_ICON);
        }
      }))
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
