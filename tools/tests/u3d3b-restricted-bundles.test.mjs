import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {stagePrivateMedia} from '../../js/kg-private-offline-media.mjs';
import {preparePrivateMediaActivation} from '../../js/kg-private-offline-playback.mjs';

const root={};
for(const path of ['js/kg-learner-access.js','js/kg-sentence-access.js',
  'offline/access-policy.js','offline/scoped-pack.js',
  'offline/restricted-packs.js']){
  vm.runInNewContext(await fs.readFile(new URL('../../'+path,import.meta.url),'utf8'),
    {window:root,crypto:webcrypto,TextEncoder});
}
const T=1795500000000;
const OWNER='10000000-0000-4000-8000-000000000001';
const OTHER='20000000-0000-4000-8000-000000000002';
const WORD='30000000-0000-4000-8000-000000000003';
const PRIVATE='30000000-0000-4000-8000-000000000004';
const SENT='40000000-0000-4000-8000-000000000005';
const COLOUR='50000000-0000-4000-8000-000000000006';
const ASSET_IMAGE='60000000-0000-4000-8000-000000000007';
const ASSET_AUDIO='70000000-0000-4000-8000-000000000008';
const NONCE='80000000-0000-4000-8000-000000000009';
const APP='https://kg-offline.example.invalid',PROJECT='https://fake.supabase.co';
const policy={
  contract:1,mode:'restricted',revision:5,server_enforced:true,
  languages:['my'],topics:[{language_code:'my',topic_id:'food'},
    {language_code:'my',topic_id:'friends_names'}],
  features:['chart','quiz.words','quiz.sentences','quiz.speak','quiz.colours'],
};
const record=root.KGOfflineAccess.fromServer(policy,OWNER,T).record;
const TT=root.KGRestrictedPacks.TABLES;
const src={
 [TT.languages]:[{code:'my',name_english:'Burmese',is_active:true}],
 [TT.topics]:[{id:'food',icon:'🍚'},{id:'friends_names',icon:'🔒'}],
 [TT.topicTranslations]:[
  {topic_id:'food',language_code:'my',title_native:'Food',question_native:'Eat'},
  {topic_id:'friends_names',language_code:'my',title_native:'PRIVATE'},
 ],
 [TT.vocabulary]:[
  {id:WORD,topic_id:'food',english_text:'Rice',image_filename:'rice.jpg'},
  {id:PRIVATE,topic_id:'friends_names',english_text:'Never reveal this friend',image_filename:'secret.jpg'},
 ],
 [TT.vocabularyTranslations]:[
  {vocabulary_id:WORD,language_code:'my',native_text:'Rice'},
  {vocabulary_id:PRIVATE,language_code:'my',native_text:'PRIVATE'},
 ],
 [TT.sentences]:[{id:SENT,group_name:'food_lines',language_code:'my',
  native_text:'Eat Rice',english_text:'Eat rice'}],
 [TT.colours]:[],
 [TT.settings]:[{key:'private_lessons',value:[{emails:['another@example.invalid']}]}],
};
const groupSnapshot={
 contract:1,language_code:'my',mode:'restricted',server_enforced:true,
 groups:[{group_name:'food_lines',topic_id:'food'}],
};
const privateVisibility={contract:1,topics:['friends_names'],groups:['private_group']};
const scope=root.KGSentenceAccess.parseGroupSnapshot(
  groupSnapshot,root.KGLearnerAccess.parseSnapshot(policy),'my');
