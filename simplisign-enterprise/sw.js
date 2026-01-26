// sw.js - Version 3 (Forces update)
const SHELL_CACHE = 'shell-v3';

self.addEventListener('install', (e) => {
  self.skipWaiting(); // Force activate immediately
  e.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache => cache.addAll(['/player.html']))
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => 
      Promise.all(
        keys.map(key => {
          if (key !== SHELL_CACHE && key !== 'media-cache-v1') {
            return caches.delete(key);
          }
        })
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Cache First strategy for player.html
  if (url.origin === location.origin && url.pathname.includes('player.html')) {
    e.respondWith(
      caches.match(e.request).then(r => r || fetch(e.request))
    );
  }
});
