// Service Worker version
const CACHE_NAME = 'chat-app-cache-v1';

// Files to cache for offline usage
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/chat.html',
  '/client.js',
  '/styles/styles.css', // path to your CSS
  '/icon.png'           // path to your icon
];

// Install event - caching static assets
self.addEventListener('install', event => {
  console.log('[Service Worker] Installing...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[Service Worker] Caching app shell');
        return cache.addAll(STATIC_ASSETS);
      })
  );
  self.skipWaiting(); // Activate worker immediately
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
    caches.match(event.request)
      .then(response => response || fetch(event.request))
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
