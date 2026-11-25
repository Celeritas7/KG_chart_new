import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {
  stagePrivateMedia,inspectPrivateMediaStage,discardPrivateMediaStage,
  PRIVATE_MEDIA_STAGING_CONTRACT as LIMITS,
} from '../../js/kg-private-offline-media.mjs';

const APP='https://kg-offline.example.invalid';
const PROJECT='https://fake.supabase.co';
const OWNER='10000000-0000-4000-8000-000000000001';
const OTHER='20000000-0000-4000-8000-000000000002';
const WORD='30000000-0000-4000-8000-000000000003';
const SENT='40000000-0000-4000-8000-000000000004';
const IMAGE_ASSET='50000000-0000-4000-8000-000000000005';
const AUDIO_ASSET='60000000-0000-4000-8000-000000000006';
const NONCE='70000000-0000-4000-8000-000000000007';
const TIME=1783000000000;
const account={};
for(const filename of ['js/kg-learner-access.js','offline/access-policy.js']){
  const src=await fs.readFile(new URL('../../'+filename,import.meta.url),'utf8');
  vm.runInNewContext(src,{window:account});
}
const snapshot={
  contract:1,mode:'restricted',revision:7,server_enforced:true,
  languages:['my'],topics:[{language_code:'my',topic_id:'food'}],
  features:['chart','quiz.words','quiz.sentences','quiz.speak'],
};
const record=account.KGOfflineAccess.fromServer(snapshot,OWNER,TIME).record;
const sentenceScope={state:'restricted',serverEnforced:true,
  groups:['food_lines'],groupTopics:{food_lines:'food'}};
const mediaPlan=[
  {type:'word_image',id:WORD,topicId:'food',language:'my'},
  {type:'word_audio',id:WORD,topicId:'food',language:'my',voice:'f'},
  {type:'sentence_audio',id:SENT,topicId:'food',language:'my',
    groupName:'food_lines',voice:'m'},
];

function fakeCaches(){
  const all=new Map();
  function make(){
    const records=new Map();
    return {
      records,
      async match(key){return records.get(String(key))?.clone();},
      async put(key,response){records.set(String(key),response.clone());},
      async keys(){return [...records.keys()].map(url=>({url}));},
    };
  }
  return {
    all,
    async open(name){if(!all.has(name))all.set(name,make());return all.get(name);},
    async delete(name){return all.delete(name);},
    async keys(){return [...all.keys()];},
  };
}
const PNG=Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,12,73,72,68,82,0,0,0,1,0,0,0,1,8,2,0,0,0,0,0,0]);
const MP3=Uint8Array.from([73,68,51,...Array(90).fill(0)]);
const fakeCrypto={subtle:webcrypto.subtle,randomUUID:()=>NONCE};
const base={
  ownerId:OWNER,language:'my',policyRecord:record,mediaPlan,sentenceScope,
  offlineAccess:account.KGOfflineAccess,learnerAccess:account.KGLearnerAccess,
  projectUrl:PROJECT,appOrigin:APP,cryptoApi:fakeCrypto,
  supabase:{rpc(){throw Error('Never call live Supabase in a synthetic test');}},
  clock:()=>TIME+1000,
  decodeImage:async ({mime,bytes})=>{
    assert.equal(mime,'image/png');assert.equal(bytes[0],137);
  },
};
function signed({resource}){
  const image=resource.type==='word_image';
  const id=image?IMAGE_ASSET:AUDIO_ASSET;
  return Promise.resolve({
    url:PROJECT+'/storage/v1/object/sign/kg-chart-private-media/protected/'+
      id+(image?'.png':'.mp3')+'?token=synthetic-token',
    contentType:image?'image/png':'audio/mpeg',expiresIn:30,
  });
}
function transport({failAt=0,corrupt=false,mime=null,tooLong=false}={}){
  const requests=[];
  async function fetcher(url,options){
    requests.push({url,options});
    if(failAt&&requests.length===failAt)
      throw Error('Synthetic network disconnected');
    const image=url.includes('.png?');
    const type=mime||(image?'image/png':'audio/mpeg');
    const bytes=tooLong ? Uint8Array.from([1]) :
      corrupt?Uint8Array.from([0,1,2,3,4,5,6,7,8,9]):
      (image?PNG:MP3);
    return new Response(bytes,{
      status:200,
      headers:{
        'Content-Type':type,
        'Content-Length':String(tooLong?LIMITS.maxAudioBytes+1:bytes.byteLength),
        'Cache-Control':'public, max-age=99999',
      },
    });
  }
  return {fetcher,requests};
}
function context(overrides={}){
  const cacheStorage=fakeCaches(),t=transport();
  return {cacheStorage,fetcher:t.fetcher,requests:t.requests,resolve:signed,...overrides};
}
function args(extra={}){return {...base,...extra};}

