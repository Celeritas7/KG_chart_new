import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import {
  stagePrivateMedia,
} from '../../js/kg-private-offline-media.mjs';
import {
  preparePrivateMediaActivation,readPrivateOfflineMedia,privateAudioRangeResponse,
  PRIVATE_OFFLINE_PLAYBACK,
} from '../../js/kg-private-offline-playback.mjs';
import {loadProtectedWordPicture} from '../../js/kg-protected-image.mjs';

const OWNER='10000000-0000-4000-8000-000000000001';
const OTHER='20000000-0000-4000-8000-000000000002';
const WORD='30000000-0000-4000-8000-000000000003';
const SENT='40000000-0000-4000-8000-000000000004';
const IMAGE_ASSET='50000000-0000-4000-8000-000000000005';
const AUDIO_ASSET='60000000-0000-4000-8000-000000000006';
const NONCE='70000000-0000-4000-8000-000000000007';
const T=1783000000000;
const APP='https://kg-offline.example.invalid';
const PROJECT='https://fake.supabase.co';
const fakePolicy={};
for(const name of ['js/kg-learner-access.js','offline/access-policy.js']){
  const src=await fs.readFile(new URL('../../'+name,import.meta.url),'utf8');
  vm.runInNewContext(src,{window:fakePolicy});
}
const access=fakePolicy.KGOfflineAccess,learner=fakePolicy.KGLearnerAccess;
const snapshot={contract:1,mode:'restricted',revision:7,server_enforced:true,
  languages:['my'],topics:[{language_code:'my',topic_id:'food'}],
  features:['chart','quiz.words','quiz.sentences','quiz.speak']};
const policyRecord=access.fromServer(snapshot,OWNER,T).record;
const sentenceScope={state:'restricted',serverEnforced:true,groups:['food_lines'],
  groupTopics:{food_lines:'food'}};
const image={type:'word_image',id:WORD,topicId:'food',language:'my'};
const audio={type:'word_audio',id:WORD,topicId:'food',language:'my',voice:'f'};
const sentence={type:'sentence_audio',id:SENT,topicId:'food',
  groupName:'food_lines',language:'my',voice:'m'};
const mediaPlan=[image,audio,sentence];
const PNG=Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,12,73,72,68,82,0,0,0,1,0,0,0,1,8,2,0,0,0,0,0,0]);
const MP3=Uint8Array.from([73,68,51,...Array(90).fill(0)]);
function storage(){
  const all=new Map();
  return {all,async open(name){
    if(!all.has(name)){
      const contents=new Map();
      all.set(name,{contents,
        async put(key,response){contents.set(String(key),response.clone());},
        async match(key){return contents.get(String(key))?.clone();},
        async keys(){return [...contents.keys()].map(url=>({url}));},
      });
    }
    return all.get(name);
  },async keys(){return [...all.keys()];},async delete(name){return all.delete(name);}};
}
function objectUrls(){
  const created=[],revoked=[];
  return {created,revoked,
    createObjectURL(blob){created.push(blob);return 'blob:kg-private-'+created.length;},
    revokeObjectURL(value){revoked.push(value);},
  };
}
const cryptoApi={subtle:webcrypto.subtle,randomUUID:()=>NONCE};
const signed=async({resource})=>{
  const picture=resource.type==='word_image';
  return {url:PROJECT+'/storage/v1/object/sign/kg-chart-private-media/protected/'+
    (picture?IMAGE_ASSET:AUDIO_ASSET)+(picture?'.png':'.mp3')+
    '?token=do-not-store-this',contentType:picture?'image/png':'audio/mpeg',expiresIn:30};
};
async function fetchSigned(url,options){
  assert.equal(options.cache,'no-store');
  assert.equal(options.redirect,'error');
  const pic=url.includes('.png?');
  const bytes=pic?PNG:MP3;
  return new Response(bytes,{status:200,headers:{
    'Content-Type':pic?'image/png':'audio/mpeg',
    'Content-Length':String(bytes.byteLength),
  }});
}
const common={ownerId:OWNER,language:'my',policyRecord,appOrigin:APP,
  offlineAccess:access,learnerAccess:learner,cacheStorage:null,cryptoApi,
  clock:()=>T+1000};
