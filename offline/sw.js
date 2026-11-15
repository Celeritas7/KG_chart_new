/* KG Chart Offline: isolated origin, cache-first navigation, no online-startup dependency. */
const SHELL_CACHE_PREFIX = 'kg-offline-shell-';
const MEDIA_PREFIX = 'kg-offline-pack-';
const CLIENT_OWNERS = new Map();
const CURRENT_SHELL = SHELL_CACHE_PREFIX + 'APP_REVISION';
// Older releases can leave users stranded behind cache-first HTML with no
// "Apply update" button. Rescue those installations once, without reloading
// their open tabs. Later releases require an explicit, safe user action.
const LEGACY_RECOVERY_MARKER = 'kg-offline-legacy-update-recovered-v1';
self.addEventListener('install', event => event.waitUntil((async () => {
  const manifest = await fetch('./shell-manifest.json', { cache: 'no-store' }).then(r => { if (!r.ok) throw Error('Shell manifest unavailable'); return r.json(); });
  // The generated build manifest is exhaustive; hard-coded lists can silently
  // omit a newly added script, icon or font and yield a false offline-ready state.
  if (!Array.isArray(manifest.files) || manifest.version !== 'APP_REVISION' ||
      !manifest.files.some(x => x.path === 'index.html')) throw Error('Invalid offline shell manifest');
  const cache = await caches.open(CURRENT_SHELL);
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
    const installed = await caches.keys();
    if (installed.some(name => name.startsWith(SHELL_CACHE_PREFIX) && name !== CURRENT_SHELL) &&
        !installed.includes(LEGACY_RECOVERY_MARKER)) {
      // This one-time activation migrates existing stuck clients. Their current
      // JS and quiz remain running; only a later navigation loads the new shell.
      await caches.open(LEGACY_RECOVERY_MARKER);
      await self.skipWaiting();
    }
  } catch (e) {
    await caches.delete(CURRENT_SHELL); // incomplete candidate only, older cache is untouched
    throw e;
  }
})()));

self.addEventListener('activate', event => event.waitUntil((async () => {
  await self.clients.claim();
  // Retain the previous shell for rollback; never touch another PWA's origin.
  try {
    const old = (await caches.keys()).filter(k => k.startsWith(SHELL_CACHE_PREFIX) && k !== CURRENT_SHELL).sort();
    if (old.length > 1) await Promise.all(old.slice(0, -1).map(k => caches.delete(k)));
  } catch (_) {
    // Cache cleanup is optional. A transient storage failure must not strand
    // the user behind an older worker or touch their downloaded media packs.
  }
})()));

self.addEventListener('message', event => {
  if (event.data?.type === 'KG_OFFLINE_APPLY_UPDATE' && event.source?.id) {
    event.waitUntil((async () => {
      // A waiting worker is installed only after manifest hashes were verified.
      // Refuse an update if the browser has since evicted its critical shell.
      const cache = await caches.open(CURRENT_SHELL);
      const index = await cache.match('./index.html');
      const manifest = await cache.match('./shell-manifest.json');
      if (!index || !manifest) throw Error('New app shell is incomplete');
      const metadata = await manifest.json();
      if (metadata.version !== 'APP_REVISION' || !Array.isArray(metadata.files) ||
          !metadata.files.some(file => file.path === 'index.html'))
        throw Error('New app shell version is invalid');
      for (const file of metadata.files) {
        if (!await cache.match('./' + file.path)) throw Error('New app shell is incomplete');
      }
      await self.skipWaiting();
    })());
  }
  if (event.data?.type === 'KG_OFFLINE_OWNER' && /^[\da-f-]{36}$/i.test(event.data.id || '') && event.source?.id) {
    try {
      const root=new URL(event.data.mediaRoot);
      // The owning page supplies the public Storage root from its SDK config;
      // never hard-code a production project or serve another arbitrary origin.
      if (root.protocol === 'https:' && root.hostname.endsWith('.supabase.co') &&
          root.pathname === '/storage/v1/object/public/vocabulary-assets/' && !root.search && !root.hash)
        CLIENT_OWNERS.set(event.source.id,{owner:event.data.id,mediaRoot:root.href});
    } catch (_) { /* Malformed or missing Storage root must not unlock media. */ }
  }
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
  const client=CLIENT_OWNERS.get(event.clientId);
  const isMedia = client && url.href.startsWith(client.mediaRoot);
  if (isMedia) {
    event.respondWith((async () => {
      // Per-client owner; never search another account's packs or unvalidated staging caches.
      try {
        const cached = await localMedia(event.request, client.owner);
        if (cached) return cached;
      } catch (_) {
        // A temporarily inaccessible local pack must not block a valid
        // published media request when the device is back online.
      }
      return fetch(event.request);
    })());
    return;
  }
  if (!ownOrigin) return;
  event.respondWith((async () => {
    const navigation = event.request.mode === 'navigate';
    const key = navigation ? new URL('./index.html', self.registration.scope) : event.request;
    try {
      const cache = await caches.open(CURRENT_SHELL);
      const hit = await cache.match(key, { ignoreSearch: navigation });
      if (hit) return hit;
    } catch (_) {
      // CacheStorage can reject after an interrupted media download or under
      // browser storage pressure. Never let that rejection become ERR_FAILED
      // for the app's navigation: a connected visit can still load from Pages.
    }
    try { return await fetch(event.request); }
    catch (_) {
      if (navigation) {
        try {
          const cache = await caches.open(CURRENT_SHELL);
          const fallback = await cache.match('./index.html');
          if (fallback) return fallback;
        } catch (_) { /* Local shell is temporarily unavailable. */ }
      }
      // Never return HTML as a missing JS/CSS/font response. More importantly,
      // always resolve respondWith(), even when both cache and network fail.
      return new Response('KG Chart Offline cannot read its saved app shell. Reconnect and reopen to repair it. Your downloaded packs and progress have not been cleared.',
        { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
    }
  })());
});
