import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { createHash, webcrypto } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';

const scope='https://kg-offline.example/';
const source=await fs.readFile(new URL('../sw.js',import.meta.url),'utf8');
const sha=value=>createHash('sha256').update(value).digest('hex');

function worker(revision,existing=new Map(),{badFile=null,quotaFile=null,networkDown=false,indexedDB=new IDBFactory()}={}) {
  const responses={
    './':'<h1>KG Chart</h1>',
    './index.html':'<h1>KG Chart</h1>',
    './assets/app.js':'console.log("offline app")',
    './icons/apple-touch-icon.png':'locally bundled icon',
    './offline-build.json':JSON.stringify({appVersion:revision}),
  };
  const manifest={version:revision,files:Object.entries(responses).filter(([path])=>path!=='./' && path!=='./offline-build.json')
    .map(([path,body])=>({path:path.slice(2),sha256:sha(body)}))};
  const listeners=new Map();
  let skipWaitingCalls=0;
  const key=url=>new URL(url?.url||url,scope).href;
  class Cache {
    constructor(name){this.name=name;this.items=new Map();}
    async put(url,response){
      if(this.name.includes(revision) && String(url).includes(quotaFile)) throw Object.assign(Error('Storage full'),{name:'QuotaExceededError'});
      this.items.set(key(url),response.clone());
    }
    async match(url){return this.items.get(key(url))?.clone();}
  }
  const cacheStorage={
    async open(name){if(!existing.has(name))existing.set(name,new Cache(name));return existing.get(name);},
    async delete(name){return existing.delete(name);},
    async keys(){return [...existing.keys()];},
  };
  const download=async input=>{
    if(networkDown)throw Error('Network connection stalled');
    const path='./'+new URL(key(input)).pathname.slice(1);
    if(path==='./shell-manifest.json')return new Response(JSON.stringify(manifest));
    const body=path===badFile?'broken bytes':responses[path];
    if(body===undefined)return new Response('Missing',{status:404});
    return new Response(body);
  };
  const context={caches:cacheStorage,indexedDB,crypto:webcrypto,URL,Response,TextEncoder,Uint8Array,
    fetch:download,self:{registration:{scope},location:{origin:new URL(scope).origin},
      clients:{claim:async()=>{}},skipWaiting:async()=>{skipWaitingCalls++;},
      addEventListener(type,handler){listeners.set(type,handler);}}};
  vm.runInNewContext(source.replaceAll('APP_REVISION',revision),context,{filename:'offline/sw.js'});
  async function event(type,properties={}){
    let result;
    const input={...properties,waitUntil(p){result=Promise.resolve(p);},respondWith(p){result=Promise.resolve(p);}};
    listeners.get(type)(input);
    return result;
  }
  return {event,caches:existing,cacheStorage,indexedDB,manifest,get skipWaitingCalls(){return skipWaitingCalls;}};
}

test('service worker hashes every generated shell file and opens a cached launch with the network stalled',async()=>{
  const w=worker('v-one');
  await w.event('install');
  const cache=w.caches.get('kg-offline-shell-v-one');
  assert(cache,'Full shell became active only after complete install');
  assert(await cache.match('./icons/apple-touch-icon.png'),'A new icon is not missed by a hard-coded cache list');
  assert(await cache.match('./assets/app.js'));
  let handshake;
  await w.event('message',{data:{type:'KG_OFFLINE_CHECK_SHELL'},source:{postMessage(v){handshake=v;}}});
  assert.equal(handshake.type,'KG_OFFLINE_SHELL_READY');

  const stalled=worker('v-one',w.caches,{networkDown:true});
  const response=await stalled.event('fetch',{request:{method:'GET',mode:'navigate',url:scope+'lesson?mode=offline'}});
  assert.equal(await response.text(),'<h1>KG Chart</h1>');
});

