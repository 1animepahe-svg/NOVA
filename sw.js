/* Hark AI — Service Worker
 * Offline shell caching for fast loads and PWA installability.
 * Uses a cache-first strategy for static assets, network-first for HTML.
 */

const CACHE_NAME = 'hark-v3';
const STATIC_ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './ai.js',
  './tools.js',
  './storage.js',
  './manifest.json',
  './icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Cache what we can; failures on optional assets shouldn't block install
      return Promise.allSettled(
        STATIC_ASSETS.map((url) =>
          cache.add(url).catch((err) => console.warn('SW cache fail:', url, err))
        )
      );
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only handle GET requests
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Don't cache cross-origin API calls (AI requests, etc.) — let them go to the network
  if (url.origin !== self.location.origin) {
    return;
  }

  // HTML: network first, fall back to cache
  if (req.mode === 'navigate' || req.destination === 'document') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match('./index.html')))
    );
    return;
  }

  // Static assets: cache first
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res.ok && (req.destination === 'script' || req.destination === 'style' || req.destination === 'image')) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        }
        return res;
      }).catch(() => {
        // Offline and not cached — return nothing special
      });
    })
  );
});
