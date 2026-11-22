import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';

const USER='44444444-4444-4444-8444-444444444444';
const OTHER='55555555-5555-4555-8555-555555555555';
const EMAIL='learner@example.test';
const runtime=await fs.readFile(new URL('../runtime.js', import.meta.url),'utf8');

async function boot({enrolled=true}={}) {
  // Every test has its own isolated IndexedDB; no production account or network access.
  const idb=new IDBFactory();
  const db=await new Promise((resolve,reject)=>{
    const req=idb.open('kg-chart-offline-v1',1);
    req.onupgradeneeded=()=>{
      req.result.createObjectStore('kv');
      req.result.createObjectStore('outbox',{keyPath:'id'});
    };
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
  });
  if(enrolled) await new Promise((resolve,reject)=>{
    const tx=db.transaction(['kv','outbox'],'readwrite');
    const kv=tx.objectStore('kv');
    kv.put(USER,'active-owner');
    kv.put({id:USER,email:EMAIL,unlocked:true,admin:false,verifiedAt:'2026-11-18T00:00:00Z'},'enroll:'+USER);
    tx.objectStore('outbox').put({id:'preserved-event',ownerId:USER,table:'kg_chart_user_ratings',
      kind:'upsert',sequence:1,at:'2026-11-18T00:00:00Z',row:{user_id:USER,vocabulary_id:'saved-word',rating:4}});
    tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);
  });
  db.close();

  const nav={onLine:false,serviceWorker:{controller:{postMessage(){}},addEventListener(){}},
    connection:{addEventListener(){}}};
  let authCallback=()=>{};
  let realSessionReads=0;
  let signOutCalls=0;
  const live={
    auth:{
      getSession:async()=>{realSessionReads++;return {data:{session:null},error:null};},
      getUser:async()=>({data:{user:{id:USER,email:EMAIL}},error:null}),
      onAuthStateChange:callback=>{
        authCallback=callback;
        return {data:{subscription:{unsubscribe(){authCallback=()=>{};}}}};
      },
      signOut:async()=>{
        signOutCalls++;
        authCallback('SIGNED_OUT',null);
        return {error:null};
      },
    },
    storage:{from:()=>({getPublicUrl:file=>({data:{publicUrl:
      'https://example.supabase.co/storage/v1/object/public/vocabulary-assets/'+file}})})},
    rpc:async()=>({data:true,error:null}),
    from:()=>{throw Error('Offline auth startup must not call the network');},
    functions:{invoke:async()=>({error:{message:'offline'}})},
  };
  const context={window:{},navigator:nav,indexedDB:idb,location:{href:'https://kg.example/',hash:''},
    document:{getElementById:()=>null,addEventListener(){},hidden:false},
    addEventListener(){},BroadcastChannel:class{addEventListener(){}postMessage(){}},
    URL,Response,Headers,TextEncoder,Blob,AbortController,crypto:webcrypto,console,
    fetch:async()=>({ok:false}), // The local version probe has no cached response.
    setTimeout:(fn,ms)=>{const timer=setTimeout(fn,ms);timer.unref?.();return timer;},
    clearTimeout};
  vm.runInNewContext(runtime,context,{filename:'offline/runtime.js'});
  await context.window.KGOffline.ready;
  const client=context.window.KGOffline.wrapClient(live);
  const events=[];
  let wake=null;
  client.auth.onAuthStateChange((event,session)=>{
    events.push({event,userId:session?.user?.id||null});
    if(wake){wake();wake=null;}
  });
  const read=async(store,key)=>{
    const db=await new Promise((resolve,reject)=>{
      const req=idb.open('kg-chart-offline-v1',1);
      req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
    });
    try{return await new Promise((resolve,reject)=>{
      const req=db.transaction(store).objectStore(store).get(key);
      req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
    });}finally{db.close();}
  };
  return {
    nav,events,client,read,emit:(event,session)=>authCallback(event,session),
    status:()=>context.window.KGOffline.status(),
    get realSessionReads(){return realSessionReads;},
    get signOutCalls(){return signOutCalls;},
    nextEvent:()=>new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('Expected auth event was not delivered')),2000);
      wake=()=>{clearTimeout(timer);resolve();};
    }),
  };
}

test('saved offline learner ignores missing-session SDK events but never loses explicit sign-out',async()=>{
  const app=await boot();
  assert.equal((await app.client.auth.getSession()).data.session.user.id,USER);
  assert.equal(app.realSessionReads,0,'Previously enrolled offline account does not require network session');

  // SDK can report INITIAL_SESSION(null) or a failed refresh after the local
  // getSession facade restored the enrolled account. These are not a logout.
  app.emit('INITIAL_SESSION',null);
  app.emit('SIGNED_OUT',null);
  app.emit('TOKEN_REFRESHED',null);
  assert.equal(app.events.length,0,'No null session may cause the Welcome Back screen offline');
  assert.equal(app.status().ownerId,USER);
  assert.equal((await app.read('outbox','preserved-event')).id,'preserved-event');

  app.emit('SIGNED_IN',{user:{id:USER,email:EMAIL}});
  assert.equal(app.events.length,1,'Valid same-account events still pass through');

  app.nav.onLine=true;
  app.emit('SIGNED_OUT',null);
  assert.equal(app.events.at(-1).userId,null,'Online sign-out events are not suppressed');
  app.nav.onLine=false;

  await app.client.auth.signOut();
  assert.equal(app.signOutCalls,1);
  assert.equal(app.status().ownerId,null,'Explicit logout locks the offline enrollment');
  assert.equal((await app.read('kv','enroll:'+USER)).unlocked,false);
  assert.equal(await app.read('kv','active-owner'),null);
  assert.equal((await app.read('outbox','preserved-event')).id,'preserved-event',
    'Logging out never destroys pending progress');
  assert.equal((await app.client.auth.getSession()).data.session,null,
    'The locked account must not be restored from a fabricated session');
  assert.equal(app.events.at(-1).userId,null,'Explicit sign-out still reaches the learner UI');
});

test('switching to another account while offline locks the previous learner',async()=>{
  const app=await boot();
  const delivered=app.nextEvent();
  app.emit('SIGNED_IN',{user:{id:OTHER,email:'other@example.test'}});
  await delivered;
  assert.equal(app.status().ownerId,null,'Different identity must lock saved offline lessons');
  assert.equal((await app.read('kv','enroll:'+USER)).unlocked,false);
  assert.equal((await app.read('outbox','preserved-event')).id,'preserved-event');
  assert.equal(app.events.at(-1).userId,OTHER,'Account change event must not be suppressed');
});

test('without an enrolled offline account, normal login events remain visible',async()=>{
  const app=await boot({enrolled:false});
  assert.equal((await app.client.auth.getSession()).data.session,null);
  assert.equal(app.realSessionReads,1,'Without enrollment the SDK decides session state');
  app.emit('INITIAL_SESSION',null);
  assert.deepEqual(app.events.map(x=>x.event),['INITIAL_SESSION']);
});