test('a cache failure after an interrupted media download never rejects app navigation',async()=>{
  const w=worker('v-one');
  await w.event('install');
  const stage=await w.cacheStorage.open('kg-offline-pack-88888888-8888-4888-8888-888888888888-my-interrupted');
  await stage.put('./partially-downloaded.jpg',new Response('saved bytes'));
  const shell=w.caches.get('kg-offline-shell-v-one');
  const originalMatch=shell.match;
  shell.match=async()=>{throw Error('Simulated broken Chrome cache read');};

  // Normal Chrome must fall back to the live Pages response if CacheStorage is
  // temporarily unreadable instead of surfacing a browser-level ERR_FAILED.
  const connected=await w.event('fetch',{request:{method:'GET',mode:'navigate',url:scope}});
  assert.equal(connected.status,200);
  assert.equal(await connected.text(),'<h1>KG Chart</h1>');

  // A cache failure and no connection must still resolve respondWith with an
  // actionable error, not throw, and must never delete the partial download.
  const disconnected=worker('v-one',w.caches,{networkDown:true});
  const offline=await disconnected.event('fetch',{request:{method:'GET',mode:'navigate',url:scope}});
  assert.equal(offline.status,503);
  assert.match(await offline.text(),/downloaded packs and progress have not been cleared/);
  assert.equal(await (await stage.match('./partially-downloaded.jpg')).text(),'saved bytes');
  assert(w.caches.has('kg-offline-shell-v-one'));

  shell.match=originalMatch;
  const cached=await disconnected.event('fetch',{request:{method:'GET',mode:'navigate',url:scope}});
  assert.equal(cached.status,200,'Recovered shell can cold-start offline again');

  // Even a failure opening the shell cache must fail open while connected.
  const originalOpen=w.cacheStorage.open;
  w.cacheStorage.open=async name=>{
    if(name==='kg-offline-shell-v-one')throw Error('CacheStorage open rejected');
    return originalOpen(name);
  };
  const opened=await w.event('fetch',{request:{method:'GET',mode:'navigate',url:scope}});
  assert.equal(opened.status,200);
  assert.equal(await opened.text(),'<h1>KG Chart</h1>');
});

test('failed network requests for scripts never receive an HTML shell',async()=>{
  const w=worker('v-one');
  await w.event('install');
  const disconnected=worker('v-one',w.caches,{networkDown:true});
  const response=await disconnected.event('fetch',{request:{method:'GET',mode:'same-origin',url:scope+'missing.js'}});
  assert.equal(response.status,503);
  assert.match(response.headers.get('Content-Type'),/^text\/plain/);
  assert.doesNotMatch(await response.text(),/<h1>KG Chart<\/h1>/);
});

test('corrupt downloads and exhausted storage reject an update without losing the prior shell',async()=>{
  const caches=new Map();
  await worker('v-one',caches).event('install');
  await assert.rejects(worker('v-two',caches,{badFile:'./assets/app.js'}).event('install'),/hash mismatch/);
  assert(caches.has('kg-offline-shell-v-one'));
  assert(!caches.has('kg-offline-shell-v-two'));

  await assert.rejects(worker('v-three',caches,{quotaFile:'icons/apple-touch-icon.png'}).event('install'),/Storage full/);
  assert(caches.has('kg-offline-shell-v-one'));
  assert(!caches.has('kg-offline-shell-v-three'));
});

test('normal updates wait for explicit action; incomplete shell and unknown senders cannot activate',async()=>{
  const w=worker('v-one');
  await w.event('install');
  assert.equal(w.skipWaitingCalls,0,'Fresh installations never force activation');
  await w.event('message',{data:{type:'KG_OFFLINE_APPLY_UPDATE'}});
  assert.equal(w.skipWaitingCalls,0,'A request without an owning client is ignored');
  const shell=w.caches.get('kg-offline-shell-v-one');
  shell.items.delete(scope+'shell-manifest.json');
  await assert.rejects(w.event('message',{data:{type:'KG_OFFLINE_APPLY_UPDATE'},source:{id:'tab-1'}}),/incomplete/);
  assert.equal(w.skipWaitingCalls,0,'An incomplete installation never activates');
  await shell.put('./shell-manifest.json',new Response(JSON.stringify(w.manifest)));
  const icon=shell.items.get(scope+'icons/apple-touch-icon.png');
  shell.items.delete(scope+'icons/apple-touch-icon.png');
  await assert.rejects(w.event('message',{data:{type:'KG_OFFLINE_APPLY_UPDATE'},source:{id:'tab-1'}}),/incomplete/);
  assert.equal(w.skipWaitingCalls,0,'A missing cached dependency prevents activation');
  shell.items.set(scope+'icons/apple-touch-icon.png',icon);
  await w.event('message',{data:{type:'KG_OFFLINE_APPLY_UPDATE'},source:{id:'tab-1'}});
  assert.equal(w.skipWaitingCalls,1,'A verified waiting worker activates after user request');
});

