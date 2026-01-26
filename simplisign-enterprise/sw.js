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

// 3. FETCH: Serve from Cache first, then Network
self.addEventListener('fetch', (event) => {
    // Only handle http/https requests
    if (!event.request.url.startsWith('http')) return;

    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            // Return cached file if found
            if (cachedResponse) {
                return cachedResponse;
            }
            // Otherwise try to download it
            return fetch(event.request).catch(() => {
                // If offline and request fails, we can't do anything for new media,
                // but the player page itself will already be returned by the cache above.
            });
        })
    );
});
