import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { indexedDB } from 'fake-indexeddb';

const UID='44444444-4444-4444-8444-444444444444';
const FILE=path.resolve(import.meta.dirname,'../runtime.js');

function open() {
  return new Promise((resolve,reject)=>{
    const r=indexedDB.open('kg-chart-offline-v1',1);
    r.onupgradeneeded=()=>{r.result.createObjectStore('kv');r.result.createObjectStore('outbox',{keyPath:'id'});};
    r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
  });
}
function seed(db,key,value) {
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('kv','readwrite');tx.objectStore('kv').put(value,key);
    tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);
  });
}
class RemoteQuery {
  constructor(table,rows,remote) {this.table=table;this.rows=rows;this.remote=remote;this.filters=[];this.mode='select';this.value=null;this.shape='array';this.from=0;this.to=null;}
  select() {this.returning=true;return this;}
  eq(key,v){this.filters.push(r=>r[key]===v);return this;}
  in(key,values){this.filters.push(r=>values.includes(r[key]));return this;}
  order(key,{ascending=true}={}) {this.sort=[key,ascending];return this;}
  range(a,b){this.from=a;this.to=b;return this;}
  maybeSingle(){this.shape='single';return this;}
  single(){this.shape='single';return this;}
  insert(rows){this.mode='insert';this.value=Array.isArray(rows)?rows:[rows];return this;}
  upsert(rows){this.mode='upsert';this.value=Array.isArray(rows)?rows:[rows];return this;}
  update(row){this.mode='update';this.value=[row];return this;}
  delete(){this.mode='delete';return this;}
  then(resolve,reject){return Promise.resolve().then(()=>this.run()).then(resolve,reject);}
  run(){
    const arr=this.rows[this.table]||=[];
    if(this.mode==='insert'){
      if(this.value.some(v=>arr.some(x=>x.id===v.id))) return {data:null,error:{code:'23505',message:'duplicate key'}};
      arr.push(...this.value.map(x=>({...x})));
      if(this.remote.dropAckOnce){this.remote.dropAckOnce=false;return {data:null,error:{message:'connection dropped after commit'}};}
      return {data:this.value,error:null};
    }
    if(this.mode==='upsert'){
      for(const row of this.value){const i=arr.findIndex(x=>x.id===row.id);if(i<0)arr.push({...row});else arr[i]={...arr[i],...row};}
      return {data:this.value,error:null};
    }
    let values=arr.filter(r=>this.filters.every(f=>f(r)));
    if(this.sort)values.sort((a,b)=>String(a[this.sort[0]]).localeCompare(String(b[this.sort[0]]))*(this.sort[1]?1:-1));
    values=values.slice(this.from,this.to===null?undefined:this.to+1);
    return {data:this.shape==='single'?(values[0]||null):values,error:null};
  }
}

