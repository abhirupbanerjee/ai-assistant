const CACHE_VERSION = 'v6';
const STATIC_CACHE = `static-${CACHE_VERSION}`;

// Force immediate activation - critical for fixing broken SWs
self.addEventListener('install', (event) => {
  console.log('[SW] Installing v6');
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

// Helper: safely cache a response (only cache valid responses)
function cacheResponse(request, response) {
  // Only cache successful, same-origin responses
  if (!response || response.status !== 200 || response.type !== 'basic') {
    return response;
  }
  // Clone before any async operation
  const responseToCache = response.clone();
  caches.open(STATIC_CACHE).then(cache => {
    cache.put(request, responseToCache);
  });
  return response;
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // BYPASS ALL API ROUTES - zero risk to existing functionality
  if (url.pathname.startsWith('/api/')) return;
  if (url.pathname.startsWith('/_next/data/')) return;

  // Cache static assets (/_next/static/*)
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.match(event.request).then(cached =>
        cached || fetch(event.request).then(res => cacheResponse(event.request, res))
      )
    );
    return;
  }

  // Cache icons
  if (url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.match(event.request).then(cached =>
        cached || fetch(event.request).then(res => cacheResponse(event.request, res))
      )
    );
    return;
  }

  // All other requests pass through without SW intervention
});