async function installed(){
  const cacheStorage=storage(),base={...common,cacheStorage};
  const descriptor=await stagePrivateMedia({
    ...base,mediaPlan,sentenceScope,
    supabase:{rpc(){throw Error('No external database allowed');}},
    projectUrl:PROJECT,resolve:signed,fetcher:fetchSigned,
    decodeImage:async()=>{},
  });
  const pointer=await preparePrivateMediaActivation({
    ...base,descriptor,authorizedPlan:mediaPlan,sentenceScope,
  });
  return {cacheStorage,descriptor,pointer,base};
}
test('Exact granted private sources install a separate media-only pointer; nothing is deployed or made a lesson pack',async()=>{
  const {cacheStorage,descriptor,pointer,base}=await installed();
  assert.equal(pointer.kind,'kg-private-offline-active-media');
  assert.equal(pointer.ownerId,OWNER);
  assert.equal(pointer.revision,7);
  assert.equal(pointer.checkedAt,T);
  assert.equal(pointer.sourceKeys.length,3);
  assert(pointer.sourceKeys.every(k=>!k.includes('token=')&&!k.includes('vocabulary-assets')));
  assert(!JSON.stringify(pointer).includes('do-not-store-this'));
  assert(!JSON.stringify(pointer).includes(PROJECT));
  assert(descriptor.cacheName.startsWith('kg-private-stage-v1-'));
  assert.equal((await cacheStorage.keys()).length,1);
  assert.equal(PRIVATE_OFFLINE_PLAYBACK.activeByDefault,false);
  const urls=objectUrls();
  const lease=await readPrivateOfflineMedia({
    ...base,pointer,resource:image,urlFactory:urls,
  });
  assert(lease.url.startsWith('blob:'));
  assert.equal(lease.contentType,'image/png');
  assert.equal(lease.bytes,PNG.length);
  assert.equal(urls.created.length,1);
  lease.release();lease.release();
  assert.deepEqual(urls.revoked,[lease.url]);
});
test('Verified audio uses a blob URL and bytes can be served in exact ranges without network or public hashes',async()=>{
  const {pointer,base}=await installed();
  const urls=objectUrls();
  const lease=await readPrivateOfflineMedia({...base,pointer,resource:audio,urlFactory:urls});
  assert.equal(lease.contentType,'audio/mpeg');
  assert.equal(lease.bytes,MP3.byteLength);
  const bytes=new Uint8Array(await urls.created[0].arrayBuffer());
  const partial=privateAudioRangeResponse(bytes,'bytes=10-19');
  assert.equal(partial.status,206);
  assert.equal(partial.headers.get('content-range'),'bytes 10-19/93');
  assert.equal((await partial.arrayBuffer()).byteLength,10);
  const suffix=privateAudioRangeResponse(bytes,'bytes=-7');
  assert.equal(suffix.status,206);
  assert.equal((await suffix.arrayBuffer()).byteLength,7);
  const invalid=privateAudioRangeResponse(bytes,'bytes=600-');
  assert.equal(invalid.status,416);
  assert.equal(privateAudioRangeResponse(bytes).status,200);
  lease.release();assert.deepEqual(urls.revoked,[lease.url]);
});
test('Owner, language, policy revision, and an ungranted source cannot read a different cache',async()=>{
  const {pointer,base}=await installed();
  const urls=objectUrls();
  const bad=[
    {ownerId:OTHER},{language:'ja'},{resource:{...audio,id:OTHER}},
    {resource:{...audio,topicId:'friends_names'}},
    {resource:{...sentence,groupName:'private_group'}},
    {pointer:{...pointer,ownerId:OTHER}},
    {pointer:{...pointer,sourceKeys:[...pointer.sourceKeys,'not-authorized']}},
    {policyRecord:{...policyRecord,snapshot:{...policyRecord.snapshot,revision:8}}},
    {clock:()=>T+25*60*60*1000},
  ];
  for(const change of bad){
    await assert.rejects(readPrivateOfflineMedia({...base,pointer,resource:audio,urlFactory:urls,...change}),
      /Private offline media denied/);
  }
  assert.equal(urls.created.length,0);
});
test('Policy refresh at the SAME revision keeps identical approved media available',async()=>{
  const {pointer,base}=await installed();
  const refreshed=access.fromServer(snapshot,OWNER,T+5000,policyRecord).record;
  const urls=objectUrls();
  const lease=await readPrivateOfflineMedia({
    ...base,pointer,resource:audio,policyRecord:refreshed,clock:()=>T+5001,urlFactory:urls,
  });
  assert.equal(lease.contentType,'audio/mpeg');
  lease.release();
  const changed=access.fromServer({...snapshot,revision:8,topics:[]},OWNER,T+5000,policyRecord).record;
  await assert.rejects(readPrivateOfflineMedia({
    ...base,pointer,resource:audio,policyRecord:changed,clock:()=>T+5001,urlFactory:urls,
  }),/Private offline media denied/);
});
test('A tampered cached media byte or manifest never returns an object URL',async()=>{
  const first=await installed(),cache=await first.cacheStorage.open(first.descriptor.cacheName);
  const manifest=JSON.parse(await (await cache.match(first.descriptor.manifestUrl)).text());
  const target=manifest.media.find(x=>x.contentType==='audio/mpeg');
  await cache.put(target.cacheKey,new Response(MP3.slice(0,70),{
    headers:{'Content-Type':target.contentType,
      'X-KG-Private-SHA256':target.sha256,
      'X-KG-Private-Bytes':String(target.bytes)},
  }));
  const urls=objectUrls();
  await assert.rejects(readPrivateOfflineMedia({
    ...first.base,pointer:first.pointer,resource:audio,urlFactory:urls,
  }),/Private offline media denied/);
  assert.equal(urls.created.length,0);
  const second=await installed(),cache2=await second.cacheStorage.open(second.descriptor.cacheName);
  await cache2.put(second.descriptor.manifestUrl,new Response('{"kind":"forged"}',{
    headers:{'Content-Type':'application/json'},
  }));
  await assert.rejects(readPrivateOfflineMedia({
    ...second.base,pointer:second.pointer,resource:image,urlFactory:urls,
  }),/Private offline media denied/);
  assert.equal(urls.created.length,0);
});
test('Stale account switch after await rejects before leasing media',async()=>{
  const {pointer,base}=await installed();
  let called=0;
  const urls=objectUrls();
  await assert.rejects(readPrivateOfflineMedia({
    ...base,pointer,resource:audio,urlFactory:urls,
    assertCurrent(){if(++called>=2)throw Error('Account switched in another tab');},
  }),/Account switched/);
  assert.equal(urls.created.length,0);
});
test('Offline picture adapter uses private reader and never invokes network or signed URL fallback',async()=>{
  const old=Object.getOwnPropertyDescriptor(globalThis,'navigator');
  const former=globalThis.KGOffline;
  let calls=0,leases=0;
  const urls=objectUrls();
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{onLine:false}});
  globalThis.KGOffline={async readPrivateMedia(r){
    calls++;assert.equal(r.id,WORD);
    leases++;
    const url=urls.createObjectURL(new Blob([PNG],{type:'image/png'}));
    return {url,contentType:'image/png',release:()=>urls.revokeObjectURL(url)};
  }};
  try{
    const lease=await loadProtectedWordPicture({
      resource:image,policy:learner.parseSnapshot(snapshot),
      sentenceScope,supabase:{},projectUrl:PROJECT,
      fetcher:()=>{throw Error('Offline must not fetch');},
      resolve:()=>{throw Error('Offline must not sign');},
    });
    assert.equal(lease.url,'blob:kg-private-1');
    assert.equal(calls,1);lease.release();assert.equal(urls.revoked.length,1);
    globalThis.KGOffline={async readPrivateMedia(){calls++;return null;}};
    const missing=await loadProtectedWordPicture({
      resource:image,policy:learner.parseSnapshot(snapshot),
      sentenceScope,supabase:{},projectUrl:PROJECT,
      fetcher:()=>{throw Error('Offline cannot fall back to public media');},
    });
    assert.equal(missing,null);
    assert.equal(calls,2);
  }finally{
    if(old)Object.defineProperty(globalThis,'navigator',old);
    else delete globalThis.navigator;
    if(former===undefined)delete globalThis.KGOffline;else globalThis.KGOffline=former;
  }
});
test('Worker blocks private HTTP routes and denied public media while legacy public media continues',async()=>{
  const sw=await fs.readFile(new URL('../../offline/sw.js',import.meta.url),'utf8');
  const handlers={};
  let networkRequests=0;
  const app={origin:'https://offline.example.invalid'};
  const origin=app.origin,scope=origin+'/';
  const context={
    self:{location:{origin},registration:{scope},
      clients:{get:async()=>null},
      addEventListener(type,handler){handlers[type]=handler;},
    },
    importScripts(){},
    URL,Map,Set,Response,Request,Headers,AbortController,
    MessageChannel,
    fetch:async()=>{networkRequests++;return new Response('public', {status:200});},
    caches:{open:async()=>({match:async()=>null})},
    setTimeout,clearTimeout,console,
  };
  vm.runInNewContext(sw,context);
  const run=async(request,clientId='tab')=>{
    let promise;
    handlers.fetch({request:new Request(request),
      clientId,respondWith(r){promise=Promise.resolve(r);}});
    return promise?await promise:null;
  };
  const deniedPrivate=await run(scope+'__kg_private_media_v1__/'+OWNER+'/my/7/not-secret.bin');
  assert.equal(deniedPrivate.status,403);
  assert.equal(networkRequests,0);
  handlers.message({data:{type:'KG_OFFLINE_RESTRICTED_MEDIA'},source:{id:'tab'}});
  const publicURL=PROJECT+'/storage/v1/object/public/vocabulary-assets/food/rice.jpg';
  const deniedPublic=await run(publicURL);
  assert.equal(deniedPublic.status,403);
  assert.equal(networkRequests,0);
  // Legacy clients still use the original worker path.
  const legacy=await run(publicURL,'legacy-tab');
  assert.equal(legacy.status,200);
  assert.equal(networkRequests,1);
});
test('Source flags OFF; no restricted pack promotion, app migration, or public-worker private route',async()=>{
  const runtime=await fs.readFile(new URL('../../offline/runtime.js',import.meta.url),'utf8');
  const player=await fs.readFile(new URL('../../js/kg-audio.js',import.meta.url),'utf8');
  const pack=await fs.readFile(new URL('../build-offline.mjs',import.meta.url),'utf8');
  const html=await fs.readFile(new URL('../../index.html',import.meta.url),'utf8');
  assert.match(runtime,/const U3D2B2_PRIVATE_OFFLINE_PLAYBACK_ENABLED = false/);
  assert.match(runtime,/const U3D2B1_PRIVATE_MEDIA_STAGE_ENABLED = false/);
  assert.match(runtime,/const U3D2_SCOPED_PACK_PREVIEW_ENABLED = false/);
  assert.match(runtime,/const U3D1_OFFLINE_ACCESS_ENABLED = false/);
  assert.match(html,/const U3C1_SCOPED_UI_ENABLED = false/);
  assert.match(runtime,/async function readPrivateMedia\(resource\)/);
  assert.match(runtime,/async function restorePreviousPrivateMedia\(lang\)/);
  assert.match(runtime,/active-private-media:/);
  assert.match(runtime,/previous-private-media:/);
  assert.match(runtime,/readyToInstall:false/);
  assert.match(runtime,/KG_OFFLINE_RESTRICTED_MEDIA/);
  assert.match(runtime,/new URL\('\.\/js\/kg-private-offline-playback\.mjs',document\.baseURI\)/);
  assert.match(player,/window\.KGOffline\?\.readPrivateMedia/);
  assert.match(player,/offlineLease\?\.release/);
  assert.match(pack,/'js\/kg-private-offline-playback\.mjs', 'js\/kg-private-offline-playback\.mjs'/);
  assert.match(runtime,/const DB_NAME = 'kg-chart-offline-v1'/);
  assert.match(runtime,/const DB_VERSION = 1/);
});

