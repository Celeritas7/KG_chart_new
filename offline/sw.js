importScripts('./js/offline-pictures.js');
/* KG Chart Offline: isolated origin, cache-first navigation, no online-startup dependency. */
const SHELL_CACHE_PREFIX = 'kg-offline-shell-';
const MEDIA_PREFIX = 'kg-offline-pack-';
const CLIENT_OWNERS = new Map();
// U3D2B2: deny restricted/unknown clients the legacy public-media fallback.
// This is a client cooperative guard, not server-side authorization; current
// public CDN URLs remain public and cannot be revoked while offline.
const CLIENT_RESTRICTED_MEDIA = new Set();
const PRIVATE_MEDIA_PATH = '/__kg_private_media_v1__/';
const CURRENT_SHELL = SHELL_CACHE_PREFIX + 'APP_REVISION';
async function network(request) {
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),15000);
  try { return await fetch(request,{signal:controller.signal}); } finally {clearTimeout(timer);}
}
// Pages redirects /index.html to /. A followed response retains its URL list
// in CacheStorage, and Fetch rejects it for navigation redirect=manual. Hashes
// cannot detect this. Reconstruct only readable followed navigation responses;
// retain security/content headers and stream the already-decoded body.
function navigationResponse(response) {
  if (!response.redirected) return response;
  const headers = new Headers(response.headers);
  headers.delete('Content-Encoding');
  headers.delete('Content-Length');
  return new Response(response.body, {
    status: response.status, statusText: response.statusText, headers,
  });
}
const shellFetchPath = path => path === './index.html' ? './' : path;

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
      const response = await fetch(shellFetchPath(path), { cache: 'no-store' });
      if (!response.ok) throw Error(`Missing shell dependency: ${path}`);
      const expected=hashes.get(new URL(path,self.registration.scope).href);
      if(expected){
        const bytes=await response.clone().arrayBuffer();
        const value=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
        if(value!==expected) throw Error(`Shell hash mismatch: ${path}`);
      }
      await cache.put(path, path === './index.html' || path === './' ? navigationResponse(response) : response);
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
  // Retain existing shells until an explicit version-aware cleanup is implemented.
  // Commit hashes have no chronological ordering; never guess which is previous.
})()));

async function verifyShell(repair = false, checkHashes = false) {
  const cache=await caches.open(CURRENT_SHELL);
  let response=await cache.match('./shell-manifest.json');
  if(!response && repair) response=await fetch('./shell-manifest.json',{cache:'no-store'});
  if(!response?.ok) throw Error('App manifest is missing. Reconnect to install an update.');
  const manifest=await response.clone().json();
  if(manifest.version!=='APP_REVISION' || !Array.isArray(manifest.files) || !manifest.files.some(f=>f.path==='index.html'))
    throw Error('A different release is available. Reopen online and apply the app update.');
  for(const file of manifest.files) {
    const url=new URL(file.path,self.registration.scope);
    if(url.origin!==self.location.origin || !url.href.startsWith(self.registration.scope) || !/^[a-f0-9]{64}$/.test(file.sha256)) throw Error('Invalid app manifest');
    let saved=await cache.match(url.href);
    if(saved && (repair || checkHashes)) {
      const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await saved.clone().arrayBuffer()))].map(b=>b.toString(16).padStart(2,'0')).join('');
      if(hash!==file.sha256) saved=null;
    }
    if(!saved) {
      if(!repair) throw Error('App file missing: '+file.path);
      const replacement=await fetch(file.path==='index.html' ? self.registration.scope : url.href,{cache:'no-store'});
      if(!replacement.ok) throw Error('Could not repair '+file.path);
      const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await replacement.clone().arrayBuffer()))].map(b=>b.toString(16).padStart(2,'0')).join('');
      if(hash!==file.sha256) throw Error('A newer release is available. Apply its update before repair.');
      await cache.put(url.href,file.path==='index.html' ? navigationResponse(replacement) : replacement);
    }
  }
  if(repair) await cache.put('./shell-manifest.json',response);
}