const candidate=root.KGScopedPack.buildScopedPack({
  data:src,language:'my',ownerId:OWNER,policyRecord:record,
  sentenceResponse:groupSnapshot,privateVisibility,checkedAt:T+100,
});
function caches(){
 const storage=new Map();
 return {storage,async keys(){return [...storage.keys()];},
   async delete(name){return storage.delete(name);},
   async open(name){
     if(!storage.has(name)){
       const data=new Map();
       storage.set(name,{data,
         async put(k,r){data.set(String(k),r.clone());},
         async match(k){return data.get(String(k))?.clone();},
         async keys(){return [...data.keys()].map(url=>({url}));},
       });
     }
     return storage.get(name);
   }};
}
const pic=Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,12,73,72,68,82,0,0,0,1,0,0,0,1,8,2,0,0,0,0,0,0]);
const mp3=Uint8Array.from([73,68,51,...Array(90).fill(0)]);
const cryptoApi={subtle:webcrypto.subtle,randomUUID:()=>NONCE};
async function stage(){
 const cacheStorage=caches();
 const common={ownerId:OWNER,language:'my',policyRecord:record,appOrigin:APP,
   offlineAccess:root.KGOfflineAccess,learnerAccess:root.KGLearnerAccess,
   cacheStorage,cryptoApi,clock:()=>T+1000,
 };
 const descriptor=await stagePrivateMedia({
   ...common,mediaPlan:candidate.mediaPlan,sentenceScope:scope,
   supabase:{rpc(){throw Error('Synthetic no-cloud test');}},
   projectUrl:PROJECT,decodeImage:async()=>{},
   resolve:async({resource})=>{
     const image=resource.type==='word_image';
     return {url:PROJECT+'/storage/v1/object/sign/kg-chart-private-media/protected/'+
       (image?ASSET_IMAGE:ASSET_AUDIO)+(image?'.png':'.mp3')+'?token=synthetic',
       contentType:image?'image/png':'audio/mpeg',expiresIn:30};
   },
   fetcher:async url=>{
     const image=url.includes('.png?'),bytes=image?pic:mp3;
     return new Response(bytes,{headers:{
       'Content-Type':image?'image/png':'audio/mpeg',
       'Content-Length':String(bytes.byteLength)},
     });
   },
 });
 const mediaPointer=await preparePrivateMediaActivation({
   ...common,descriptor,authorizedPlan:candidate.mediaPlan,sentenceScope:scope,
 });
 return {descriptor,mediaPointer,cacheStorage};
}
async function prepared(){
 const {descriptor,mediaPointer,cacheStorage}=await stage();
 const paired=await root.KGRestrictedPacks.prepare({
   ownerId:OWNER,language:'my',policyRecord:record,
   content:candidate.content,mediaPlan:candidate.mediaPlan,
   mediaPointer,sentenceScope:scope,cryptoApi,packageId:NONCE,checkedAt:T+1000,
 });
 return {paired,mediaPointer,descriptor,cacheStorage};
}
const verify=(paired,changed={})=>root.KGRestrictedPacks.verify({
 ownerId:OWNER,language:'my',policyRecord:record,
 pointer:paired.pointer,body:paired.body,cryptoApi,checkedAt:T+1500,...changed,
});
const plain=v=>JSON.parse(JSON.stringify(v));
test('Text and private media prepare as one strictly granted owner-bound bundle',async()=>{
 const {paired}=await prepared();
 const out=await verify(paired);
 assert.deepEqual(plain(out[TT.languages].map(x=>x.code)),['my']);
 assert.deepEqual(plain(out[TT.topics].map(x=>x.id)),['food']);
 assert.deepEqual(plain(out[TT.vocabulary].map(x=>x.id)),[WORD]);
 assert.deepEqual(plain(out[TT.sentences].map(x=>x.id)),[SENT]);
 assert.equal(out[TT.settings].length,1);
 assert(!JSON.stringify(out).includes('Never reveal this friend'));
 assert(!JSON.stringify(out).includes('another@example.invalid'));
 assert(!JSON.stringify(out).includes('secret.jpg'));
 assert.equal(out[TT.vocabulary][0].image_filename,null);
 assert.equal(paired.pointer.kind,'kg-restricted-pack');
 assert.equal(paired.pointer.ownerId,OWNER);
 assert.equal(paired.pointer.revision,5);
 assert.equal(paired.pointer.sourceKeys.length,candidate.mediaPlan.length);
 assert.equal(paired.pointer.contentHash.length,64);
 assert(!JSON.stringify(paired).includes('token='));
 assert(!JSON.stringify(paired).includes('vocabulary-assets'));
 const keys=root.KGRestrictedPacks.keys(OWNER,'my');
 assert(keys.active.startsWith('restricted-active:'));
 assert(keys.payloadPrefix.startsWith('restricted-body:'+OWNER+':my:'));
});
test('Fresh same-revision grant refresh permits saved bundle; revoked or changed grant never does',async()=>{
 const {paired}=await prepared();
 const fresh=root.KGOfflineAccess.fromServer(policy,OWNER,T+5000,record).record;
 assert.equal((await verify(paired,{policyRecord:fresh,checkedAt:T+5001}))[TT.topics].length,1);
 const changed=root.KGOfflineAccess.fromServer({
   ...policy,revision:6,topics:[],
 },OWNER,T+5000,record).record;
 await assert.rejects(verify(paired,{policyRecord:changed,checkedAt:T+5001}),
   /Restricted pack denied/);
 await assert.rejects(verify(paired,{ownerId:OTHER}),/Restricted pack denied/);
 await assert.rejects(verify(paired,{language:'ja'}),/Restricted pack denied/);
 await assert.rejects(verify(paired,{checkedAt:T+25*3600*1000}),/Restricted pack denied/);
});
test('Tampered content, missing source, wrong table, public picture or forged scope are refused',async()=>{
 const {paired}=await prepared();
 const mutate=fn=>{
   const change=plain(paired);
   fn(change);return change;
 };
 const invalid=[
   mutate(p=>{p.body.content[TT.topics].push({id:'friends_names'});}),
   mutate(p=>{p.body.content[TT.vocabulary][0].image_filename='https://unreviewed.example/asset.png';}),
   mutate(p=>{p.body.content[TT.vocabulary].push({id:PRIVATE,topic_id:'friends_names'});}),
   mutate(p=>{p.body.content[TT.settings].push({key:'private_lessons',value:'hidden'});}),
   mutate(p=>{p.body.content[TT.sentences][0].group_name='private_group';}),
   mutate(p=>{p.body.content[TT.vocabularyTranslations]=[];}),
   mutate(p=>{p.pointer.contentHash='a'.repeat(64);}),
   mutate(p=>{p.pointer.sourceKeys=[];}),
   mutate(p=>{p.pointer.ownerId=OTHER;}),
   mutate(p=>{p.pointer.mediaPointer.grants='{"mode":"legacy"}';}),
 ];
 for(const changed of invalid)
   await assert.rejects(verify(changed),/Restricted pack denied/);
});
test('Preparing with wrong account, denied topics, missing translations or tampered media fails closed',async()=>{
 const {mediaPointer}=await stage();
 const parameters={
   ownerId:OWNER,language:'my',policyRecord:record,content:candidate.content,
   mediaPlan:candidate.mediaPlan,mediaPointer,sentenceScope:scope,
   cryptoApi,packageId:NONCE,checkedAt:T+1000,
 };
 for(const change of [
   {ownerId:OTHER},{language:'ja'},
   {mediaPointer:{...mediaPointer,sourceKeys:[]}},
   {mediaPointer:{...mediaPointer,ownerId:OTHER}},
   {content:{...candidate.content,[TT.topics]:[{id:'friends_names'}]}},
   {content:{...candidate.content,[TT.vocabularyTranslations]:[]}},
   {mediaPlan:[...candidate.mediaPlan,{...candidate.mediaPlan[0]}]},
   {policyRecord:{...record,snapshot:{...record.snapshot,server_enforced:false}}},
 ]){
   await assert.rejects(root.KGRestrictedPacks.prepare({...parameters,...change}),
     /Restricted pack denied/);
 }
});
test('Actual Query.execute uses only validated restricted bundle, NEVER a previously saved broad pack',async()=>{
 const runtime=await fs.readFile(new URL('../../offline/runtime.js',import.meta.url),'utf8');
 const start=runtime.indexOf('  class Query {');
 const end=runtime.indexOf('\n  function makeRows(',start);
 assert(start>0&&end>start);
 const code=runtime.slice(start,end);
 const {paired}=await prepared();
 const valid=await verify(paired);
 const calls={restricted:0,oldPack:0,remote:0};
 const s={
   studyLanguage:'my',unified:true,navigator:{onLine:false},
   CONTENT_TABLES:new Set(Object.values(TT)),PERSONAL_TABLES:new Set(['kg_chart_user_ratings']),
   WRITABLE_TABLES:new Set([]),TABLES:TT,packs:new Map([['my',{data:src}]]),
   U3D1_OFFLINE_ACCESS_ENABLED:true,U3D3B_RESTRICTED_PACKS_ENABLED:true,
   legacyAccessReady:()=>false,effectiveAccess:()=>({state:'restricted_pending'}),
   readRestrictedBundle:async lang=>{calls.restricted++;if(lang!=='my')throw Error('Different language');return {content:valid};},
   canUseLocal:()=>true,currentEnrollment:()=>true,studyLanguage:'my',
   selectRows:async()=>{calls.oldPack++;throw Error('Forbidden broad legacy pack');},
   accessDenied:()=>({message:'held'}),problem:(m,code)=>({message:m,code}),
   offlineError:()=>({message:'offline'}),matches:(r,filters)=>filters.every(([,k,v])=>r[k]===v),
   enrich:(table,rows,nested,all)=>rows.map(r=>({...r,translations:
     table===TT.topics?all[TT.topicTranslations].filter(t=>t.topic_id===r.id):
     table===TT.vocabulary?all[TT.vocabularyTranslations].filter(t=>t.vocabulary_id===r.id):[]})),
 };
 const Query=vm.runInNewContext(code+'\nQuery',s);
 const remote={select(){calls.remote++;return this;},eq(){return this;},
   then(){calls.remote++;throw Error('Remote read forbidden');}};
 const a=await new Query(TT.topics,remote).select('*').execute();
 const b=await new Query(TT.vocabulary,remote).select('*, translations:kg_chart_vocabulary_translations(*)').execute();
 assert.equal(a.error,null);
 assert.deepEqual(plain(a.data.map(x=>x.id)),['food']);
 assert.deepEqual(plain(b.data.map(x=>x.id)),[WORD]);
 assert.deepEqual(plain(b.data[0].translations.map(x=>x.vocabulary_id)),[WORD]);
 assert.equal(calls.restricted,2);
 assert.equal(calls.oldPack,0);
 const missing=await new Query(TT.topics,remote).eq('language_code','ja').execute();
 assert.equal(missing.error.code,'KG_RESTRICTED_PACK_NOT_READY');
 const personal=await new Query('kg_chart_user_ratings',remote).execute();
 assert.equal(personal.error.message,'held');
 const onlineCtx={...s,navigator:{onLine:true}};
 const OnlineQuery=vm.runInNewContext(code+'\nQuery',onlineCtx);
 const online=await new OnlineQuery(TT.topics,remote).execute();
 assert.equal(online.error.message,'held');
 assert.equal(calls.oldPack,0);
});
test('Install/rollback code uses atomic account-scoped KV pointer swap and leaves outbox untouched',async()=>{
 const rt=await fs.readFile(new URL('../../offline/runtime.js',import.meta.url),'utf8');
 const install=rt.slice(rt.indexOf('  async function installRestrictedBundle(language) {'),
   rt.indexOf('  async function restorePreviousRestrictedBundle(language) {'));
 assert.match(rt,/const U3D3B_RESTRICTED_PACKS_ENABLED = false/);
 assert.match(rt,/const U3D3A_OUTBOX_HOLD_ENABLED = false/);
 assert.match(rt,/const DB_NAME = 'kg-chart-offline-v1'/);
 assert.match(rt,/const DB_VERSION = 1/);
 assert.match(install,/assembleRestrictedCandidate\(language\)/);
 assert.match(install,/stagePrivateMedia\(\{/);
 assert.match(install,/preparePrivateMediaActivation\(\{/);
 assert.match(install,/KGRestrictedPacks.prepare\(\{/);
 assert.match(install,/await refreshVerifiedAccess\(\);guard\(\)/);
 assert.match(install,/await transact\(\['kv'\],tx=>\{/);
 assert.match(install,/const policyReq=kv.get\(policyKey\(id\)\)/);
 assert.match(install,/kv.put\(bundle.body,k.payloadPrefix\+bundle.pointer.packageId\)/);
 assert.match(install,/kv.put\(bundle.pointer,k.active\)/);
 assert.match(install,/kv.put\(old,k.previous\)/);
 assert(!install.includes("outbox').delete("));
 assert(!install.includes('caches.delete('));
 assert(!install.includes("kv.delete('active:"));
 const build=await fs.readFile(new URL('../build-offline.mjs',import.meta.url),'utf8');
 assert(build.includes("'offline/restricted-packs.js', 'js/offline-restricted-packs.js'"));
 assert(build.includes('<script src="./js/offline-restricted-packs.js"></script><script src="./js/offline-restricted-sync.js"></script><script src="./js/offline-device-acceptance.js"></script><script src="./js/offline-runtime.js"></script>'));
});
