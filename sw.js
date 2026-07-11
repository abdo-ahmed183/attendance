/**
 * sw.js — caches the app shell so the app opens and works fully offline
 * after the first successful load. Student/attendance data itself lives in
 * IndexedDB (see db.js), not here.
 */
const CACHE_NAME = 'attendance-shell-v1';
const SHELL_FILES = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './db.js',
  './sync.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(
        SHELL_FILES.map((url) =>
          cache.add(url).catch((err) => console.warn('SW cache skip:', url, err))
        )
      )
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Cache-first for the app shell; network calls to the Apps Script API are
// intentionally NOT intercepted here so online/offline detection in app.js
// stays accurate and simple.
self.addEventListener('fetch', (event) => {
  const url = event.request.url;
  const isShellRequest =
    SHELL_FILES.some((f) => url.endsWith(f.replace('./', ''))) ||
    url.includes('unpkg.com/html5-qrcode') ||
    url.includes('cdnjs.cloudflare.com/ajax/libs/xlsx');

  if (!isShellRequest) return; // let google.script/other requests hit the network normally

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return response;
        })
        .catch(() => cached);
    })
  );
});
