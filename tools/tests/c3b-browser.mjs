// Real Chromium, one disposable localhost origin and profile. No public network or production accounts.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,extname} from 'node:path';
import {chromium} from 'playwright';

const OWNER='88888888-8888-4888-8888-888888888888';
const OTHER='99999999-9999-4999-8999-999999999999';
const MEDIA='https://example.supabase.co/storage/v1/object/public/vocabulary-assets/';
const PICTURE=MEDIA+'pictures/synthetic.jpg';
const LEGACY=MEDIA+'pictures/legacy.jpg';
const AUDIO=MEDIA+'audio/my/synthetic.mp3';
const assets={old:resolve('dist-offline'),unified:resolve('dist-unified')};
const versions={
 old:JSON.parse(await readFile(join(assets.old,'offline-build.json'),'utf8')).appVersion,
 unified:JSON.parse(await readFile(join(assets.unified,'offline-build.json'),'utf8')).appVersion,
};
assert(versions.unified.endsWith('-unified') && versions.old!==versions.unified);
const contentTypes={'.js':'text/javascript','.json':'application/json','.html':'text/html','.webmanifest':'application/manifest+json','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.mp3':'audio/mpeg'};
let edition='old',broken=false;
const server=createServer(async(req,res)=>{
 try{
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(pathname==='/__c3b__/'){
   res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});
   return res.end('<!doctype html><title>C3B disposable harness</title><h1>Local migration rehearsal</h1>');
  }
  const path=pathname==='/'?'index.html':decodeURIComponent(pathname.slice(1));
  if(path==='index.html'||path==='sw.js')console.log('C3B local server',JSON.stringify({path,edition,broken}));
  if(!path || path.split('/').some(p=>p==='..'||p==='.') || path.includes('\\'))throw Error('Bad path');
  const bytes=await readFile(join(assets[edition],path));
  let output=bytes;
  if(broken && path==='sw.js')output=Buffer.from(bytes.toString('utf8').replaceAll(versions.unified,'c3b-broken-revision'));
  res.writeHead(200,{'Content-Type':contentTypes[extname(path)]||'application/octet-stream','Cache-Control':'no-store'});
  res.end(output);
 }catch(e){res.writeHead(404,{'Content-Type':'text/plain','Cache-Control':'no-store'});res.end('Not found');}
});
const listen=()=>new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
await listen();
const origin='http://127.0.0.1:'+server.address().port;
const profile=await mkdtemp(join(tmpdir(),'kg-c3b-disposable-'));
let browser;
const deadline=60_000;
const expectState=async(page,version)=>{
 await page.waitForFunction(()=>window.__c3bVersion!==undefined,null,{timeout:10000});
 const diagnostic=await page.evaluate(()=>({pageVersion:window.__c3bVersion,globalVersion:window.KG_APP_VERSION,unified:window.KG_UNIFIED,controller:navigator.serviceWorker.controller?.state,title:document.title}));
 console.log('C3B edition diagnostic',JSON.stringify({expected:version,...diagnostic}));
 assert.equal(diagnostic.pageVersion,version,'Actual app shell revision must match worker after navigation');
 const state=await page.evaluate(async()=>{
  const open=()=>new Promise((resolve,reject)=>{const r=indexedDB.open('kg-chart-offline-v1',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  const db=await open();
  const get=(store,key)=>new Promise((resolve,reject)=>{const q=db.transaction(store).objectStore(store).get(key);q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});
  const [owner,enrollment,pack,outbox,ratings,levels,completions,other]=await Promise.all([
   get('kv','active-owner'),get('kv','enroll:'+window.__c3bOwner),get('kv','active:'+window.__c3bOwner+':my'),
   get('outbox','synthetic-pending'),get('kv','rows:'+window.__c3bOwner+':kg_chart_user_ratings'),
   get('kv','rows:'+window.__c3bOwner+':kg_chart_user_levels'),
   get('kv','rows:'+window.__c3bOwner+':kg_chart_topic_completions'),
   get('kv','rows:'+window.__c3bOther+':kg_chart_user_ratings')]);
  db.close();
  const pic=await window.KGSharedPictures.open('kg-offline-pack-'+owner+'-my-v2',owner);
  const media=await Promise.all([window.__c3bPicture,window.__c3bLegacy,window.__c3bAudio].map(async url=>(await pic.match(url))?.text()));
  const cachesBefore=await caches.keys();
  const app=window.KGOffline.status();
  return {owner,enrollment,pack,outbox,ratings,levels,completions,other,media,cachesBefore,app};
 });
 assert.equal(state.owner,OWNER);
 assert.equal(state.enrollment.unlocked,true);
 assert.equal(state.pack,'synthetic-pack');
 assert.equal(state.outbox.id,'synthetic-pending');
 assert.equal(state.ratings[0].rating,4);
 assert.equal(state.levels[0].unlocked,2);
 assert.equal(state.completions[0].topic_id,'food');
 assert.equal(state.other[0].rating,1);
 assert.deepEqual(state.media,['shared-picture-bytes','legacy-picture-bytes','synthetic-audio-bytes']);
 assert.equal(state.app.ownerId,OWNER);
 assert.equal(state.app.pending,1);
 assert(state.app.readyLanguages.includes('my'));
 assert.equal(state.app.appVersion,version);
 return state;
};
async function loadHarness(page){
 const navResponse=await page.goto(origin+'/',{waitUntil:'domcontentloaded'});
 console.log('C3B navigation',JSON.stringify({edition,fromServiceWorker:navResponse?.fromServiceWorker(),status:navResponse?.status(),responseUnified:(await navResponse?.text())?.includes('window.KG_UNIFIED=true')}));
 await page.waitForFunction(()=>window.KGOffline?.ready && window.KG_APP_VERSION,{timeout:deadline});
 await page.evaluate(async({OWNER,OTHER,PICTURE,LEGACY,AUDIO})=>{
  window.__c3bOwner=OWNER;window.__c3bOther=OTHER;
  window.__c3bPicture=PICTURE;window.__c3bLegacy=LEGACY;window.__c3bAudio=AUDIO;
  await window.KGOffline.ready;
  window.__c3bVersion=window.KGOffline.status().appVersion;
 },{OWNER,OTHER,PICTURE,LEGACY,AUDIO});
}
async function seed(page){
 await page.evaluate(async({OWNER,OTHER,MEDIA,PICTURE,LEGACY,AUDIO})=>{
  const db=await new Promise((resolve,reject)=>{
   const r=indexedDB.open('kg-chart-offline-v1',1);
   r.onupgradeneeded=()=>{r.result.createObjectStore('kv');r.result.createObjectStore('outbox',{keyPath:'id'});};
   r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
  });
  await new Promise((resolve,reject)=>{
   const tx=db.transaction(['kv','outbox'],'readwrite'),kv=tx.objectStore('kv');
   const name='kg-offline-pack-'+OWNER+'-my-v2';
   kv.put(OWNER,'active-owner');
   kv.put({id:OWNER,email:'synthetic@example.test',unlocked:true},'enroll:'+OWNER);
   kv.put({id:OTHER,email:'other@example.test',unlocked:true},'enroll:'+OTHER);
   kv.put('synthetic-pack','active:'+OWNER+':my');
   kv.put({ownerId:OWNER,schemaVersion:1,lang:'my',cacheName:name,assets:[],data:{kg_chart_vocabulary:[{id:'synthetic-food'}]}},'pack:synthetic-pack');
   kv.put([name],'active-caches:'+OWNER);
   kv.put([{user_id:OWNER,vocabulary_id:'synthetic-food',rating:4}],'rows:'+OWNER+':kg_chart_user_ratings');
   kv.put([{email:'synthetic@example.test',language_code:'my',level:1,unlocked:2}],'rows:'+OWNER+':kg_chart_user_levels');
   kv.put([{user_id:OWNER,language_code:'my',topic_id:'food'}],'rows:'+OWNER+':kg_chart_topic_completions');
   kv.put([{user_id:OTHER,vocabulary_id:'private',rating:1}],'rows:'+OTHER+':kg_chart_user_ratings');
   tx.objectStore('outbox').put({id:'synthetic-pending',ownerId:OWNER,table:'kg_chart_user_ratings',kind:'upsert',sequence:1,at:'2026-11-22T00:00:00Z',row:{user_id:OWNER,vocabulary_id:'synthetic-food',rating:4}});
   tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);
  });db.close();
  const pack=await window.KGSharedPictures.open('kg-offline-pack-'+OWNER+'-my-v2',OWNER);
  const bytes=new TextEncoder().encode('shared-picture-bytes');
  const sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(x=>x.toString(16).padStart(2,'0')).join('');
  await pack.put(PICTURE,new Response(bytes,{headers:{'Content-Type':'image/jpeg','X-KG-SHA256':sha}}));
  await (await caches.open('kg-offline-pack-'+OWNER+'-my-v2')).put(LEGACY,new Response('legacy-picture-bytes',{headers:{'Content-Type':'image/jpeg'}}));
  await (await caches.open('kg-offline-pack-'+OWNER+'-my-v2')).put(AUDIO,new Response('synthetic-audio-bytes',{headers:{'Content-Type':'audio/mpeg'}}));
 },{OWNER,OTHER,MEDIA,PICTURE,LEGACY,AUDIO});
}
async function installedRevision(page){
 return page.evaluate(async()=>new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('No worker version response')),15000);
  const listen=e=>{if(e.data?.type==='KG_OFFLINE_VERSION'){
   clearTimeout(timer);navigator.serviceWorker.removeEventListener('message',listen);resolve(e.data.revision);
  }};
  navigator.serviceWorker.addEventListener('message',listen);
  navigator.serviceWorker.controller?.postMessage({type:'KG_OFFLINE_GET_VERSION'});
 }));
}
async function updateWorker(page,expected){
 await page.evaluate(async()=>{
  const reg=await navigator.serviceWorker.getRegistration('/');
  await reg.update();
  if(reg.waiting){
   await new Promise((resolve,reject)=>{
    const channel=new MessageChannel(),timer=setTimeout(()=>reject(Error('Apply update timed out')),30000);
    channel.port1.onmessage=e=>{clearTimeout(timer);e.data?.ok?resolve():reject(Error(e.data?.error||'Update rejected'));};
    reg.waiting.postMessage({type:'KG_OFFLINE_APPLY_UPDATE'},[channel.port2]);
   });
  }
 });
 await page.waitForFunction(expected=>navigator.serviceWorker.controller?.scriptURL.endsWith('/sw.js')&&navigator.serviceWorker.controller?.state==='activated',expected,{timeout:deadline});
 await page.waitForFunction(async(expected)=>{
  const reg=await navigator.serviceWorker.getRegistration('/');
  if(reg?.waiting)return false;
  // Ask the controlling worker; the same path is served for all editions.
  return new Promise(resolve=>{
   const listener=e=>{if(e.data?.type==='KG_OFFLINE_VERSION'){navigator.serviceWorker.removeEventListener('message',listener);resolve(e.data.revision===expected);}};
   navigator.serviceWorker.addEventListener('message',listener);
   navigator.serviceWorker.controller?.postMessage({type:'KG_OFFLINE_GET_VERSION'});
   setTimeout(()=>{navigator.serviceWorker.removeEventListener('message',listener);resolve(false);},1500);
  });
 },expected,{timeout:deadline});
}
try{
 browser=await chromium.launchPersistentContext(profile,{headless:true,serviceWorkers:'allow'});
 const page=await browser.newPage();
 await page.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
 await page.goto(origin+'/__c3b__/');
 await page.addScriptTag({url:origin+'/js/offline-pictures.js'});
 await seed(page);
 await page.evaluate(async()=>{
  const reg=await navigator.serviceWorker.register('/sw.js',{scope:'/',updateViaCache:'none'});
  await navigator.serviceWorker.ready;
  // The registration object can lag the ready promise during first activation.
 });
 await page.waitForFunction(()=>navigator.serviceWorker.controller?.state==='activated',null,{timeout:deadline});
 await loadHarness(page);
 const old=await expectState(page,versions.old);
 assert.equal(await installedRevision(page),versions.old,'real old worker active');
 console.log('PASS initial separate worker, IndexedDB/CacheStorage and learning progress');

 // Failed install: manifest says unified version but candidate script advertises a different revision.
 edition='unified';broken=true;
 await page.evaluate(async()=>{const reg=await navigator.serviceWorker.getRegistration('/');try{await reg.update();}catch{}});
 await page.waitForTimeout(1600);
 assert.equal(await installedRevision(page),versions.old,'failed candidate must not replace old worker');
 assert((await page.evaluate(()=>caches.keys())).includes('kg-offline-shell-'+versions.old));
 await expectState(page,versions.old);
 console.log('PASS failed shell install leaves old controlling worker and personal data intact');

 broken=false;await updateWorker(page,versions.unified);
 await loadHarness(page);
 const firstUnified=await page.evaluate(()=>({page:window.KG_APP_VERSION,unified:window.KG_UNIFIED,sw:navigator.serviceWorker.controller?.state}));
 console.log('C3B first unified navigation',JSON.stringify(firstUnified));
 if(firstUnified.page!==versions.unified){
   const staged=await page.evaluate(async version=>{
    const cache=await caches.open('kg-offline-shell-'+version),response=await cache.match(location.origin+'/index.html'),rootResponse=await cache.match(location.origin+'/');
    return {cachePresent:!!response,htmlContainsUnifiedFlag:response? (await response.text()).includes('window.KG_UNIFIED=true'):false,rootContainsUnifiedFlag:rootResponse?(await rootResponse.text()).includes('window.KG_UNIFIED=true'):false,cacheKeys:(await caches.keys()).filter(k=>k.startsWith('kg-offline-shell-')),cachedUrls:(await cache.keys()).filter(x=>x.url.endsWith('/index.html')||x.url.endsWith('/')).map(x=>x.url)};
   },versions.unified);
   console.log('C3B new shell cache diagnostic',JSON.stringify(staged));
   await loadHarness(page); // A browser navigation may race a just-claimed controller; require second to settle.
 }
 const unified=await expectState(page,versions.unified);
 assert.equal(await installedRevision(page),versions.unified);
 assert(unified.cachesBefore.includes('kg-offline-shell-'+versions.old),'previous shell preserved');
 console.log('PASS actual Chromium separate → unified worker activation, data unchanged');

 edition='old';await updateWorker(page,versions.old);
 await loadHarness(page);
 if((await page.evaluate(()=>window.KG_APP_VERSION))!==versions.old)await loadHarness(page);
 const rollback=await expectState(page,versions.old);
 assert.equal(await installedRevision(page),versions.old);
 assert(rollback.cachesBefore.includes('kg-offline-shell-'+versions.unified),'unified shell preserved on rollback');
 assert(rollback.cachesBefore.includes('kg-offline-pictures-v1-'+OWNER));
 console.log('PASS compatible old-worker rollback with preserved shared picture bytes and outbox');
 console.log('C3B real-browser PASS: no cloud origin, remote identity, or production storage used');
}finally{
 await browser?.close();
 await new Promise(resolve=>server.close(resolve));
 await rm(profile,{recursive:true,force:true});
}
