/* KG Chart Offline: isolated origin, cache-first navigation, no online-startup dependency. */
const SHELL_CACHE_PREFIX = 'kg-offline-shell-';
const MEDIA_PREFIX = 'kg-offline-pack-';
const CLIENT_OWNERS = new Map();
const CURRENT_SHELL = SHELL_CACHE_PREFIX + 'APP_REVISION';
// Only a complete shell can be made active. skipWaiting is deliberately omitted.
self.addEventListener('install', event => event.waitUntil((async () => {
  const manifest = await fetch('./shell-manifest.json', { cache: 'no-store' }).then(r => { if (!r.ok) throw Error('Shell manifest unavailable'); return r.json(); });
  const cache = await caches.open(CURRENT_SHELL);
  // The generated build manifest is exhaustive; hard-coded lists can silently
  // omit a newly added script, icon or font and yield a false offline-ready state.
  if (!Array.isArray(manifest.files) || manifest.version !== 'APP_REVISION' ||
      !manifest.files.some(x => x.path === 'index.html')) throw Error('Invalid offline shell manifest');
  const urls = [...new Set(['./', './shell-manifest.json', './offline-build.json',
    ...manifest.files.map(x => './' + x.path)])];
  const hashes = new Map(manifest.files.map(f=>[new URL('./'+f.path,self.registration.scope).href,f.sha256]));
  try {
    // Streaming one file at a time avoids the all-or-nothing memory spike of cache.addAll.
    for (const path of urls) {
      const response = await fetch(path, { cache: 'no-store' });
      if (!response.ok) throw Error(`Missing shell dependency: ${path}`);
      const expected=hashes.get(new URL(path,self.registration.scope).href);
      if(expected){
        const bytes=await response.clone().arrayBuffer();
        const value=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
        if(value!==expected) throw Error(`Shell hash mismatch: ${path}`);
      }
      await cache.put(path, response);
    }
  } catch (e) {
    await caches.delete(CURRENT_SHELL); // incomplete candidate only, older cache is untouched
    throw e;
  }
})()));

self.addEventListener('activate', event => event.waitUntil((async () => {
  await self.clients.claim();
  // Retain the previous shell for rollback; never touch another PWA's origin.
  const old = (await caches.keys()).filter(k => k.startsWith(SHELL_CACHE_PREFIX) && k !== CURRENT_SHELL).sort();
  if (old.length > 1) await Promise.all(old.slice(0, -1).map(k => caches.delete(k)));
})()));

self.addEventListener('message', event => {
  if (event.data?.type === 'KG_OFFLINE_OWNER' && /^[\da-f-]{36}$/i.test(event.data.id || ''))
    CLIENT_OWNERS.set(event.source.id, event.data.id);
  if (event.data?.type === 'KG_OFFLINE_LOCK') CLIENT_OWNERS.delete(event.source.id);
  if (event.data?.type === 'KG_OFFLINE_CHECK_SHELL') {
    event.waitUntil((async () => {
      const cache=await caches.open(CURRENT_SHELL);
      if(await cache.match('./index.html'))
        event.source?.postMessage({type:'KG_OFFLINE_SHELL_READY',revision:'APP_REVISION'});
    })());
  }
});

const openDB = () => new Promise((resolve, reject) => {
  const req = indexedDB.open('kg-chart-offline-v1', 1);
  req.onupgradeneeded = () => {
    const db = req.result;
    if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
    if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox', { keyPath: 'id' });
  };
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});
async function activeCaches(owner) {
  const db = await openDB();
  const keys = await new Promise((resolve, reject) => {
    const request = db.transaction('kv').objectStore('kv').get(`active-caches:${owner}`);
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return keys.filter(k => k.startsWith(MEDIA_PREFIX + owner + '-'));
}
async function localMedia(request, owner) {
  if (!owner) return null;
  for (const cacheName of await activeCaches(owner)) {
    const match = await (await caches.open(cacheName)).match(request.url);
    if (match) return match;
  }
  return null;
}
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  const ownOrigin = url.origin === self.location.origin;
  const isMedia = url.origin === 'https://ulgrfumbwjovbjzjiems.supabase.co' &&
    url.pathname.startsWith('/storage/v1/object/public/vocabulary-assets/');
  if (isMedia) {
    event.respondWith((async () => {
      // Per-client owner; never search another account's packs or unvalidated staging caches.
      const cached = await localMedia(event.request, CLIENT_OWNERS.get(event.clientId));
      if (cached) return cached;
      return fetch(event.request);
    })());
    return;
  }
  if (!ownOrigin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CURRENT_SHELL);
    const key = event.request.mode === 'navigate' ? new URL('./index.html', self.registration.scope) : event.request;
    const hit = await cache.match(key, { ignoreSearch: event.request.mode === 'navigate' });
    if (hit) return hit;
    try { return await fetch(event.request); }
    catch (_) { return (await cache.match('./index.html')) || new Response('KG Chart Offline is recovering. Reopen the app while online to repair the installation.', { status: 503, headers: { 'Content-Type': 'text/plain' } }); }
  })());
});