test('Shared KGAudio actually plays offline private blob and revokes it on stop without a network fallback',async()=>{
  const source=await fs.readFile(new URL('../../js/kg-audio.js',import.meta.url),'utf8');
  let lastAudio,reads=0,released=0;
  class FakeAudio{
    constructor(){lastAudio=this;this.src='';this.currentTime=0;this.playCalls=0;}
    addEventListener(){}
    pause(){}
    load(){}
    removeAttribute(n){if(n==='src')this.src='';}
    play(){this.playCalls++;return Promise.resolve();}
  }
  const local={getItem:()=>null};
  const client={
    KGOffline:{async readPrivateMedia(request){
      reads++;assert.equal(request.id,WORD);
      return {url:'blob:synthetic-audio',contentType:'audio/mpeg',
        release(){released++;}};
    }},
  };
  vm.runInNewContext(source,{
    window:client,navigator:{onLine:false},Audio:FakeAudio,
    TextEncoder,localStorage:local,document:{},
    setTimeout,clearTimeout,console,
  });
  const A=client.KGAudio;
  A.requireVerifiedMediaPolicy(true);
  A.setVerifiedMediaPolicy({
    ownerId:OWNER,policy:learner.parseSnapshot(snapshot),
    sentenceScope,supabase:{},projectUrl:PROJECT,
  });
  assert.equal(A.play('rice','my',{silent:true,resource:audio}),true);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(reads,1);
  assert.equal(lastAudio.src,'blob:synthetic-audio');
  assert.equal(lastAudio.playCalls,1);
  A.stop();
  assert.equal(lastAudio.src,'');
  assert.equal(released,1);
  client.KGOffline.readPrivateMedia=async()=>{reads++;return null;};
  A.play('rice','my',{silent:true,resource:audio});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(reads,2);
  assert.equal(lastAudio.playCalls,1,'a denied offline read cannot play a legacy public clip');
  assert.equal(released,1);
});

