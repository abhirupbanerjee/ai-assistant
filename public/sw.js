const CACHE_VERSION = 'v7';
const STATIC_CACHE = `static-${CACHE_VERSION}`;
const APP_SHELL_CACHE = `app-shell-${CACHE_VERSION}`;

// Force immediate activation - critical for fixing broken SWs
self.addEventListener('install', (event) => {
  console.log('[SW] Installing ' + CACHE_VERSION);
  // Pre-cache the app shell (the chat entry page) so offline navigation
  // has something to serve immediately. We cache /chat and the offline
  // fallback page. Both are best-effort: if the network is down at install
  // time, these will simply be fetched on the first successful navigation.
  event.waitUntil(
    (async () => {
      const shell = await caches.open(APP_SHELL_CACHE);
      try {
        await Promise.all([
          shell.add(new Request('/chat', { cache: 'reload' })).catch(() => {}),
          shell.add(new Request('/offline', { cache: 'reload' })).catch(() => {}),
        ]);
      } catch (e) {
        // Non-fatal: navigation handler will populate on first hit.
      }
      self.skipWaiting();
    })()
  );
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

// Phase 2.4 — App-shell navigation fallback.
//
// For navigation requests (request.mode === 'navigate'):
//   1. Try the app-shell cache first (instant for repeat offline visits).
//   2. On miss, fetch from network; if successful, cache a clone in the
//      app-shell cache and return it.
//   3. If the network fetch fails (offline), fall back to a cached app
//      shell entry; if none exists, serve /offline from cache or a tiny
//      generated offline stub.
//
// API and /_next/data/ routes are still bypassed entirely (see below).
async function handleNavigation(request) {
  const cache = await caches.open(APP_SHELL_CACHE);
  const cached = await cache.match(request, { ignoreSearch: true });
  if (cached) {
    // Revalidate in the background so the shell stays fresh.
    fetch(request).then((res) => {
      if (res && res.status === 200 && res.type === 'basic') {
        cache.put(request, res.clone()).catch(() => {});
      }
    }).catch(() => {});
    return cached;
  }

  try {
    const networkResponse = await fetch(request);
    if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
      cache.put(request, networkResponse.clone()).catch(() => {});
    }
    return networkResponse;
  } catch (err) {
    // Offline and no cached shell for this URL — try /chat, then /offline,
    // then a generated fallback so the user never sees a raw browser error.
    const fallback =
      (await cache.match('/chat', { ignoreSearch: true })) ||
      (await cache.match('/offline', { ignoreSearch: true }));
    if (fallback) return fallback;
    return new Response(
      '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Offline</title><style>html,body{margin:0;height:100dvh;display:flex;align-items:center;justify-content:center;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#1c1c1c;color:#e5e7eb;text-align:center;padding:1rem}h1{font-size:1.25rem;font-weight:600;margin:0 0 .5rem}p{margin:0;opacity:.8;font-size:.95rem}</style></head><body><div><h1>You\u2019re offline</h1><p>Reconnect to load the assistant.</p></div></body></html>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // BYPASS ALL API ROUTES - zero risk to existing functionality.
  // (share_target POSTs to /api/share-target and must NOT be intercepted.)
  if (url.pathname.startsWith('/api/')) return;
  if (url.pathname.startsWith('/_next/data/')) return;

  // Phase 2.4: navigation requests → app-shell fallback.
  if (event.request.mode === 'navigate') {
    event.respondWith(handleNavigation(event.request));
    return;
  }

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
