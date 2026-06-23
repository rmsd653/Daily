const CACHE_NAME = 'offline-task-manager-v1';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon.svg'
];

// On install, pre-cache core assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => self.skipWaiting())
  );
});

// On activate, clear out the old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch interception with a hybrid Network-first fallback to Cache strategy
// for API and modern bundler files, or Cache-first for stable assets
self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url);

  // Focus on local application requests rather than external dev links or extensions
  if (requestUrl.origin === self.location.origin) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) {
          // Fetch updated versions in background (stale-while-revalidate style)
          fetch(event.request)
            .then((networkResponse) => {
              if (networkResponse && networkResponse.status === 200) {
                caches.open(CACHE_NAME).then((cache) => {
                  cache.put(event.request, networkResponse);
                });
              }
            })
            .catch(() => { /* Ignore offline fetch errors */ });
          return cachedResponse;
        }

        return fetch(event.request)
          .then((networkResponse) => {
            if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
              return networkResponse;
            }
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
            return networkResponse;
          })
          .catch(() => {
            // Offline fallbacks - if an HTML request, fallback to root
            if (event.request.headers.get('accept').includes('text/html')) {
              return caches.match('/');
            }
          });
      })
    );
  }
});

// Handle custom message and notifications
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SCHEDULED_NOTIFICATION') {
    const { title, options } = event.data;
    
    // Check if the Notification Triggers API is available or register custom trigger
    // Since experimental triggers require chromium config, we also allow immediate or post-fallback triggers
    if ('showTrigger' in Notification.prototype) {
      // In advanced browsers, schedule notification trigger locally
      self.registration.showNotification(title, {
        ...options,
        vibrate: [100, 50, 100],
        icon: '/icon.svg',
        badge: '/icon.svg'
      });
    } else {
      // Fallback is showing it when triggered from client, or scheduling
      self.registration.showNotification(title, {
        ...options,
        vibrate: [100, 50, 100],
        icon: '/icon.svg',
        badge: '/icon.svg'
      });
    }
  }
});

// Handle notification click event
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      if (clientList.length > 0) {
        return clientList[0].focus();
      }
      return clients.openWindow('/');
    })
  );
});