test('New worker instance recovers restricted status from owning page before public-media fallback',async()=>{
  const sw=await fs.readFile(new URL('../../offline/sw.js',import.meta.url),'utf8');
  const origin='https://offline.example.invalid',scope=origin+'/';
  const handlers={};
  let networkRequests=0;
  const ownerPage={
    url:scope+'index.html',
    postMessage(message,ports){
      assert.equal(message.type,'KG_OFFLINE_REQUEST_OWNER');
      ports[0].postMessage({restrictedMedia:true});
    },
  };
  vm.runInNewContext(sw,{
    self:{location:{origin},registration:{scope},
      clients:{get:async()=>ownerPage},
      addEventListener(type,handler){handlers[type]=handler;},
    },
    importScripts(){},
    URL,Map,Set,Response,Request,Headers,AbortController,MessageChannel,
    fetch:async()=>{networkRequests++;return new Response('public');},
    caches:{open:async()=>({match:async()=>null})},
    setTimeout,clearTimeout,console,
  });
  let pending;
  handlers.fetch({
    request:new Request(PROJECT+'/storage/v1/object/public/vocabulary-assets/food/a.jpg'),
    clientId:'reopened-restricted',
    respondWith(promise){pending=Promise.resolve(promise);},
  });
  const reply=await pending;
  assert.equal(reply.status,403);
  assert.equal(networkRequests,0,'worker restart must not escape to public media CDN');
});
