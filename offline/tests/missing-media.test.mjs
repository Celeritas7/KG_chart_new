import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {IDBFactory} from 'fake-indexeddb';

const source=(await fs.readFile(new URL('../pictures.js',import.meta.url),'utf8'))+'\n'+(await fs.readFile(new URL('../runtime.js',import.meta.url),'utf8'));
const OWNER='88888888-8888-4888-8888-888888888888';
const ROOT='https://example.supabase.co/storage/v1/object/public/vocabulary-assets/';
const content={
  kg_chart_languages:[{code:'my',name_english:'Burmese',is_active:true}],
  kg_chart_topics:[{id:'body'}],
  kg_chart_topic_translations:[{topic_id:'body',language_code:'my',title_native:'Body'}],
  kg_chart_vocabulary:[
    {id:'claw',topic_id:'body',image_filename:'claw.jpg'},
    {id:'paw',topic_id:'body',image_filename:'paw.jpg'},
  ],
  kg_chart_vocabulary_translations:[
    {vocabulary_id:'claw',language_code:'my',native_text:'claw'},
    {vocabulary_id:'paw',language_code:'my',native_text:'paw'},
  ],
  kg_chart_sentences:[],kg_chart_colour_phrases:[],kg_chart_settings:[],
};

class Query {
  constructor(rows){this.rows=rows;this.first=0;this.last=Infinity;}
  select(){return this;}
  eq(k,v){this.rows=this.rows.filter(r=>r[k]===v);return this;}
  in(k,values){this.rows=this.rows.filter(r=>values.includes(r[k]));return this;}
  order(k){this.rows.sort((a,b)=>String(a[k]??'').localeCompare(String(b[k]??'')));return this;}
  range(a,b){this.first=a;this.last=b;return this;}
  then(resolve,reject){return Promise.resolve({data:this.rows.slice(this.first,this.last+1),error:null}).then(resolve,reject);}
}

