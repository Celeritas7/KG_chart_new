// Real Chromium, one disposable localhost origin and profile. No public network or production accounts.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,extname} from 'node:path';
import {chromium} from 'playwright';

const OWNER='88888888-8888-4888-8888-888888888888';
const OTHER='99999999-9999-4999-8999-999999999999';
// The app bundle's public-media hostname is only a URL string in this test:
 // Docker's --network none prevents requests to it from leaving the container.
const sourceHtml=await readFile('index.html','utf8');
const publicOrigin=sourceHtml.match(/\bSUPABASE_URL\s*=\s*['"](https:\/\/[a-z0-9-]+\.supabase\.co)['"]/);
assert(publicOrigin,'Published public-media URL not found in canonical learner source');
const MEDIA=publicOrigin[1]+'/storage/v1/object/public/vocabulary-assets/';
const PICTURE=MEDIA+'pictures/synthetic-food.jpg';
const LEGACY=MEDIA+'pictures/legacy-vegetables.jpg';
const AUDIO=MEDIA+'audio/my/synthetic.mp3';
const ZH_PICTURE=MEDIA+'pictures/synthetic-zh.jpg';
const ZH_AUDIO=MEDIA+'audio/zh/synthetic.mp3';
const MY_CATALOG=MEDIA+'audio/my/clips.json';
const ZH_CATALOG=MEDIA+'audio/zh/clips.json';
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
 await page.evaluate(async({OWNER,OTHER,MEDIA,PICTURE,LEGACY,AUDIO,ZH_PICTURE,ZH_AUDIO,MY_CATALOG,ZH_CATALOG})=>{
  const encoder=new TextEncoder();
  const hash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)))
   .map(x=>x.toString(16).padStart(2,'0')).join('');
  const samples=[
   {url:PICTURE,body:'shared-picture-bytes',mime:'image/jpeg'},
   {url:LEGACY,body:'legacy-picture-bytes',mime:'image/jpeg'},
   {url:AUDIO,body:'synthetic-audio-bytes',mime:'audio/mpeg'},
   {url:MY_CATALOG,body:JSON.stringify({m:[],f:[]}),mime:'application/json'},
   {url:ZH_PICTURE,body:'zh-picture-bytes',mime:'image/jpeg'},
   {url:ZH_AUDIO,body:'zh-audio-bytes',mime:'audio/mpeg'},
   {url:ZH_CATALOG,body:JSON.stringify({m:[],f:[]}),mime:'application/json'}
  ];
  const files=new Map();
  for(const file of samples){
   const bytes=encoder.encode(file.body);
   files.set(file.url,{...file,bytes,sha256:await hash(bytes)});
  }
  const assets=urls=>urls.map(url=>{
   const f=files.get(url);
   return {url,sha256:f.sha256,bytes:f.bytes.length,missingImage:false};
  });
  const myCache='kg-offline-pack-'+OWNER+'-my-v2';
  const zhCache='kg-offline-pack-'+OWNER+'-zh-v2';
  const db=await new Promise((resolve,reject)=>{
   const r=indexedDB.open('kg-chart-offline-v1',1);
   r.onupgradeneeded=()=>{r.result.createObjectStore('kv');r.result.createObjectStore('outbox',{keyPath:'id'});};
   r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
  });
  await new Promise((resolve,reject)=>{
   const tx=db.transaction(['kv','outbox'],'readwrite'),kv=tx.objectStore('kv');
   kv.put(OWNER,'active-owner');
   kv.put({id:OWNER,email:'synthetic@example.test',unlocked:true},'enroll:'+OWNER);
   kv.put({id:OTHER,email:'other@example.test',unlocked:true},'enroll:'+OTHER);
   kv.put('synthetic-my','active:'+OWNER+':my');
   kv.put('synthetic-zh','active:'+OWNER+':zh');
   kv.put({ownerId:OWNER,schemaVersion:1,lang:'my',cacheName:myCache,
    assets:assets([PICTURE,LEGACY,AUDIO,MY_CATALOG]),
    data:{kg_chart_vocabulary:[{id:'synthetic-food',topic_id:'food'}],kg_chart_languages:[{code:'my'}]}},'pack:synthetic-my');
   kv.put({ownerId:OWNER,schemaVersion:1,lang:'zh',cacheName:zhCache,
    assets:assets([ZH_PICTURE,ZH_AUDIO,ZH_CATALOG]),
    data:{kg_chart_vocabulary:[{id:'synthetic-zh',topic_id:'vegetables'}],kg_chart_languages:[{code:'zh'}]}},'pack:synthetic-zh');
   kv.put([myCache,zhCache],'active-caches:'+OWNER);
   kv.put([{user_id:OWNER,vocabulary_id:'synthetic-food',rating:4}],'rows:'+OWNER+':kg_chart_user_ratings');
   kv.put([{email:'synthetic@example.test',language_code:'my',level:1,unlocked:2}],'rows:'+OWNER+':kg_chart_user_levels');
   kv.put([{user_id:OWNER,language_code:'my',topic_id:'food'}],'rows:'+OWNER+':kg_chart_topic_completions');
   kv.put([{user_id:OTHER,vocabulary_id:'private',rating:1}],'rows:'+OTHER+':kg_chart_user_ratings');
   tx.objectStore('outbox').put({id:'synthetic-pending',ownerId:OWNER,table:'kg_chart_user_ratings',kind:'upsert',sequence:1,at:'2026-11-22T00:00:00Z',row:{user_id:OWNER,vocabulary_id:'synthetic-food',rating:4}});
   tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);
  });db.close();
  const my=await window.KGSharedPictures.open(myCache,OWNER);
  const zh=await window.KGSharedPictures.open(zhCache,OWNER);
  const payload=url=>{
   const f=files.get(url);
   return new Response(f.bytes,{headers:{'Content-Type':f.mime,'X-KG-SHA256':f.sha256,'X-KG-Bytes':String(f.bytes.length)}});
  };
  await my.put(PICTURE,payload(PICTURE));
  await (await caches.open(myCache)).put(LEGACY,payload(LEGACY)); // Original inline image, not hash pointer
  await my.put(AUDIO,payload(AUDIO));
  await my.put(MY_CATALOG,payload(MY_CATALOG));
  await zh.put(ZH_PICTURE,payload(ZH_PICTURE));
  await zh.put(ZH_AUDIO,payload(ZH_AUDIO));
  await zh.put(ZH_CATALOG,payload(ZH_CATALOG));
 },{OWNER,OTHER,MEDIA,PICTURE,LEGACY,AUDIO,ZH_PICTURE,ZH_AUDIO,MY_CATALOG,ZH_CATALOG});
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
 // Some installations auto-activate once via the legacy rescue marker.
 // Otherwise the fully installed worker must be explicitly approved.
 await page.evaluate(async()=>{const reg=await navigator.serviceWorker.getRegistration('/');await reg.update();});
 const disposition=await page.evaluate(async expected=>{
  const checkActive=async()=>{
   const reg=await navigator.serviceWorker.getRegistration('/');
   if(!reg?.active || navigator.serviceWorker.controller!==reg.active)return false;
   return new Promise(resolve=>{
    const timer=setTimeout(()=>{navigator.serviceWorker.removeEventListener('message',listener);resolve(false);},500);
    const listener=e=>{
     if(e.data?.type!=='KG_OFFLINE_VERSION'||e.source!==reg.active)return;
     clearTimeout(timer);navigator.serviceWorker.removeEventListener('message',listener);
     resolve(e.data.revision===expected);
    };
    navigator.serviceWorker.addEventListener('message',listener);
    reg.active.postMessage({type:'KG_OFFLINE_GET_VERSION'});
   });
  };
  const until=Date.now()+45000;
  while(Date.now()<until){
   const reg=await navigator.serviceWorker.getRegistration('/');
   if(reg?.waiting?.state==='installed')return 'waiting';
   if(await checkActive())return 'auto-activated';
   await new Promise(resolve=>setTimeout(resolve,120));
  }
  throw Error('Expected worker never installed or auto-activated');
 },expected);
 console.log('C3B update path',JSON.stringify({expected,disposition}));
 if(disposition==='waiting'){
  await page.evaluate(async()=>{
   const reg=await navigator.serviceWorker.getRegistration('/');
   if(!reg?.waiting)return; // Legacy auto-activation can win the race; verify exact revision below.
   await new Promise((resolve,reject)=>{
    const channel=new MessageChannel();
    const timer=setTimeout(()=>reject(Error('Apply update timed out')),30000);
    channel.port1.onmessage=e=>{
     clearTimeout(timer);
     e.data?.ok?resolve():reject(Error(e.data?.error||'Update rejected'));
    };
    reg.waiting.postMessage({type:'KG_OFFLINE_APPLY_UPDATE'},[channel.port2]);
   });
  });
 }
 await page.waitForFunction(async expected=>{
  const reg=await navigator.serviceWorker.getRegistration('/');
  if(reg?.waiting || !reg?.active || navigator.serviceWorker.controller!==reg.active)return false;
  return new Promise(resolve=>{
   const timer=setTimeout(()=>{navigator.serviceWorker.removeEventListener('message',listen);resolve(false);},900);
   const listen=e=>{
    if(e.data?.type!=='KG_OFFLINE_VERSION'||e.source!==navigator.serviceWorker.controller)return;
    clearTimeout(timer);navigator.serviceWorker.removeEventListener('message',listen);
    resolve(e.data.revision===expected);
   };
   navigator.serviceWorker.addEventListener('message',listen);
   navigator.serviceWorker.controller?.postMessage({type:'KG_OFFLINE_GET_VERSION'});
  });
 },expected,{timeout:deadline});
 assert.equal(await installedRevision(page),expected);
}

try{
 browser=await chromium.launchPersistentContext(profile,{headless:true,serviceWorkers:'allow'});
 let page=await browser.newPage();
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
 // A newly opened Home Screen app is a new controlled client, not the old document.
 await page.close();
 page=await browser.newPage();
 await page.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
 await loadHarness(page);
 const firstUnified=await page.evaluate(()=>({page:window.KG_APP_VERSION,unified:window.KG_UNIFIED,sw:navigator.serviceWorker.controller?.state}));
 console.log('C3B first unified navigation',JSON.stringify({...firstUnified,workerRevision:await installedRevision(page)}));
 console.log('C3B registration after upgrade',JSON.stringify(await page.evaluate(async()=>{
  const reg=await navigator.serviceWorker.getRegistration('/');
  return {scope:reg?.scope,active:reg?.active?.state,waiting:reg?.waiting?.state,controllerState:navigator.serviceWorker.controller?.state,controllerSameAsActive:reg?.active===navigator.serviceWorker.controller};
 })));
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
 await page.close();
 page=await browser.newPage();
 await page.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
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
