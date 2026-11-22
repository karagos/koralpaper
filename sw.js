/* KoralPaper service worker — makes the app installable and fully
   offline-capable when served over the web (GitHub Pages etc).
   Strategy: network-first with cache fallback, so updates arrive the
   moment they are online and the app still opens with no connection.
   The cache name carries the app version; bump it with APP_VERSION. */
const CACHE = 'koralpaper-v3.85.2';
const SHELL = [
  './',
  './index.html',
  './css/style.css',
  './js/core.js',
  './js/bridge.js',
  './js/app.js',
  './js/material-icons.js',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
  // bundled fonts: Inter Tight, JetBrains Mono, Gelasio
  './fonts/gelasio-latin-ext-italic.woff2',
  './fonts/gelasio-latin-ext-normal.woff2',
  './fonts/gelasio-latin-italic.woff2',
  './fonts/gelasio-latin-normal.woff2',
  './fonts/inter-tight-greek-ext-italic.woff2',
  './fonts/inter-tight-greek-ext-normal.woff2',
  './fonts/inter-tight-greek-italic.woff2',
  './fonts/inter-tight-greek-normal.woff2',
  './fonts/inter-tight-latin-ext-italic.woff2',
  './fonts/inter-tight-latin-ext-normal.woff2',
  './fonts/inter-tight-latin-italic.woff2',
  './fonts/inter-tight-latin-normal.woff2',
  './fonts/jetbrains-mono-greek-italic.woff2',
  './fonts/jetbrains-mono-greek-normal.woff2',
  './fonts/jetbrains-mono-latin-ext-italic.woff2',
  './fonts/jetbrains-mono-latin-ext-normal.woff2',
  './fonts/jetbrains-mono-latin-italic.woff2',
  './fonts/jetbrains-mono-latin-normal.woff2',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // only handle same-origin GETs — Google fonts/icons and the local
  // Claude bridge must go straight to the network untouched
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then(res => {
      if (res.ok){
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
      }
      return res;
    }).catch(() =>
      caches.match(e.request).then(hit => hit ||
        (e.request.mode === 'navigate' ? caches.match('./index.html') : Response.error()))
    )
  );
});