test('offline session + answers commit to an account-scoped outbox before acknowledgment, then retry idempotently',async()=>{
  const db=await open();
  const enrollment={id:UID,email:'student@example.org',admin:false,unlocked:true,verifiedAt:new Date().toISOString()};
  const pack={ownerId:UID,lang:'my',schemaVersion:1,cacheName:'kg-offline-pack-previous',data:{
    kg_chart_languages:[{code:'my',name_english:'Burmese'}],
    kg_chart_topics:[{id:'animals',sort_order:1}],
    kg_chart_topic_translations:[{topic_id:'animals',language_code:'my',title_native:'Animals'}],
    kg_chart_vocabulary:[{id:'vocab-one',topic_id:'animals',english_text:'Cat'}],
    kg_chart_vocabulary_translations:[{vocabulary_id:'vocab-one',language_code:'my',native_text:'ကြောင်'}],
    kg_chart_settings:[{key:'unlock_rules',value:null}]
  }};
  for(const [key,value] of [
    ['active-owner',UID],['enroll:'+UID,enrollment],['active:'+UID+':my','pack-a'],
    ['pack:pack-a',pack],['active-caches:'+UID,[pack.cacheName]]
  ]) await seed(db,key,value);
  db.close();
  const remote={rows:{},dropAckOnce:true,failLevelOnce:true,levelCheckCalls:0};
  const live={
    auth:{getUser:async()=>({data:{user:{id:UID,email:enrollment.email}},error:null}),
      getSession:async()=>({data:{session:{user:{id:UID}}},error:null}),
      signOut:async()=>({error:null}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},
    rpc:async name=>{
      if(name==='kg_chart_check_level_up'){
        remote.levelCheckCalls++;
        if(remote.failLevelOnce){remote.failLevelOnce=false;return {error:{message:'temporary level update timeout'}};}
      }
      return {data:true,error:null};
    },
    from:table=>new RemoteQuery(table,remote.rows,remote),
    functions:{invoke:async()=>({error:{message:'network'}})},storage:{},
  };
  const nav={onLine:false,serviceWorker:{controller:{postMessage(){}},addEventListener(type,handler){if(type==='message')this.onMessage=handler;}},connection:{addEventListener(){}}};
  const context={window:{},document:{getElementById:()=>null,addEventListener(){},hidden:false},
    navigator:nav,location:{href:'http://localhost/',hash:''},addEventListener(){},
    BroadcastChannel:class{addEventListener(){}postMessage(){}},indexedDB,
    URL,Response,Headers,TextEncoder,Blob,AbortController,crypto:webcrypto,
    setTimeout:(fn,ms)=>{const t=setTimeout(fn,ms);t.unref?.();return t;},clearTimeout,
    fetch:async()=>({ok:false}),console};
  vm.runInNewContext(await fs.readFile(FILE,'utf8'),context,{filename:'offline/runtime.js'});
  await context.window.KGOffline.ready;
  const facade=context.window.KGOffline.wrapClient(live);
  assert.equal([...context.window.KGOffline.status().readyLanguages].join(','),'my');
  const topics=await facade.from('kg_chart_topics').select('*, translations:kg_chart_topic_translations(*)');
  assert.equal(topics.data[0].translations[0].title_native,'Animals');
  const session=await facade.from('kg_chart_quiz_sessions').insert({user_id:UID,language_code:'my',quiz_type:'native_to_image',
    total_questions:1,correct_answers:1,created_at:new Date().toISOString()}).select('id').single();
  assert.equal(session.error,null);
  assert.match(session.data.id,/^[a-f0-9-]{36}$/);
  const answers=await facade.from('kg_chart_quiz_answers').insert({session_id:session.data.id,vocabulary_id:'vocab-one',is_correct:true});
  assert.equal(answers.error,null);
  assert.equal(context.window.KGOffline.status().pending,2);
  assert.equal(remote.rows.kg_chart_quiz_sessions,undefined,'No server write while offline');
  nav.onLine=true;
  await context.window.KGOffline.sync();
  assert.equal(context.window.KGOffline.status().pending,2,'Failed acknowledgment keeps outbox');
  assert.equal(remote.rows.kg_chart_quiz_sessions.length,1,'First upload reached server');
  await context.window.KGOffline.sync();
  assert.equal(context.window.KGOffline.status().pending,0,'Duplicate replay was acknowledged after read-back');
  assert.equal(remote.rows.kg_chart_quiz_sessions.length,1,'No duplicated quiz sessions');
  assert.equal(remote.rows.kg_chart_quiz_answers.length,1,'Answers uploaded once');
  assert.match(context.window.KGOffline.status().syncError,/Server level check/,'Level RPC failure remains visible');
  assert.equal(context.window.KGOffline.status().lastSync,null,'Do not claim full sync if level-up RPC failed');
  await context.window.KGOffline.sync();
  assert.equal(remote.levelCheckCalls,2,'Persisted level check retries even though outbox rows were already acknowledged');
  assert(context.window.KGOffline.status().lastSync,'Last successful sync recorded only after successful pull');

  // Two devices independently rate the same word. Never wipe the newer server rating.
  const baseline={id:'rating-one',user_id:UID,vocabulary_id:'vocab-one',language_code:'my',rating:2,
    last_reviewed_at:'2026-11-01T00:00:00.000Z',updated_at:'2026-11-01T00:00:00.000Z'};
  const anotherDb=await open();
  await seed(anotherDb,'rows:'+UID+':kg_chart_user_ratings',[baseline]);
  anotherDb.close();
  remote.rows.kg_chart_user_ratings=[{...baseline,rating:3,updated_at:'2026-11-05T00:00:00.000Z'}];
  const update=await facade.from('kg_chart_user_ratings').upsert({...baseline,rating:5,
    updated_at:'2026-11-04T00:00:00.000Z',last_reviewed_at:'2026-11-04T00:00:00.000Z'},
    {onConflict:'user_id,vocabulary_id,language_code'});
  assert.equal(update.error,null);
  assert.equal(context.window.KGOffline.status().pending,1);
  await context.window.KGOffline.sync();
  assert.equal(context.window.KGOffline.status().pending,1,'Unresolved rating conflict stays in outbox');
  assert.match(context.window.KGOffline.status().syncError,/Rating conflict/);
  assert.equal(remote.rows.kg_chart_user_ratings[0].rating,3,'Remote rating protected');

  const cross=await facade.from('kg_chart_user_ratings').upsert({user_id:'55555555-5555-4555-8555-555555555555',
    vocabulary_id:'vocab-one',language_code:'my',rating:1});
  assert.match(cross.error.message,/Account mismatch/);
  assert.equal(context.window.KGOffline.status().pending,1,'Cross-account write rejected');

  await facade.auth.signOut();
  assert.equal(context.window.KGOffline.status().ownerId,null,'Logout locks cached account');
  const afterLogout=await open();
  const queued=await new Promise(resolve=>{const r=afterLogout.transaction('outbox').objectStore('outbox').getAll();r.onsuccess=()=>resolve(r.result);});
  afterLogout.close();
  assert.equal(queued.length,1,'Logout preserves unsent work for future reauthentication');

  // A partially downloaded update must NOT switch the working pack. Resume the
  // staged file with the same revision rather than fetching it a second time.
  const contents={
    kg_chart_languages:[{code:'my',name_english:'Burmese',is_active:true}],
    kg_chart_topics:[{id:'animals',sort_order:1}],
    kg_chart_topic_translations:[{topic_id:'animals',language_code:'my',title_native:'Animals'}],
    kg_chart_vocabulary:[{id:'vocab-one',topic_id:'animals',image_filename:'cat.jpg',english_text:'Cat'},
      {id:'vocab-two',topic_id:'animals',image_filename:'dog.jpg',english_text:'Dog'}],
    kg_chart_vocabulary_translations:[{vocabulary_id:'vocab-one',language_code:'my',native_text:'ကြောင်'},
      {vocabulary_id:'vocab-two',language_code:'my',native_text:'ခွေး'}],
    kg_chart_sentences:[],kg_chart_colour_phrases:[],
    kg_chart_settings:[{key:'unlock_rules',value:{}}],
  };
  Object.assign(remote.rows,contents);
  class FakeCache {
    items=new Map();
    async put(url,response){this.items.set(String(url),response.clone());}
    async match(url){return this.items.get(String(url))?.clone();}
  }
  const caches=new Map();
  context.caches={open:async name=>{if(!caches.has(name))caches.set(name,new FakeCache());return caches.get(name);},
    delete:async name=>caches.delete(name)};
  nav.storage={persist:async()=>true};
  let failDog=true,catGets=0,dogGets=0;
  context.fetch=async (input,opts={})=>{
    const url=String(input);
    if(url.includes('offline-build.json'))return {ok:false};
    if(url.includes('clips.json'))return {ok:false,status:404};
    if(opts.method==='HEAD')return new Response(null,{status:200,headers:{etag:'"media-v1"','content-length':'5'}});
    const name=new URL(url).pathname.split('/').pop();
    if(name==='cat.jpg')catGets++;
    if(name==='dog.jpg'){dogGets++;if(failDog)throw Error('simulated interrupted download');}
    return new Response(new Uint8Array([1,2,3,4,5]),{status:200,headers:{'content-type':'image/jpeg'}});
  };
  await context.window.KGOffline.afterVerified({id:UID,email:enrollment.email});
  assert.equal(context.window.KGOffline.status().readyLanguages.includes('my'),true);
  await assert.rejects(context.window.KGOffline.downloadPack('my',{refresh:true}),/download|interrupted/i);
  assert.equal(context.window.KGOffline.status().readyLanguages.includes('my'),true,'Working pack survived failed staging');
  failDog=false;
  await context.window.KGOffline.downloadPack('my',{refresh:true});
  assert.match(context.window.KGOffline.status().progress.phase,/Pack saved/,'A pack alone is not a verified offline installation');
  assert.equal(context.window.KGOffline.status().shellReady,false);
  nav.serviceWorker.onMessage({data:{type:'KG_OFFLINE_SHELL_READY',revision:'test'}});
  assert.match(context.window.KGOffline.status().progress.phase,/Ready offline/);
  assert.equal(catGets,1,'Completed staged image was reused on retry');
  assert.equal(dogGets,2,'Only failed image was downloaded again');
});
