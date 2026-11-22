import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {createHash,webcrypto} from 'node:crypto';
import {IDBFactory} from 'fake-indexeddb';

// Disposable in-memory origin only. Never connect to Cloudflare, Supabase or a real browser profile.
const source=(await fs.readFile(new URL('../pictures.js',import.meta.url),'utf8'))+'\n'+(await fs.readFile(new URL('../runtime.js',import.meta.url),'utf8'));
const OWNER='88888888-8888-4888-8888-888888888888';
const OTHER='99999999-9999-4999-8999-999999999999';
const MEDIA='https://example.supabase.co/storage/v1/object/public/vocabulary-assets/';
const PIC=MEDIA+'pictures/food.jpg';
const LEGACY=MEDIA+'pictures/vegetables.jpg';
const AUDIO=MEDIA+'audio/my/clip.mp3';
const hash=value=>createHash('sha256').update(value).digest('hex');
const image=value=>new Response(value,{headers:{'Content-Type':'image/jpeg','X-KG-SHA256':hash(value),'X-KG-Bytes':String(value.length)}});
const record=(owner,lang,cacheName)=>({ownerId:owner,lang,schemaVersion:1,cacheName,assets:[],
 data:{kg_chart_vocabulary:[{id:'saved-'+lang,topic_id:'food'}],kg_chart_languages:[{code:lang,name_english:lang}]}});
const event={id:'queued-rating',ownerId:OWNER,sequence:1,at:'2026-11-22T00:00:00Z',state:'pending',
 table:'kg_chart_user_ratings',kind:'upsert',filters:[],row:{user_id:OWNER,vocabulary_id:'saved-my',language_code:'my',rating:4}};
