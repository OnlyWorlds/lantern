// Lantern's service worker. The build writes the precache list and build id into this template
// (vite.config.ts), from the files the build actually emitted: a path the build does not emit is
// never precached (Boss, 2026-10-11: that stores the host's fallback page under a URL, a poisoned
// entry no status code shows). The app lives at "/" only (its routes are in the hash), so the
// worker serves the cached shell for "/" and "/index.html" and nothing else: any other path goes
// to the host, which answers 404 for what does not exist.
const BUILD = '__BUILD_ID__';
const PRECACHE = __PRECACHE__;
const SHELL_SCRIPTS = __SHELL_SCRIPTS__;
const DIGESTS = __DIGESTS__;

async function sha256(res) {
  const bytes = await crypto.subtle.digest('SHA-256', await res.clone().arrayBuffer());
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
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
        // Nor another build's shell: during a deploy's cutover "/" can still be the previous one
        // (Boss, 2026-10-12), and stored under this build it would load scripts this cache lacks.
        if (SHELL.has(path)) {
          const html = await res.clone().text();
          if (!SHELL_SCRIPTS.every((src) => html.includes(src))) throw new Error(`precache refused ${path}: another build's shell`);
        }
        // An unhashed file this build names by its digest (the manifest): the same cutover check.
        if (DIGESTS[path] && (await sha256(res)) !== DIGESTS[path]) throw new Error(`precache refused ${path}: another build's copy`);
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
    // Sign in with OnlyWorlds comes back to /signin/callback: the phone's own build
    // answers it from this cache, as it answers "/", so the sign-in finishes under the build the
    // phone runs and never the host's newer one (the sign-in gate's G2). The address and its code stay
    // as they came; nothing is stored under that path.
    if (!SHELL.has(url.pathname) && url.pathname.replace(/\/$/, '') !== '/signin/callback') return;
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
