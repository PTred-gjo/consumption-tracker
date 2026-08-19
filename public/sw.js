/* eslint-env serviceworker */
/**
 * FuelPilot service worker.
 *
 * The app is offline-first by nature — all data lives on the device and nothing
 * is fetched from a server — so the only job here is making the shell itself
 * available without a network.
 *
 * Bump CACHE_VERSION whenever the cached shell needs to be replaced.
 */

const CACHE_VERSION = 'v1';
const CACHE_NAME = `fuelpilot-${CACHE_VERSION}`;

/**
 * Base path the app is served from — "/" under Capacitor, "/<repo>/" on GitHub
 * Pages. Derived from the registration scope so one worker covers both without
 * a build step rewriting it.
 */
const BASE = new URL(self.registration.scope).pathname;
const url = (path) => BASE + path;

/** Only files guaranteed to exist; hashed bundles are cached on first request. */
const PRECACHE_URLS = [
  url(''), url('index.html'), url('manifest.json'),
  url('icon-192.png'), url('icon-512.png'),
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      // addAll rejects the whole install if any single URL 404s, so failures are
      // tolerated per-file and the entry is simply fetched later.
      .then((cache) => Promise.allSettled(PRECACHE_URLS.map((entry) => cache.add(entry))))
  );
  // Deliberately no skipWaiting() here: taking over immediately would swap the
  // assets under a page that may have a half-filled refuel form open. The page
  // asks for the handover itself, once the user accepts the update prompt.
});

self.addEventListener('message', (event) => {
  if (event.data === 'fp:skip-waiting') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Navigations: network first so a deployed update is picked up, falling back
  // to the cached shell when offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(url('index.html'), copy));
          return response;
        })
        .catch(() => caches.match(url('index.html')).then((cached) => cached || caches.match(url(''))))
    );
    return;
  }

  // Static assets: cache first. Vite fingerprints filenames, so a cached hit is
  // always the correct content for that URL.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    })
  );
});