function origin(){
 const idb=new IDBFactory(),stores=new Map(),deleted=[];
 const caches={
  open:async name=>{if(!stores.has(name)){
   const rows=new Map();stores.set(name,{rows,
    put:async(k,v)=>{rows.set(String(k),v.clone());},
    match:async k=>rows.get(String(k))?.clone()});
  }return stores.get(name);},
  keys:async()=>[...stores.keys()],
  delete:async name=>{deleted.push(name);return stores.delete(name);}
 };
 const database=()=>new Promise((resolve,reject)=>{const req=idb.open('kg-chart-offline-v1',1);
  req.onupgradeneeded=()=>{req.result.createObjectStore('kv');req.result.createObjectStore('outbox',{keyPath:'id'});};
  req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
 });
 async function inspect(store,key){const db=await database();try{return await new Promise((resolve,reject)=>{
  const req=db.transaction(store).objectStore(store).get(key);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
 });}finally{db.close();}}
 async function seed(){
  const db=await database();await new Promise((resolve,reject)=>{
   const tx=db.transaction(['kv','outbox'],'readwrite'),kv=tx.objectStore('kv');
   const c1='kg-offline-pack-'+OWNER+'-my-v2',c2='kg-offline-pack-'+OWNER+'-zh-v2';
   kv.put(OWNER,'active-owner');
   kv.put({id:OWNER,email:'synthetic@example.test',unlocked:true},'enroll:'+OWNER);
   kv.put('pack-my','active:'+OWNER+':my');kv.put(record(OWNER,'my',c1),'pack:pack-my');
   kv.put('pack-zh','active:'+OWNER+':zh');kv.put(record(OWNER,'zh',c2),'pack:pack-zh');
   kv.put([c1,c2],'active-caches:'+OWNER);
   kv.put([{user_id:OWNER,vocabulary_id:'saved-my',language_code:'my',rating:4}], 'rows:'+OWNER+':kg_chart_user_ratings');
   kv.put([{user_id:OWNER,language_code:'my',topic_id:'food',completed_at:'2026-11-22T00:00:00Z'}], 'rows:'+OWNER+':kg_chart_topic_completions');
   kv.put([{email:'synthetic@example.test',language_code:'my',level:1,unlocked:2}], 'rows:'+OWNER+':kg_chart_user_levels');
   kv.put({id:OTHER,email:'other@example.test',unlocked:true},'enroll:'+OTHER);
   kv.put([{user_id:OTHER,vocabulary_id:'private',language_code:'my',rating:1}], 'rows:'+OTHER+':kg_chart_user_ratings');
   tx.objectStore('outbox').put(event);
   tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);
  });db.close();
  // New format: content-addressed shared image referenced by a pack; old format: full image bytes.
  const context={window:{},caches,crypto:webcrypto,Response,Headers,Uint8Array};
  vm.runInNewContext((await fs.readFile(new URL('../pictures.js',import.meta.url),'utf8')),context);
  const pic=await context.window.KGSharedPictures.open('kg-offline-pack-'+OWNER+'-my-v2',OWNER);
  await pic.put(PIC,image('shared-picture-bytes'));
  await (await caches.open('kg-offline-pack-'+OWNER+'-my-v2')).put(LEGACY,image('legacy-picture-bytes'));
  await (await caches.open('kg-offline-pack-'+OWNER+'-my-v2')).put(AUDIO,new Response('audio-bytes',{headers:{'Content-Type':'audio/mpeg'}}));
  await caches.open('kg-offline-shell-compatible-old');
  return {c1:'kg-offline-pack-'+OWNER+'-my-v2',c2:'kg-offline-pack-'+OWNER+'-zh-v2'};
 }
 async function boot(unified,version){
  const nav={onLine:false,serviceWorker:{controller:{postMessage(){}},addEventListener(){}},connection:{addEventListener(){}}};
  const context={window:{KG_UNIFIED:unified,KG_APP_VERSION:version},navigator:nav,indexedDB:idb,caches,
   location:{href:'https://disposable.test/',hash:''},document:{getElementById:()=>null,addEventListener(){},hidden:false},
   URL,Response,Headers,TextEncoder,Blob,AbortController,crypto:webcrypto,console,
   setTimeout:(fn,ms)=>{const t=setTimeout(fn,ms);t.unref?.();return t;},clearTimeout,
   addEventListener(){},fetch:async()=>({ok:false})};
  vm.runInNewContext(source,context,{filename:'C3 synthetic runtime'});
  const api=context.window.KGOffline;await api.ready;
  const remote={select(){return this;},eq(){return this;},then(resolve){return Promise.resolve({data:[],error:null}).then(resolve);}};
  const client=api.wrapClient({auth:{getSession:async()=>({data:{session:null},error:null}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},
   storage:{from:()=>({getPublicUrl:key=>({data:{publicUrl:MEDIA+key}})})},from:()=>remote});
  return {api,client,nav,context};
 }
 return {idb,caches,stores,deleted,seed,boot,inspect};
}
async function assertSaved(o,app){
 const status=app.api.status();
 assert.equal(status.ownerId,OWNER);
 assert.deepEqual([...status.readyLanguages].sort(),['my','zh']);
 assert.equal(status.pending,1,'pending record cannot be acknowledged merely by opening another edition');
 assert.equal((await o.inspect('outbox',event.id)).id,event.id);
 assert.equal((await o.inspect('kv','active:'+OWNER+':my')),'pack-my');
 const vocab=await app.client.from('kg_chart_vocabulary').select('*');
 assert.equal(vocab.data[0].id,'saved-my');
 const ratings=await app.client.from('kg_chart_user_ratings').select('*');
 assert.equal(ratings.data[0].rating,4);
 const levels=await app.client.from('kg_chart_user_levels').select('*');
 assert.equal(levels.data[0].unlocked,2);
 const completions=await app.client.from('kg_chart_topic_completions').select('*');
 assert.equal(completions.data[0].topic_id,'food');
 assert.equal(ratings.data.some(row=>row.user_id===OTHER),false);
}
test('same-origin separate → unified → compatible separate preserves owner, two packs, progress and queued writes',async()=>{
 const o=origin();const {c1}=await o.seed();
 const initial=await o.boot(false,'safe-old');
 await assertSaved(o,initial);
 await o.caches.open('kg-offline-shell-unified-candidate');
 const upgraded=await o.boot(true,'safe-new-unified');
 await assertSaved(o,upgraded);
 assert.equal(upgraded.api.status().appVersion,'safe-new-unified');
 const pic=await upgraded.context.window.KGSharedPictures.open(c1,OWNER);
 assert.equal(await (await pic.match(PIC)).text(),'shared-picture-bytes');
 assert.equal(await (await pic.match(LEGACY)).text(),'legacy-picture-bytes');
 assert.equal(await (await pic.match(AUDIO)).text(),'audio-bytes');
 const rollback=await o.boot(false,'safe-rollback');
 await assertSaved(o,rollback);
 const oldPicture=await rollback.context.window.KGSharedPictures.open(c1,OWNER);
 assert.equal(await (await oldPicture.match(PIC)).text(),'shared-picture-bytes','rollback must understand shared references');
 assert.equal(o.deleted.length,0);
 assert((await o.caches.keys()).includes('kg-offline-shell-compatible-old'));
 assert((await o.caches.keys()).includes('kg-offline-shell-unified-candidate'));
 assert((await o.caches.keys()).includes('kg-offline-pictures-v1-'+OWNER));
});
test('incomplete upgrade leaves original shell and all owner data untouched; another owner cannot read saved pack',async()=>{
 const o=origin();const {c1}=await o.seed();
 const before=await o.boot(false,'safe-old');await assertSaved(o,before);
 const staged=await o.caches.open('kg-offline-shell-incomplete-candidate');
 await staged.put('/index.html',new Response('incomplete')); // simulated interrupted shell, never activated
 const resumed=await o.boot(false,'safe-old');
 await assertSaved(o,resumed);
 const pictures=await resumed.context.window.KGSharedPictures.open(c1,OWNER);
 assert.equal(await (await pictures.match(PIC)).text(),'shared-picture-bytes');
 await assert.rejects(resumed.context.window.KGSharedPictures.open(c1,OTHER),/account mismatch/);
 assert.equal((await o.inspect('kv','rows:'+OTHER+':kg_chart_user_ratings'))[0].rating,1);
 assert.equal(o.deleted.length,0,'rehearsal must never call cache deletion');
});