test('Private signed bytes stage per account, no signed tokens/public URLs stored, and hashes verify',async()=>{
  const t=context();
  let checks=0;
  const desc=await stagePrivateMedia(args({...t,assertCurrent(){checks++;}}));
  assert.equal(desc.readyToInstall,false);
  assert.equal(desc.contract,1);
  assert(desc.cacheName.startsWith('kg-private-stage-v1-'+OWNER+'-my-7-'));
  assert.equal(desc.assetCount,3);
  assert.equal(t.requests.length,3);
  assert(checks>=6);
  const record=t.cacheStorage.all.get(desc.cacheName);
  assert.equal(record.records.size,4,'3 media and one manifest, no extra object');
  const urls=[...record.records.keys()];
  assert(urls.every(url=>url.startsWith(APP+'/__kg_private_media_v1__/'+OWNER+'/my/7/')));
  assert(urls.every(url=>!url.includes('token=')&&!url.includes('fake.supabase.co')));
  assert(urls.every(url=>!url.includes('vocabulary-assets')));
  assert(urls.every(url=>!url.includes(WORD)||url.endsWith('manifest.json')));
  assert.equal(t.requests[0].options.mode,'cors');
  assert.equal(t.requests[0].options.cache,'no-store');
  assert.equal(t.requests[0].options.redirect,'error');
  assert.equal(t.requests[0].options.credentials,'omit');
  assert.equal(t.requests[0].options.referrerPolicy,'no-referrer');
  const header=[...record.records.values()][0].headers;
  assert.equal(header.get('cache-control'),'private, no-store');
  const manifest=JSON.parse(await (await record.match(desc.manifestUrl)).text());
  assert.equal(manifest.media.length,3);
  assert.deepEqual(manifest.media.map(m=>m.contentType),['image/png','audio/mpeg','audio/mpeg']);
  assert(!JSON.stringify(manifest).includes('token='));
  assert(!JSON.stringify(manifest).includes('vocabulary-assets'));
  const verified=await inspectPrivateMediaStage(args({...t,descriptor:desc}));
  assert.deepEqual({verified:verified.verified,ready:verified.readyToInstall,
    owner:verified.ownerId,assets:verified.assetCount},
    {verified:true,ready:false,owner:OWNER,assets:3});
});

test('Wrong owner, mismatched language or expired policy cannot read or delete another stage',async()=>{
  const t=context();
  const desc=await stagePrivateMedia(args(t));
  for(const changed of [
    {ownerId:OTHER},{language:'ja'},
    {policyRecord:{...record,ownerId:OTHER}},
    {clock:()=>TIME+24*60*60*1000+10},
  ]){
    await assert.rejects(inspectPrivateMediaStage(args({...t,descriptor:desc,...changed})),
      /private media stage denied/i);
  }
  await assert.rejects(discardPrivateMediaStage(args({
    ...t,descriptor:desc,ownerId:OTHER
  })),/private media stage denied/i);
  assert(t.cacheStorage.all.has(desc.cacheName),'failed requests must preserve original owner bytes');
});

