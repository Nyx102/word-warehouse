// Word Warehouse service worker — app-shell caching for installable PWA use.
// Deliberately conservative: the API is never cached, navigations are
// network-first (so a rebuilt bundle is never masked by a stale shell), and
// only content-hashed /assets/ (immutable) are cached-first.
const CACHE = 'ww-shell-v2';
const SHELL = ['/', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // live data only

  if (url.pathname.startsWith('/assets/')) {
    // immutable, content-hashed build output -> cache-first
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      })),
    );
    return;
  }

  if (req.mode === 'navigate') {
    // network-first so new deploys win; cached shell only when offline
    e.respondWith(fetch(req).catch(() => caches.match('/')));
  }
});
