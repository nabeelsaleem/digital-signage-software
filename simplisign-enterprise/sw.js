// sw.js - Enterprise Safe Service Worker
const CACHE_NAME = 'simplisign-v3';

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // 1. Cache local player file
      await cache.add('/player.html');
      
      // 2. Cache external CDNs safely (no-cors mode to avoid failures)
      const externalAssets = [
        'https://cdn.tailwindcss.com',
        'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
        'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'
      ];
      
      // Request these with no-cors so they don't break the install
      return Promise.all(externalAssets.map(url => {
        const req = new Request(url, { mode: 'no-cors' });
        return fetch(req).then(res => cache.put(req, res));
      }));
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.map((key) => {
        if (key !== CACHE_NAME && key !== 'media-cache-v1') {
          return caches.delete(key);
        }
      })
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // 1. IGNORE API & Supabase requests (Network Only)
  if (url.pathname.startsWith('/api/') || url.hostname.includes('supabase')) {
    return; 
  }

  // 2. SERVE CACHE FIRST (HTML, JS, CSS)
  event.respondWith(
    caches.match(event.request).then((cached) => {
      // Return cached response immediately if found
      if (cached) return cached;

      // Otherwise fetch from network
      return fetch(event.request).catch(() => {
        // Fallback for HTML if offline
        if (event.request.headers.get('accept').includes('text/html')) {
            return caches.match('/player.html');
        }
      });
    })
  );
});
