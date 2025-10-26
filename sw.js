const CACHE = 'dumby-cache-v2';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './mindmap.css',
  './app.js',
  './mindmap.js',
  './manifest.webmanifest',
  './data/prompts.json',
  './data/forest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin === location.origin) {
    event.respondWith(
      caches.match(event.request, { ignoreSearch: true }).then(cached => cached || fetch(event.request))
    );
  }
});
