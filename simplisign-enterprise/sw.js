// sw.js - Production Safe Service Worker
const SHELL_CACHE = 'shell-v1';

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache => cache.addAll(['/player.html']))
      .then(() => self.skipWaiting())
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
    // ✅ REMOVED self.clients.claim() - Let browser control when to activate
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  
  // Only cache same-origin requests
  if (url.origin === location.origin) {
    e.respondWith(
      caches.match(e.request)
        .then(response => response || fetch(e.request))
    );
  }
  // Let network handle everything else (API, CDNs, Supabase)
});
