importScripts('./js/image-store.js');
const CACHE = 'kg-chart-install-v3';
const FILES = ['./offline.html','./icons/kg-brand.svg','./icons/kg-brand.svg?v=2'];
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES))); self.skipWaiting(); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('kg-chart-install-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;
  const imageKey = KGPictureStore.key(url.href);
  if (imageKey && event.request.cache !== 'no-cache') {
    event.respondWith((async () => {
      const cache = await caches.open(KGPictureStore.CACHE);
      const saved = await cache.match(imageKey);
      // Cache-first, including quiz retries: a working local copy never waits on 4G.
      if (saved) return saved;
      return fetch(event.request);
    })());
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.match('./offline.html')));
  } else if (FILES.some(path => new URL(path, self.registration.scope).href === url.href)) {
    event.respondWith(caches.match(event.request).then(hit => hit || fetch(event.request)));
  }
});


self.addEventListener('message', event => { if (event.data?.type === 'KG_PICTURES_READY') event.ports[0]?.postMessage('kg-pictures-v1'); });