test('Failed download, unapproved source or corrupt media deletes only its new stage',async()=>{
  const c=fakeCaches();
  const old='kg-offline-pack-'+OWNER+'-my-existing';
  const oldCache=await c.open(old);
  await oldCache.put(APP+'/existing.png',new Response(PNG));
  const bad=[
    {fetcher:transport({failAt:2}).fetcher},
    {resolve:async()=>null,fetcher:transport().fetcher},
    {resolve:async({resource})=>({
      url:PROJECT+'/storage/v1/object/public/vocabulary-assets/food/x.png',
      contentType:resource.type==='word_image'?'image/png':'audio/mpeg',
      expiresIn:30,
    }),fetcher:transport().fetcher},
    {fetcher:transport({corrupt:true}).fetcher},
    {fetcher:transport({tooLong:true}).fetcher},
    {fetcher:transport({mime:'text/html'}).fetcher},
    {fetcher:transport().fetcher,decodeImage:async()=>{throw Error('Synthetic decoder failure');}},
  ];
  for(const change of bad){
    await assert.rejects(stagePrivateMedia(args({cacheStorage:c,resolve:signed,...change})),
      /stage denied|decoder failure/i);
    assert.deepEqual(await c.keys(),[old],'failed new stage must be completely discarded');
    assert.equal((await oldCache.match(APP+'/existing.png')).status,200);
  }
});

test('Denied source and cross-topic/cross-account attempts never contact signer or fetch',async()=>{
  let signedCalls=0,fetchCalls=0;
  const t=context({
    resolve:async()=>{signedCalls++;return signed({resource:mediaPlan[0]});},
    fetcher:async()=>{fetchCalls++;throw Error('Forbidden network');},
  });
  const invalid=[
    {mediaPlan:[{...mediaPlan[0],topicId:'friends_names'}]},
    {mediaPlan:[{...mediaPlan[1],language:'ja'}]},
    {mediaPlan:[{...mediaPlan[1],id:'not-a-uuid'}]},
    {mediaPlan:[mediaPlan[0],mediaPlan[0]]},
    {mediaPlan:[{...mediaPlan[2],groupName:'secret_group'}]},
    {mediaPlan:[{...mediaPlan[1],voice:'x'}]},
  ];
  for(const change of invalid)
    await assert.rejects(stagePrivateMedia(args({...t,...change})),/stage denied/i);
  assert.equal(signedCalls,0);
  assert.equal(fetchCalls,0);
  assert.deepEqual(await t.cacheStorage.keys(),[]);
});

test('Interrupted owner/revision or AbortController cancellation cannot leave a staged private cache',async()=>{
  const c=fakeCaches();
  let count=0;
  const first=await assert.rejects(stagePrivateMedia(args({
    cacheStorage:c,fetcher:transport().fetcher,resolve:signed,
    assertCurrent(){if(++count===4)throw Error('Account switched during stage');},
  })),/Account switched/);
  assert.equal(first,undefined);
  assert.deepEqual(await c.keys(),[]);
  const abort=new AbortController();abort.abort();
  await assert.rejects(stagePrivateMedia(args({
    cacheStorage:c,fetcher:transport().fetcher,resolve:signed,signal:abort.signal
  })),/stage denied: stage cancelled/);
  assert.deepEqual(await c.keys(),[]);
});

