import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
const root={};
for(const path of ['js/kg-learner-access.js','offline/access-policy.js','offline/access-outbox.js']){
  const source=await fs.readFile(new URL('../../'+path,import.meta.url),'utf8');
  vm.runInNewContext(source,{window:root});
}
const api=root.KGAccessOutbox;
const UID='10000000-0000-4000-8000-000000000001';
const OTHER='20000000-0000-4000-8000-000000000002';
const WORD='30000000-0000-4000-8000-000000000003';
const SESSION='40000000-0000-4000-8000-000000000004';
const NOW=1785000000000;
const snapshot={contract:1,mode:'restricted',revision:8,server_enforced:true,
 languages:['my'],topics:[{language_code:'my',topic_id:'food'}],
 features:['chart','progress','quiz.words']};
const record=root.KGOfflineAccess.fromServer(snapshot,UID,NOW).record;
const tables=api.TABLES;
const copy=o=>JSON.parse(JSON.stringify(o));
const e=(n,table,row,opts={})=>({
  id:('50000000-0000-4000-8000-'+String(n).padStart(12,'0')),
  ownerId:UID,table,kind:'upsert',row:{user_id:UID,...row},
  filters:[],state:'pending',permissionRevision:8,at:new Date(NOW).toISOString(),...opts,
});
const examples=[
 e(1,tables.ratings,{vocabulary_id:WORD,language_code:'my',rating:4}),
 e(2,tables.completions,{language_code:'my',topic_id:'food'}),
 e(3,tables.completions,{language_code:'my',topic_id:'private_names'}),
 e(4,tables.sessions,{id:SESSION,language_code:'my',topic_id:'food',quiz_type:'native_to_image'}),
 e(5,tables.answers,{session_id:SESSION,vocabulary_id:WORD}),
 e(6,tables.levels,{email:'student@example.invalid',language_code:'my',level:2}),
 e(7,tables.prefs,{audio_voice:'f'}),
 e(8,tables.sessions,{language_code:'ja',topic_id:'food'}, {permissionRevision:8}),
 e(9,tables.completions,{language_code:'my',topic_id:'food'},{permissionRevision:7}),
 e(10,tables.ratings,{vocabulary_id:WORD,language_code:'my'},{permissionRevision:undefined}),
];
test('Current restricted owner gets count-only, all-held report, never an upload authorization',()=>{
 const result=api.analyzeOutbox({ownerId:UID,policyRecord:record,events:examples,checkedAt:NOW+1000});
 assert.equal(result.contract,1);
 assert.equal(result.mode,'hold');
 assert.equal(result.held,10);
 assert.equal(result.total,10);
 assert.equal(result.policyRevision,8);
 assert.equal(result.publishable,false);
 assert.equal(result.reasonCounts.source_not_verified,1);
 assert.equal(result.reasonCounts.session_not_verified,1);
 assert.equal(result.reasonCounts.topic_not_granted,1);
 assert.equal(result.reasonCounts.language_not_granted,1);
 assert.equal(result.reasonCounts.revision_changed,1);
 assert.equal(result.reasonCounts.legacy_untagged,1);
 assert.equal(result.reasonCounts.requires_server_review,4);
 assert.equal(result.tableCounts[tables.ratings],2);
 assert.equal(JSON.stringify(result).includes('student@example.invalid'),false);
 for(const privateValue of [UID,WORD,SESSION,'private_names','audio_voice','native_to_image'])
   assert(!JSON.stringify(result).includes(privateValue),'report exposed row or owner');
});
test('Historical untagged events are never assigned the current revision or uploaded',()=>{
 const item=e(12,tables.completions,{language_code:'my',topic_id:'food'});
 delete item.permissionRevision;
 const before=JSON.stringify(item);
 const result=api.analyzeOutbox({ownerId:UID,policyRecord:record,events:[item],checkedAt:NOW+4000});
 assert.equal(result.reasonCounts.legacy_untagged,1);
 assert.equal(result.held,1);
 assert.equal(JSON.stringify(item),before);
 assert.equal('permissionRevision' in item,false);
});
test('Changed grants hold old-revision events without dropping any original answer or queue ID',()=>{
 const newer=root.KGOfflineAccess.fromServer({
  ...snapshot,revision:9,topics:[],
 },UID,NOW+2000,record).record;
 const queue=copy(examples);
 const before=JSON.stringify(queue);
 const result=api.analyzeOutbox({ownerId:UID,policyRecord:newer,events:queue,checkedAt:NOW+2001});
 assert.equal(result.held,queue.length);
 assert.equal(result.reasonCounts.revision_changed,9);
 assert.equal(result.reasonCounts.legacy_untagged,1);
 assert.equal(JSON.stringify(queue),before);
});
test('Wrong account and malformed/duplicated ID cannot cause any event to be published',()=>{
 const wrong=e(20,tables.ratings,{vocabulary_id:WORD,language_code:'my'},{ownerId:OTHER});
 const malformed={...e(21,tables.ratings,{vocabulary_id:WORD,language_code:'my'}),row:null};
 const duplicated=e(22,tables.ratings,{vocabulary_id:WORD,language_code:'my'});
 const out=api.analyzeOutbox({ownerId:UID,policyRecord:record,
  events:[wrong,malformed,duplicated,duplicated],checkedAt:NOW+200});
 assert.equal(out.held,4);
 assert.equal(out.reasonCounts.wrong_account,1);
 assert.equal(out.reasonCounts.invalid_event,2);
 assert.equal(out.reasonCounts.source_not_verified,1);
});
test('Missing, wrong-owner, stale or forged snapshots always hold all queued work',()=>{
 const wrong={...record,ownerId:OTHER};
 for(const policyRecord of [null,wrong,
  {...record,snapshot:{...record.snapshot,server_enforced:false}}]){
  const out=api.analyzeOutbox({ownerId:UID,policyRecord,events:examples,checkedAt:NOW+1000});
  assert.equal(out.reason,'unverified_policy');
  assert.equal(out.held,examples.length);
  assert.equal(out.reasonCounts.unverified_policy,examples.length);
 }
 const expired=api.analyzeOutbox({ownerId:UID,policyRecord:record,events:examples,checkedAt:NOW+25*3600*1000});
 assert.equal(expired.held,examples.length);
 assert.equal(expired.reason,'unverified_policy');
});
test('Unknown tables, missing source mappings and ambiguous session answers stay held',()=>{
 const unrecognized=e(34,'kg_chart_admin_secret',{language_code:'my'});
 const answer=e(35,tables.answers,{session_id:SESSION,vocabulary_id:WORD});
 const report=api.analyzeOutbox({ownerId:UID,policyRecord:record,events:[unrecognized,answer],checkedAt:NOW+100});
 assert.equal(report.held,2);
 assert.equal(report.reasonCounts.unknown_table,1);
 assert.equal(report.reasonCounts.session_not_verified,1);
});
test('Malformed or oversized inventories produce safe bounded blocked report',()=>{
 const out=api.analyzeOutbox({ownerId:OTHER,policyRecord:record,events:null,checkedAt:NOW});
 assert.equal(out.mode,'hold');
 assert.equal(out.reason,'invalid_inventory');
 assert.equal(out.publishable,false);
 assert(!JSON.stringify(out).includes(UID));
 const large=api.analyzeOutbox({ownerId:UID,policyRecord:record,events:Array(100001).fill({}),checkedAt:NOW});
 assert.equal(large.reason,'invalid_inventory');
});
test('Restricted auto-sync is preflight-HOLD: no writes, deletions, pull or level RPC',async()=>{
 const runtime=await fs.readFile(new URL('../../offline/runtime.js',import.meta.url),'utf8');
 const start=runtime.indexOf('  async function doSync() {');
 const end=runtime.indexOf('\n  async function sync() {',start);
 assert(start>0 && end>start);
 const code=runtime.slice(start,end);
 const calls={audit:0,remote:0,delete:0,update:0};
 const ctx={
  syncing:false,busy:false,navigator:{onLine:true},
  currentEnrollment:()=>true,
  accountGuard:()=>()=>{},
  notify:()=>{},
  U3D1_OFFLINE_ACCESS_ENABLED:true,U3D3A_OUTBOX_HOLD_ENABLED:true,
  refreshVerifiedAccess:async()=>({state:'restricted_pending'}),
  legacyAccessReady:()=>false,
  auditRestrictedQueue:async()=>{calls.audit++;return {held:7,publishable:false};},
  fetchOwner:async()=>{calls.remote++;throw Error('No remote allowed');},
  syncEvent:async()=>{calls.remote++;throw Error('No upload allowed');},
  outbox:async()=>{calls.remote++;throw Error('No queue iteration allowed');},
  pullRemote:async()=>{calls.remote++;throw Error('No cloud pull allowed');},
  updatePending:async()=>{calls.update++;},
  get:async()=>{calls.remote++;throw Error('No level check allowed');},
  transact:async()=>{calls.delete++;throw Error('No deletions allowed');},
 };
 const sync=vm.runInNewContext(code+'\ndoSync;',ctx);
 await sync();
 assert.equal(ctx.syncing,false);
 assert.equal(ctx.syncError,'Permission review: 7 pending change(s) retained locally. No restricted changes uploaded.');
 assert.deepEqual(calls,{audit:1,remote:0,delete:0,update:1});
});
test('Source-only rollout guard: all legacy gates and U3D3A are OFF, DB/outbox schema unchanged',async()=>{
 const runtime=await fs.readFile(new URL('../../offline/runtime.js',import.meta.url),'utf8');
 const build=await fs.readFile(new URL('../build-offline.mjs',import.meta.url),'utf8');
 const html=await fs.readFile(new URL('../../index.html',import.meta.url),'utf8');
 for(const flag of ['U3D1_OFFLINE_ACCESS_ENABLED','U3D2_SCOPED_PACK_PREVIEW_ENABLED',
  'U3D2B1_PRIVATE_MEDIA_STAGE_ENABLED','U3D2B2_PRIVATE_OFFLINE_PLAYBACK_ENABLED','U3D3A_OUTBOX_HOLD_ENABLED'])
  assert(runtime.includes('const '+flag+' = false;'),flag);
 assert.match(html,/const U3C1_SCOPED_UI_ENABLED = false/);
 assert.match(runtime,/const DB_NAME = 'kg-chart-offline-v1'/);
 assert.match(runtime,/const DB_VERSION = 1/);
 assert.match(runtime,/const SCHEMA_VERSION = 1/);
 assert.match(runtime,/out\.put\(event\)/);
 assert.match(runtime,/await auditRestrictedQueue\(\)/);
 assert.match(runtime,/window\.KGAccessOutbox\?\.analyzeOutbox/);
 assert.match(runtime,/permissionRevision:policyRevision/);
 assert.match(runtime,/syncError='Permission review:/);
 assert.match(runtime,/No syncEvent/);
 assert(build.includes("'offline/access-outbox.js', 'js/offline-access-outbox.js'"));
 assert(build.includes('<script src="./js/offline-access-outbox.js"></script><script src="./js/offline-runtime.js"></script>'));
 const unsafe=['indexedDB.deleteDatabase','caches.deleteAll','serviceWorker.unregister','DELETE FROM'];
 for(const tag of unsafe)assert(!runtime.includes(tag),tag);
});