async function fixture({imageMode='missing',audioMissing=false,failPawOnce=false,shared=null}={}) {
  // Reuse a browser's CacheStorage and IndexedDB after a simulated tab close.
  const indexedDB=shared?.indexedDB||new IDBFactory();
  const caches=shared?.caches||new Map();
  class Cache {
    items=new Map();
    async put(url,response){this.items.set(String(url),response.clone());}
    async match(url){return this.items.get(String(url))?.clone();}
  }
  const cacheStorage={
    open:async name=>{if(!caches.has(name))caches.set(name,new Cache());return caches.get(name);},
    delete:async name=>caches.delete(name),
  };
  const nav={onLine:true,storage:{persist:async()=>true},
    serviceWorker:{controller:{postMessage(message,ports){messages.push(message);if(message.type==='KG_OFFLINE_AUDIT_SHELL')ports[0].postMessage({ok:true,revision:'test'});if(message.type==='KG_OFFLINE_CHECK_SHELL')queueMicrotask(()=>nav.serviceWorker.onMessage?.({data:{type:'KG_OFFLINE_SHELL_READY',sharedPictures:1}}));}},addEventListener(type,handler){if(type==='message')this.onMessage=handler;}},
    connection:{addEventListener(){}}};
  const messages=[];
  const calls={claw:0,paw:0,audio:0};
  const state={imageMode,audioMissing,failPawOnce};
  const fetch=async (input,options={})=>{
    const url=new URL(String(input),'https://kg-offline.example/');
    if(url.pathname.endsWith('/offline-build.json'))return new Response('{}');
    if(url.pathname.endsWith('/clips.json')) {
      if(!state.audioMissing)return new Response('Not found',{status:404});
      return new Response(JSON.stringify({m:['00000000'],f:[]}),{headers:{'Content-Type':'application/json'}});
    }
    if(options.method==='HEAD')return new Response(null,{status:200,headers:{etag:'"revision-1"','content-length':'5'}});
    if(url.pathname.endsWith('/claw.jpg')){
      calls.claw++;
      if(state.imageMode==='network')throw Error('Simulated network failure');
      if(state.imageMode==='forbidden')return new Response('Forbidden',{status:403});
      if(state.imageMode==='bad-request')return new Response(JSON.stringify({statusCode:'400',error:'BadRequest',message:'Invalid image request'}),
        {status:400,headers:{'Content-Type':'application/json'}});
      if(state.imageMode==='missing')return new Response(JSON.stringify({statusCode:'404',error:'not_found',message:'The resource was not found'}),
        {status:400,headers:{'Content-Type':'application/json'}});
      if(state.imageMode==='missing-404')return new Response(JSON.stringify({statusCode:'404',error:'not_found',message:'Object not found'}),
        {status:404,headers:{'Content-Type':'application/json'}});
    }
    if(url.pathname.endsWith('/paw.jpg')){
      calls.paw++;
      if(state.failPawOnce){state.failPawOnce=false;throw Error('Simulated interrupted download');}
    }
    if(url.pathname.endsWith('.mp3')) {
      calls.audio++;
      return new Response(JSON.stringify({statusCode:'404',error:'not_found',message:'The resource was not found'}),
        {status:400,headers:{'Content-Type':'application/json'}});
    }
    return new Response(new Uint8Array([1,2,3,4,5]),{headers:{'Content-Type':'image/jpeg'}});
  };
  const client={
    auth:{getUser:async()=>({data:{user:{id:OWNER,email:'student@example.org'}},error:null})},
    rpc:async name=>name==='kg_chart_my_private_lesson_visibility'
      ? {data:{contract:1,topics:[],groups:[]},error:null}
      : {data:name==='kg_chart_is_admin'?false:true,error:null},
    from:table=>new Query([...(content[table]||[])]),
    storage:{from:()=>({getPublicUrl:name=>({data:{publicUrl:ROOT+name}})})},
  };
  const context={window:{},indexedDB,caches:cacheStorage,fetch,
    navigator:nav,location:{href:'https://kg-offline.example/'},addEventListener(){},
    document:{getElementById:()=>null,addEventListener(){},hidden:false},
    BroadcastChannel:class{addEventListener(){}postMessage(){}},
    URL,Response,Headers,TextEncoder,Blob,AbortController,MessageChannel,crypto:webcrypto,
    setTimeout:(fn,ms)=>{const timer=setTimeout(fn,ms);timer.unref?.();return timer;},clearTimeout,console};
  vm.runInNewContext(source,context,{filename:'offline/runtime.js'});
  await context.window.KGOffline.ready;
  context.window.KGOffline.wrapClient(client);
  await context.window.KGOffline.afterVerified({id:OWNER,email:'student@example.org'});
  async function activePack(){
    const db=await new Promise((resolve,reject)=>{const req=indexedDB.open('kg-chart-offline-v1',1);
      req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
    const get=key=>new Promise((resolve,reject)=>{const req=db.transaction('kv').objectStore('kv').get(key);
      req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
    const pointer=await get(`active:${OWNER}:my`);
    const pack=pointer?await get(`pack:${pointer}`):null;
    db.close();return pack;
  }
  return {api:context.window.KGOffline,state,calls,messages,caches,activePack,nav,shared:{indexedDB,caches}};
}

test('confirmed HTTP 400 missing picture becomes a hashed, account-scoped offline placeholder',async()=>{
  const x=await fixture();
  await x.api.downloadPack('my');
  const pack=await x.activePack();
  assert(pack,'A complete pack is activated');
  const missing=pack.assets.find(a=>a.url.endsWith('/claw.jpg'));
  assert.equal(missing.missingImage,true);
  assert.equal(pack.assets.find(a=>a.url.endsWith('/paw.jpg')).missingImage,false);
  assert.match(missing.sha256,/^[a-f0-9]{64}$/);
  assert.equal(x.api.status().progress.failures,0);
  assert.equal(x.api.status().progress.missingImages,1);
  const placeholder=await x.api.readMedia(missing.url);
  assert.equal(placeholder.headers.get('X-KG-Missing-Image'),'1');
  assert.equal(placeholder.headers.get('Content-Type'),'image/svg+xml');
  assert.match(await placeholder.text(),/Image unavailable/);
  assert(x.messages.some(m=>m.type==='KG_OFFLINE_OWNER' && m.mediaRoot===ROOT),'Worker gets Storage origin from the configured SDK');
});

test('interrupted download reuses verified files; later refresh replaces a restored missing picture',async()=>{
  const x=await fixture({imageMode:'missing-404',failPawOnce:true});
  await assert.rejects(x.api.downloadPack('my'),/interrupted download/i);
  assert.equal(await x.activePack(),null,'Failed staging cannot activate a partial pack');
  await x.api.downloadPack('my');
  assert.equal(x.calls.claw,1,'Staged placeholder reused after interruption');
  assert.equal(x.calls.paw,2,'Only interrupted image retried');
  const first=await x.activePack();
  assert.equal(first.assets.find(a=>a.url.endsWith('/claw.jpg')).missingImage,true);
  x.state.imageMode='restored';
  await x.api.downloadPack('my',{refresh:true});
  const refreshed=await x.activePack();
  assert.notEqual(refreshed.manifestRevision,first.manifestRevision,
    `Restored image updates the content-addressed revision (${JSON.stringify({calls:x.calls,first:first.assets,refreshed:refreshed.assets})})`);
  assert.equal(refreshed.assets.find(a=>a.url.endsWith('/claw.jpg')).missingImage,false);
  assert(x.caches.has(first.cacheName),'Previous valid pack remains available for rollback');
});

test('closing and reopening the app during a download preserves staging and allows a clean resume',async()=>{
  const first=await fixture({imageMode:'missing-404',failPawOnce:true});
  await assert.rejects(first.api.downloadPack('my'),/interrupted download/i);
  const staged=[...first.caches.keys()].filter(name=>name.startsWith('kg-offline-pack-'));
  assert.equal(staged.length,1,'Interrupted media stays in a staging cache');
  assert.equal(await first.activePack(),null,'Partial download is never an active pack');

  // Starting an entirely new page runtime with the same browser storage must
  // not inspect or erase staged media as part of its startup path.
  const reopened=await fixture({imageMode:'missing-404',shared:first.shared});
  assert.equal(reopened.api.status().readyLanguages.length,0);
  assert(reopened.caches.has(staged[0]),'App restart does not delete partially saved media');
  await reopened.api.downloadPack('my');
  assert.equal(reopened.calls.claw,0,'Already downloaded picture was reused after a real restart');
  assert.equal(reopened.calls.paw,1,'Only the missing picture was fetched');
  assert(await reopened.activePack(),'Complete pack activates after interrupted-download recovery');
});

test('authentication, malformed HTTP 400 and network errors cannot turn into image placeholders',async()=>{
  for(const imageMode of ['forbidden','bad-request','network']) {
    const x=await fixture({imageMode});
    await assert.rejects(x.api.downloadPack('my'),/HTTP 403|HTTP 400|network failure/i);
    assert.equal(await x.activePack(),null,`${imageMode} must not activate an incomplete pack`);
    assert.equal(x.api.status().progress.missingImages,0);
    assert.equal(x.api.status().progress.failures,1);
  }
});

test('missing audio recording remains a blocking error, never a placeholder',async()=>{
  const x=await fixture({audioMissing:true});
  await assert.rejects(x.api.downloadPack('my'),/Asset HTTP 400/i);
  assert.equal(await x.activePack(),null);
  assert(x.calls.audio>0);
  assert.equal(x.api.status().progress.missingImages,1,'Only genuinely missing picture is counted');
  assert.equal(x.api.status().progress.failures,1);
});

test('unchanged published revisions are reused during refresh without downloading completed images',async()=>{
  const x=await fixture({imageMode:'restored'});await x.api.downloadPack('my');
  const before={...x.calls};await x.api.downloadPack('my',{refresh:true});
  assert.equal(x.calls.claw,before.claw);assert.equal(x.calls.paw,before.paw);
  const pack=await x.activePack();const raw=await x.caches.get(pack.cacheName).match(ROOT+'body/claw.jpg');
  assert(raw.headers.get('X-KG-Picture-Hash'));assert.equal((await raw.blob()).size,0);
  assert.equal((await (await x.api.readMedia(ROOT+'body/claw.jpg')).blob()).size,5);
});


test('readiness audits saved bytes without deleting packs or exposing account identifiers',async()=>{
  const x=await fixture();
  await x.api.downloadPack('my');
  x.nav.onLine=false;
  await new Promise(resolve=>setTimeout(resolve,20));
  const report=await x.api.verifyOffline();
  assert.equal(report.ready,true);
  assert.equal(report.packs[0].missingPictures,1);
  assert(!JSON.stringify(report).includes(OWNER));
  assert(!JSON.stringify(report).includes('student@example.org'));
  const original=await x.activePack();
  const shared=[...x.caches.entries()].find(([name])=>name.startsWith('kg-offline-pictures-v1-'))[1];
  shared.items.clear();
  const damaged=await x.api.verifyOffline();
  assert.equal(damaged.ready,false);
  assert(damaged.packs[0].failures.length>0);
  assert.equal((await x.activePack()).cacheName,original.cacheName);
});