test('Corrupt or missing stage asset, forged manifest and extra cache record fail verification',async()=>{
  const t=context();
  const desc=await stagePrivateMedia(args(t));
  const cache=await t.cacheStorage.open(desc.cacheName);
  const manifest=JSON.parse(await (await cache.match(desc.manifestUrl)).text());
  const item=manifest.media[0];
  await cache.put(item.cacheKey,new Response(Uint8Array.from([1,2,3]),{
    headers:{'Content-Type':item.contentType,
      'X-KG-Private-SHA256':item.sha256,
      'X-KG-Private-Bytes':String(item.bytes)}
  }));
  await assert.rejects(inspectPrivateMediaStage(args({...t,descriptor:desc})),
    /stage denied: private media changed/i);
  // Restore stage, then add an unreviewed cache object.
  const restored=context();
  const valid=await stagePrivateMedia(args(restored));
  const storage=await restored.cacheStorage.open(valid.cacheName);
  await storage.put(APP+'/arbitrary.txt',new Response('not allowed'));
  await assert.rejects(inspectPrivateMediaStage(args({...restored,descriptor:valid})),
    /stage denied: unexpected resource/i);
  const mod=context();
  const d=await stagePrivateMedia(args(mod));
  const store=await mod.cacheStorage.open(d.cacheName);
  await store.put(d.manifestUrl,new Response(JSON.stringify({ownerId:OTHER}),{
    headers:{'Content-Type':'application/json'}
  }));
  await assert.rejects(inspectPrivateMediaStage(args({...mod,descriptor:d})),
    /stage denied: private stage manifest was modified/);
});

test('Cleanup only deletes the explicit same-owner stage, not older offline packs',async()=>{
  const t=context();
  const old='kg-offline-pack-'+OWNER+'-my-older';
  await (await t.cacheStorage.open(old)).put(APP+'/old',new Response(PNG));
  const d=await stagePrivateMedia(args(t));
  assert.equal(await discardPrivateMediaStage(args({...t,descriptor:d})),true);
  assert.equal(await discardPrivateMediaStage(args({...t,descriptor:d})),false);
  assert.deepEqual(await t.cacheStorage.keys(),[old]);
});

test('No browser entrypoint can activate private staging: all three old gates and U3D2B1 remain OFF',async()=>{
  const rt=await fs.readFile(new URL('../../offline/runtime.js',import.meta.url),'utf8');
  const build=await fs.readFile(new URL('../build-offline.mjs',import.meta.url),'utf8');
  const html=await fs.readFile(new URL('../../index.html',import.meta.url),'utf8');
  const sw=await fs.readFile(new URL('../../offline/sw.js',import.meta.url),'utf8');
  assert.match(rt,/const U3D1_OFFLINE_ACCESS_ENABLED = false/);
  assert.match(rt,/const U3D2_SCOPED_PACK_PREVIEW_ENABLED = false/);
  assert.match(rt,/const U3D2B1_PRIVATE_MEDIA_STAGE_ENABLED = false/);
  assert.match(html,/const U3C1_SCOPED_UI_ENABLED = false/);
  assert.match(rt,/async function stageRestrictedPrivateMedia\(lang\)/);
  assert.match(rt,/readyToInstall:false/);
  assert.match(rt,/const \{candidate,policyRecord,sentenceScope\}=await assembleRestrictedCandidate\(lang\)/);
  assert.match(rt,/await module\.inspectPrivateMediaStage\(\{\.\.\.args,descriptor\}\)/);
  assert.match(rt,/await module\.discardPrivateMediaStage\(\{\.\.\.args,descriptor\}\)\.catch/);
  assert.match(rt,/cachedAccessRecord\.snapshot\)!==snapshot/);
  assert.match(sw,/const MEDIA_PREFIX = 'kg-offline-pack-'/);
  assert.match(rt,/const DB_NAME = 'kg-chart-offline-v1'/);
  assert.match(rt,/const DB_VERSION = 1/);
  assert.match(rt,/const SCHEMA_VERSION = 1/);
  assert(build.includes("'js/kg-private-offline-media.mjs', 'js/kg-private-offline-media.mjs'"));
  assert(build.indexOf("'js/kg-private-offline-media.mjs'")<build.indexOf("'offline/runtime.js'"));
  assert.equal(LIMITS.installed,false);
});
