// sw.js - Safe Hybrid Service Worker (No CDN caching)

const CACHE_NAME = 'simplisign-player-v3';

// Only cache SAME-ORIGIN assets
const CORE_ASSETS = [
  '/player.html'
];

// INSTALL
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// ACTIVATE
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.map(key => key !== CACHE_NAME && caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// FETCH
self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  // 🚫 Never touch CDN requests
  if (url.origin !== location.origin) {
    return;
  }

  // ✅ Cache-first for player.html
  if (url.pathname === '/player.html') {
    event.respondWith(
      caches.match(req).then(res => res || fetch(req))
    );
    return;
  }

  // ✅ Network-first for everything else (API, images, videos)
  event.respondWith(
    fetch(req).catch(() => caches.match(req))
  );
});
