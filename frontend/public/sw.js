self.addEventListener('push', e => {
  const data = e.data.json(); // Get the payload sent from backend
  self.registration.showNotification(data.title, {
    body: data.body,
    icon: data.icon || '/icon.png', // optional icon
  });
});

// Optional: handle notification click
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window' }).then(windowClients => {
      if (windowClients.length > 0) {
        windowClients[0].focus();
      } else {
        clients.openWindow('/'); // open homepage if no window is open
      }
    })
  );
});
