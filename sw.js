// Service worker: keeps the app working offline and lets installed phones
// know when a new version has been published. Run tools/bump.py to release.

const VERSION = '2026.11.05-7';
const SHELL = `shell-${VERSION}`;
const TILES = 'tiles-v1';

const ASSETS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'fonts/CormorantGaramond-400-latin-ext.woff2',
  'fonts/CormorantGaramond-400-latin.woff2',
  'fonts/CormorantGaramond-400i-latin-ext.woff2',
  'fonts/CormorantGaramond-400i-latin.woff2',
  'fonts/Inter-400-latin-ext.woff2',
  'fonts/Inter-400-latin.woff2',
  'fonts/fonts.css',
  'icons/apple-touch-icon.png',
  'icons/favicon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'js/app.js',
  'js/claude.js',
  'js/config.js',
  'js/db.js',
  'js/github.js',
  'js/photos.js',
  'js/places.js',
  'js/store.js',
  'js/tidy.js',
  'js/ui.js',
  'js/updates.js',
  'js/wiki.js',
  'js/views/edit.js',
  'js/views/home.js',
  'js/views/lane.js',
  'js/views/map.js',
  'js/views/onboarding.js',
  'js/views/profiles.js',
  'js/views/settings.js',
  'js/views/visit.js',
  'js/views/wishes.js',
  'vendor/exifr.umd.js',
  'vendor/leaflet.css',
  'vendor/leaflet.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL).then((cache) =>
      cache.addAll(ASSETS.map((url) => new Request(url, { cache: 'reload' })))),
  );
  // No skipWaiting here: the page shows "Update" and the user decides.
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('shell-') && key !== SHELL) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Map tiles: cache as we go so places we've looked at work offline.
  if (url.hostname === 'tile.openstreetmap.org') {
    event.respondWith(caches.open(TILES).then(async (cache) => {
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    }));
    return;
  }

  if (url.origin !== self.location.origin) return; // GitHub API etc. go straight to network

  event.respondWith((async () => {
    const cache = await caches.open(SHELL);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    if (req.mode === 'navigate') {
      const shell = await cache.match('./');
      if (shell) return shell;
    }
    return fetch(req);
  })());
});
