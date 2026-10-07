const VERSION = '24';
const CACHE = `cg-sports-day-v${VERSION}`;
const scopeURL = new URL('./', self.location.href);
const homeURL = new URL('./index.html', scopeURL).href;
const scheduleURL = new URL('./schedule.json', scopeURL).pathname;
const APP_SHELL = [
  './',
  './index.html',
  ...[
    './styles.css', './landing.css', './app.js', './content.js',
    './icons.js', './live.js', './media.js', './model.js', './rounds.js',
    './timer-model.js', './timer-popup.js', './view-state.js', './device-store.js', './schedule.json',
    './sync.js', './sync-config.js', './before-sync.js', './connection-badge.js', './game-timeline.js'
  ].map(path => `${path}?v=${VERSION}`),
  './manifest.webmanifest',
  './assets/favicon.svg',
  './assets/vendor/supabase-2.117.2.js',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/Poppins-Black.ttf',
  './assets/Poppins-Bold.ttf',
  './assets/Poppins-Regular.ttf'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(APP_SHELL.map(path => new Request(new URL(path, scopeURL), {cache:'reload'}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith('cg-sports-day-') && key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

// Keep successful responses usable even if a cache write fails (for example, when storage is full).
function remember(event, cache, key, response) {
  event.waitUntil(cache.put(key, response.clone()).catch(() => {}));
}

async function networkFirst(event, cache, key) {
  let response;
  try {
    response = await fetch(event.request);
  } catch (error) {
    const cached = await cache.match(key);
    if (cached) return cached;
    throw error;
  }
  if (response.ok) {
    remember(event, cache, key, response);
    return response;
  }
  // A temporary server error must not replace the usable offline page or schedule.
  return await cache.match(key) || response;
}

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== scopeURL.origin || !url.href.startsWith(scopeURL.href)) return;
  const homeRequest = event.request.mode === 'navigate' && (url.pathname === scopeURL.pathname || url.pathname === new URL(homeURL).pathname);

  event.respondWith(caches.open(CACHE).then(async cache => {
    if (homeRequest) {
      // Only installation replaces the page, after every asset for that release is cached.
      // Serving future HTML here could strand an offline desk with missing future modules.
      return await cache.match(homeURL) || fetch(event.request);
    }
    if (url.pathname === scheduleURL) {
      return networkFirst(event, cache, event.request);
    }

    // Query versions are intentional: a new page must never receive a previous release's module.
    const cached = await cache.match(event.request);
    if (cached) return cached;
    const response = await fetch(event.request);
    if (response.ok) remember(event, cache, event.request, response);
    return response;
  }));
});
