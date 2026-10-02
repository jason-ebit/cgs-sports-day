const CACHE = 'cg-sports-day-v15';
const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './landing.css',
  './app.js',
  './content.js',
  './icons.js',
  './live.js',
  './media.js',
  './model.js',
  './rounds.js',
  './timer-model.js',
  './timer-popup.js',
  './schedule.json',
  './manifest.webmanifest',
  './assets/favicon.svg',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/Poppins-Black.ttf',
  './assets/Poppins-Bold.ttf',
  './assets/Poppins-Regular.ttf'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(APP_SHELL.map(path => new Request(path, {cache:'reload'})))));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith('cg-sports-day-') && key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;

  const scheduleRequest = new URL(event.request.url).pathname.endsWith('/schedule.json');
  if (event.request.mode === 'navigate' || scheduleRequest) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(scheduleRequest ? event.request : './index.html', copy));
          return response;
        })
        .catch(() => caches.match(scheduleRequest ? event.request : './index.html', { ignoreSearch: true }))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then(cached => cached || fetch(event.request).then(response => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE).then(cache => cache.put(event.request, copy));
      }
      return response;
    }))
  );
});
