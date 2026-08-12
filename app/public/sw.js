// Offline service worker — NETWORK-FIRST so it never serves stale code (important in dev, where Vite
// modules change constantly). Fetches from the network and updates the cache; falls back to the cache
// only when offline. Cross-origin (the ElevenLabs API) is passthrough.
const CACHE = 'musicstudio-v2';

self.addEventListener('install', (e) => { self.skipWaiting(); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // don't touch API/CDN calls
  e.respondWith(
    fetch(request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
      return res;
      // Offline navigation falls back to the app shell at the SW's own scope (works under /MusicStudio/ too).
    }).catch(() => caches.match(request).then((hit) => hit || (request.mode === 'navigate' ? caches.match(new URL('./', self.location.href).href) : undefined))),
  );
});
