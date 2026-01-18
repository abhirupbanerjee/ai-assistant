const CACHE_VERSION = 'v2';
const STATIC_CACHE = `static-${CACHE_VERSION}`;

// Force immediate activation - critical for fixing broken SWs
self.addEventListener('install', (event) => {
  console.log('[SW] Installing v2 - bypasses navigation');
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys
        .filter(k => !k.endsWith(CACHE_VERSION))
        .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // BYPASS ALL API ROUTES - zero risk to existing functionality
  if (url.pathname.startsWith('/api/')) return;
  if (url.pathname.startsWith('/_next/data/')) return;

  // Cache static assets (/_next/static/*)
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.match(event.request).then(cached =>
        cached || fetch(event.request).then(response => {
          caches.open(STATIC_CACHE).then(cache =>
            cache.put(event.request, response.clone())
          );
          return response;
        })
      )
    );
    return;
  }

  // Cache icons
  if (url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.match(event.request).then(cached =>
        cached || fetch(event.request).then(response => {
          caches.open(STATIC_CACHE).then(cache =>
            cache.put(event.request, response.clone())
          );
          return response;
        })
      )
    );
    return;
  }

  // All other requests (including navigation) pass through without SW intervention
  // This ensures OAuth redirects and auth flows work correctly
});
