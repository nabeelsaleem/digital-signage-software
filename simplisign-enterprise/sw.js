// sw.js - Service Worker to enable Offline Boot
const CACHE_NAME = 'simplisign-player-v1';

// List of files to cache immediately
const ASSETS = [
    '/player.html',
    // We add these because your code might rely on them
    // If you use other local CSS/JS files, add them here
];

// 1. INSTALL: Cache the player page
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS);
        })
    );
    self.skipWaiting();
});

// 2. ACTIVATE: Clean up old caches
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.map((key) => {
                    if (key !== CACHE_NAME) return caches.delete(key);
                })
            );
        })
    );
    self.clients.claim();
});

// 3. FETCH: Network First, Fallback to Cache
self.addEventListener('fetch', (event) => {
    if (!event.request.url.startsWith('http')) return;

    event.respondWith(
        fetch(event.request).then((networkResponse) => {
            // If online, grab the freshest file from Vercel and update the cache quietly
            return caches.open(CACHE_NAME).then((cache) => {
                cache.put(event.request, networkResponse.clone());
                return networkResponse;
            });
        }).catch(() => {
            // If offline, serve the last known good version from the cache
            return caches.match(event.request, { ignoreSearch: true });
        })
    );
});