// A worker may be terminated without controllerchange. Recover ownership from
// the requesting same-origin page, never by guessing an account from storage.
async function ownerFor(clientId) {
  if(CLIENT_OWNERS.has(clientId)) return CLIENT_OWNERS.get(clientId);
  const client=await self.clients.get?.(clientId);
  if(!client || !client.url?.startsWith(self.registration.scope)) return null;
  return new Promise(resolve=>{
    const channel=new MessageChannel();
    const timer=setTimeout(()=>{channel.port1.close();resolve(null);},1500);
    channel.port1.onmessage=e=>{
      clearTimeout(timer);channel.port1.close();
      const value=e.data;
      if(value?.restrictedMedia===true){
        CLIENT_OWNERS.delete(clientId);
        CLIENT_RESTRICTED_MEDIA.add(clientId);
        return resolve(null);
      }
      try {
        const root=new URL(value?.mediaRoot);
        if(!/^[\da-f-]{36}$/i.test(value?.id||'') || root.protocol!=='https:' || !root.hostname.endsWith('.supabase.co') || root.pathname!=='/storage/v1/object/public/vocabulary-assets/' || root.search || root.hash) return resolve(null);
        const owner={owner:value.id,mediaRoot:root.href};
        CLIENT_RESTRICTED_MEDIA.delete(clientId);
        CLIENT_OWNERS.set(clientId,owner);resolve(owner);
      } catch (_) {resolve(null);}
    };
    client.postMessage({type:'KG_OFFLINE_REQUEST_OWNER'},[channel.port2]);
  });
}

