/* Replaced with a content-addressed, complete file list by build-offline.mjs.
   A failed install never activates an incomplete shell. */
const SHELL_CACHE = '__SHELL_CACHE__';
const SHELL_FILES = __SHELL_FILES__;
const SHELL_URL = new URL('./index.html', self.registration.scope).href;
const FALLBACK_URL = new URL('./offline.html', self.registration.scope).href;

self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL_CACHE).then(cache => cache.addAll(SHELL_FILES)));
  // Do not call skipWaiting: a new release must not take over mid-quiz.
});

self.addEventListener('activate', event => {
  // Previous complete caches are intentionally retained for rollback.
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith(new URL(self.registration.scope).pathname)) return;

  if (event.request.mode === 'navigate') {
    event.respondWith(caches.open(SHELL_CACHE).then(async cache =>
      (await cache.match(SHELL_URL)) || (await cache.match(FALLBACK_URL)) ||
      fetch(event.request).catch(() => new Response('Offline shell unavailable', { status: 503 }))
    ));
    return;
  }
  // Cache-first: offline startup never waits on a slow or stalled network.
  event.respondWith(caches.open(SHELL_CACHE).then(async cache =>
    (await cache.match(event.request)) || fetch(event.request)
  ));
});

self.addEventListener('message', event => {
  if (event.data?.type === 'KG_OFFLINE_SHELL_VERSION') {
    event.ports[0]?.postMessage({ cache: SHELL_CACHE });
  }
});
