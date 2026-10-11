// Lantern's service worker. The build writes the precache list and build id into this template
// (vite.config.ts), from the files the build actually emitted: a path the build does not emit is
// never precached (Boss #3317: that stores the host's fallback page under a URL, a poisoned
// entry no status code shows). The app lives at "/" only (its routes are in the hash), so the
// worker serves the cached shell for "/" and "/index.html" and nothing else: any other path goes
// to the host, which answers 404 for what does not exist.
const BUILD = '__BUILD_ID__';
const PRECACHE = __PRECACHE__;
const CACHE = `lantern-${BUILD}`;
const SHELL = new Set(['/', '/index.html']);

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      for (const path of PRECACHE) {
        const res = await fetch(path, { cache: 'reload' });
        // Never store a redirect or an error under a precache path.
        if (!res.ok || res.redirected) throw new Error(`precache refused ${path}: ${res.status}`);
        await cache.put(path, res);
      }
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith('lantern-') && key !== CACHE) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname === '/version.json' || url.pathname === '/sw.js') return;

  if (req.mode === 'navigate') {
    if (!SHELL.has(url.pathname)) return;
    event.respondWith(
      (async () => {
        const cached = await caches.match('/', { cacheName: CACHE });
        return cached ?? fetch(req);
      })(),
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cached = await caches.match(url.pathname, { cacheName: CACHE });
      return cached ?? fetch(req);
    })(),
  );
});