test('one-time legacy rescue activates only complete shells and leaves downloaded packs untouched',async()=>{
  const caches=new Map();
  const old=worker('v-old',caches);
  await old.event('install');
  const media=await old.cacheStorage.open('kg-offline-pack-88888888-8888-4888-8888-888888888888-my-v1');
  await media.put('./saved-image.jpg',new Response('my offline picture'));
  const failed=worker('v-broken',caches,{badFile:'./assets/app.js'});
  await assert.rejects(failed.event('install'),/hash mismatch/);
  assert.equal(failed.skipWaitingCalls,0,'Broken rescue must not take over');
  assert(!caches.has('kg-offline-legacy-update-recovered-v1'));

  const rescue=worker('v-rescue',caches);
  await rescue.event('install');
  assert.equal(rescue.skipWaitingCalls,1,'Legacy clients get one automatic, non-reloading activation');
  assert(caches.has('kg-offline-shell-v-old'),'Old shell remains for rollback');
  assert.equal(await (await media.match('./saved-image.jpg')).text(),'my offline picture');
  assert(caches.has('kg-offline-legacy-update-recovered-v1'));

  const later=worker('v-later',caches);
  await later.event('install');
  assert.equal(later.skipWaitingCalls,0,'Later releases wait for a visible Apply update action');
  await later.event('message',{data:{type:'KG_OFFLINE_APPLY_UPDATE'},source:{id:'tab-1'}});
  assert.equal(later.skipWaitingCalls,1);
});

test('public media placeholders are served only to their verified owning client',async()=>{
  const w=worker('v-one');
  const owner='88888888-8888-4888-8888-888888888888';
  const storageRoot='https://example.supabase.co/storage/v1/object/public/vocabulary-assets/';
  const mediaUrl=storageRoot+'body/claw.jpg';
  const cacheName='kg-offline-pack-'+owner+'-my-v1';
  const db=await new Promise((resolve,reject)=>{
    const r=w.indexedDB.open('kg-chart-offline-v1',1);
    r.onupgradeneeded=()=>{r.result.createObjectStore('kv');r.result.createObjectStore('outbox',{keyPath:'id'});};
    r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
  });
  await new Promise((resolve,reject)=>{
    const tx=db.transaction('kv','readwrite');
    tx.objectStore('kv').put([cacheName],'active-caches:'+owner);
    tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);
  });
  db.close();
  await (await w.cacheStorage.open(cacheName)).put(mediaUrl,
    new Response('<svg>Image unavailable</svg>',{headers:{'Content-Type':'image/svg+xml'}}));

  // A different account or unknown client must not discover this account's media.
  const request={method:'GET',mode:'no-cors',url:mediaUrl};
  assert.equal(await w.event('fetch',{request,clientId:'client-1'}),undefined);
  await w.event('message',{data:{type:'KG_OFFLINE_OWNER',id:owner,mediaRoot:storageRoot},source:{id:'client-1'}});
  const saved=await w.event('fetch',{request,clientId:'client-1'});
  assert.equal(await saved.text(),'<svg>Image unavailable</svg>');
  assert.equal(await w.event('fetch',{request,clientId:'client-2'}),undefined);
  await w.event('message',{data:{type:'KG_OFFLINE_LOCK'},source:{id:'client-1'}});
  assert.equal(await w.event('fetch',{request,clientId:'client-1'}),undefined);
});
