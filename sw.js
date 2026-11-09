const CACHE = 'kg-chart-install-v1';
const FILES = ['./offline.html','./icons/kg-brand.svg'];
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES))); self.skipWaiting(); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('kg-chart-install-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.match('./offline.html')));
  } else if (FILES.some(path => new URL(path, self.registration.scope).href === url.href)) {
    event.respondWith(caches.match(event.request).then(hit => hit || fetch(event.request)));
  }
});