self.addEventListener('message', event => {
  if (event.data?.type === 'KG_OFFLINE_GET_VERSION') {
    event.source?.postMessage({ type: 'KG_OFFLINE_VERSION', revision: 'APP_REVISION' });
  }
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
      event.ports?.[0]?.postMessage({ ok: true, revision: 'APP_REVISION' });
    })().catch(error => {
      if (event.ports?.[0]) event.ports[0].postMessage({ ok: false, error: error.message });
      else throw error;
    }));
  }
  if (event.data?.type === 'KG_OFFLINE_OWNER' && /^[\da-f-]{36}$/i.test(event.data.id || '') && event.source?.id) {
    try {
      const root=new URL(event.data.mediaRoot);
      // The owning page supplies the public Storage root from its SDK config;
      // never hard-code a production project or serve another arbitrary origin.
      if (root.protocol === 'https:' && root.hostname.endsWith('.supabase.co') &&
          root.pathname === '/storage/v1/object/public/vocabulary-assets/' && !root.search && !root.hash)
        {
          CLIENT_RESTRICTED_MEDIA.delete(event.source.id);
          CLIENT_OWNERS.set(event.source.id,{owner:event.data.id,mediaRoot:root.href});
        }
    } catch (_) { /* Malformed or missing Storage root must not unlock media. */ }
  }
  if (event.data?.type === 'KG_OFFLINE_LOCK') CLIENT_OWNERS.delete(event.source?.id);
  if (event.data?.type === 'KG_OFFLINE_RESTRICTED_MEDIA' && event.source?.id) {
    CLIENT_OWNERS.delete(event.source.id);
    CLIENT_RESTRICTED_MEDIA.add(event.source.id);
  }
  if (event.data?.type === 'KG_OFFLINE_CHECK_SHELL') {
    event.waitUntil(verifyShell().then(
      ()=>event.source?.postMessage({type:'KG_OFFLINE_SHELL_READY',revision:'APP_REVISION',sharedPictures:1}),
      error=>event.source?.postMessage({type:'KG_OFFLINE_SHELL_INCOMPLETE',message:error.message})
    ));
  }
  if(event.data?.type==='KG_OFFLINE_AUDIT_SHELL' && event.source?.id) {
    event.waitUntil(verifyShell(false,true).then(
      ()=>event.ports?.[0]?.postMessage({ok:true,revision:'APP_REVISION'}),
      error=>event.ports?.[0]?.postMessage({ok:false,error:error.message})
    ));
  }
  if(event.data?.type==='KG_OFFLINE_REPAIR_SHELL' && event.source?.id) {
    event.waitUntil(verifyShell(true).then(
      ()=>event.ports?.[0]?.postMessage({ok:true}),
      error=>event.ports?.[0]?.postMessage({ok:false,error:error.message})
    ));
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
    const match = await (await self.KGSharedPictures.open(cacheName,owner)).match(request.url);
    if (match) return match;
  }
  return null;
}
async function audioRange(response, request) {
  const range=request.headers?.get?.('range');
  if(!range || !/\.mp3(?:\?|$)/i.test(request.url)) return response;
  const match=/^bytes=(\d*)-(\d*)$/.exec(range);
  if(!match || (!match[1] && !match[2])) return response;
  const bytes=await response.arrayBuffer(), size=bytes.byteLength;
  const start=match[1] ? Number(match[1]) : Math.max(0,size-Number(match[2]));
  const end=match[1] ? (match[2] ? Math.min(Number(match[2]),size-1) : size-1) : size-1;
  if(!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start>end || start>=size)
    return new Response(null,{status:416,headers:{'Content-Range':`bytes */${size}`}});
  const headers=new Headers(response.headers);
  headers.set('Content-Range',`bytes ${start}-${end}/${size}`);
  headers.set('Content-Length',String(end-start+1));headers.set('Accept-Ranges','bytes');
  headers.delete('Content-Encoding');
  return new Response(bytes.slice(start,end+1),{status:206,headers});
}

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  const ownOrigin = url.origin === self.location.origin;
  // Private CacheStorage bytes are only read directly by the verified owner
  // page and re-exposed through revocable blob: URLs. An HTTP request must
  // NEVER retrieve a synthetic private key, cached shell, or network fallback.
  if (ownOrigin && url.pathname.includes(PRIVATE_MEDIA_PATH)) {
    event.respondWith(new Response('Private media is not available over HTTP',{
      status:403,headers:{'Content-Type':'text/plain; charset=utf-8',
        'Cache-Control':'no-store'}
    }));
    return;
  }
  const client=CLIENT_OWNERS.get(event.clientId);
  const isMedia = (client && url.href.startsWith(client.mediaRoot)) || (url.protocol==='https:' && url.hostname.endsWith('.supabase.co') && url.pathname.startsWith('/storage/v1/object/public/vocabulary-assets/'));
  if (isMedia) {
    event.respondWith((async () => {
      // Per-client owner; never search another account's packs or unvalidated staging caches.
      try {
        const resolved=client || await ownerFor(event.clientId);
        if (CLIENT_RESTRICTED_MEDIA.has(event.clientId))
          return new Response('Restricted client cannot use public media',{
            status:403,headers:{'Cache-Control':'no-store'}
          });
        const cached = resolved && url.href.startsWith(resolved.mediaRoot) ? await localMedia(event.request, resolved.owner) : null;
        if (cached) return audioRange(cached,event.request);
      } catch (_) {
        // A temporarily inaccessible local pack must not block a valid
        // published media request when the device is back online.
      }
      return network(event.request);
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
      if (hit) return navigation ? navigationResponse(hit) : hit;
    } catch (_) {
      // CacheStorage can reject after an interrupted media download or under
      // browser storage pressure. Never let that rejection become ERR_FAILED
      // for the app's navigation: a connected visit can still load from Pages.
    }
    try {
      const response = await network(event.request);
      return navigation ? navigationResponse(response) : response;
    }
    catch (_) {
      if (navigation) {
        try {
          const cache = await caches.open(CURRENT_SHELL);
          const fallback = await cache.match('./index.html');
          if (fallback) return navigationResponse(fallback);
        } catch (_) { /* Local shell is temporarily unavailable. */ }
      }
      // Never return HTML as a missing JS/CSS/font response. More importantly,
      // always resolve respondWith(), even when both cache and network fail.
      return new Response('KG Chart Offline cannot read its saved app shell. Reconnect and reopen to repair it. Your downloaded packs and progress have not been cleared.',
        { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
    }
  })());
});
