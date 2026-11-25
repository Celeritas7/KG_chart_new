import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';

const learner=await fs.readFile(new URL('../../js/kg-learner-access.js',import.meta.url),'utf8');
const module=await fs.readFile(new URL('../../offline/access-policy.js',import.meta.url),'utf8');
const runtime=await fs.readFile(new URL('../../offline/runtime.js',import.meta.url),'utf8');
const build=await fs.readFile(new URL('../build-offline.mjs',import.meta.url),'utf8');
const html=await fs.readFile(new URL('../../index.html',import.meta.url),'utf8');
const root={};
vm.runInNewContext(learner, {window:root});
vm.runInNewContext(module, {window:root});
const api=root.KGOfflineAccess;
const OWNER='10000000-0000-4000-8000-000000000001';
const OTHER='20000000-0000-4000-8000-000000000002';
const T=1772000000000;
const legacy={
  contract:1,mode:'legacy',revision:0,server_enforced:false,
  languages:null,topics:null,features:null,
};
const restricted={
  contract:1,mode:'restricted',revision:5,server_enforced:true,
  languages:['my'],
  topics:[{language_code:'my',topic_id:'food'}],
  features:['chart','quiz.words','offline.pack'],
};

test('Verified legacy snapshot retains account, mode and revision without exposing identity or secrets',()=>{
  const r=api.fromServer(legacy,OWNER,T);
  assert.equal(r.view.state,'legacy');
  assert.equal(r.record.ownerId,OWNER);
  assert.equal(r.record.snapshot.mode,'legacy');
  assert.equal(r.record.checkedAt,T);
  assert.equal(r.record.snapshot.languages,null);
  assert.equal(api.fromCache(r.record,OWNER,T+1000).state,'legacy');
  assert.equal(api.mayUseLegacyPack(r.view,OWNER),true);
  assert.equal(api.mayUseLegacyPack(r.view,OTHER),false);
  assert.equal(api.mayUseLegacyPack({...r.view,ownerId:OTHER},OWNER),false);
  for(const secret of ['email','access_token','refresh_token','service_role','signedUrl'])
    assert.equal(JSON.stringify(r.record).includes(secret),false);
});

test('Restricted profile fails closed for offline pack/download/sync even if server grants offline.pack',()=>{
  const r=api.fromServer(restricted,OWNER,T);
  assert.equal(r.view.state,'restricted_pending');
  assert.equal(r.view.reason,'restricted_offline_pack_not_authorized');
  assert.equal(r.record.snapshot.server_enforced,true);
  assert.equal(api.mayUseLegacyPack(r.view,OWNER),false);
  assert.equal(api.fromCache(r.record,OWNER,T+1000).state,'restricted_pending');
  assert.equal(api.mayUseLegacyPack(api.fromCache(r.record,OWNER,T+1000),OWNER),false);
});

test('Malformed, unverified, missing or untrusted policy claims never become legacy',()=>{
  const malformed=[
    null,{},false,
    {...restricted,server_enforced:false},
    {...restricted,topics:[{language_code:'ja',topic_id:'food'}]},
    {...restricted,languages:['my',null]},
    {...restricted,mode:'administrator'},
    {...legacy,languages:[]},
  ];
  for(const raw of malformed){
    const value=api.fromServer(raw,OWNER,T);
    assert.equal(value.view.state,'blocked',JSON.stringify(raw));
    assert.equal(value.record,null);
  }
  assert.equal(api.fromServer(legacy,'wrong-owner',T).view.state,'blocked');
  assert.equal(api.fromServer(legacy,OWNER,-1).view.state,'blocked');
});

test('Cache cannot be loaded by another owner or after expiry/future-clock drift',()=>{
  const {record}=api.fromServer(legacy,OWNER,T);
  assert.equal(api.fromCache(record,OTHER,T).state,'blocked');
  assert.equal(api.fromCache({...record,ownerId:OTHER},OWNER,T).state,'blocked');
  assert.equal(api.fromCache(record,OWNER,T+api.MAX_AGE_MS+1).reason,'offline_policy_expired');
  assert.equal(api.fromCache(record,OWNER,T-121000).reason,'offline_policy_expired');
  assert.equal(api.fromCache(null,OWNER,T).state,'blocked');
  assert.equal(api.fromCache({...record,snapshot:{...record.snapshot,mode:'restricted'}},OWNER,T).state,'blocked');
  assert.equal(api.fromCache({...record,checkedAt:'now'},OWNER,T).state,'blocked');
});

test('Revision rollback, equal-revision scope changes and corrupt prior snapshot fail closed',()=>{
  const previous=api.fromServer(restricted,OWNER,T).record;
  const lower=api.fromServer({...restricted,revision:4},OWNER,T+3000,previous);
  assert.equal(lower.record,null);
  assert.equal(lower.view.reason,'policy_revision_rollback');
  const conflicting=api.fromServer({...restricted,topics:[{language_code:'my',topic_id:'friends_names'}]},OWNER,T+3000,previous);
  assert.equal(conflicting.view.reason,'same_revision_policy_changed');
  const invalid=api.fromServer({...restricted,revision:6},OWNER,T+3000,{...previous,ownerId:OTHER});
  assert.equal(invalid.view.reason,'previous_policy_invalid');
  const newGrant=api.fromServer({...restricted,revision:6,topics:[]},OWNER,T+3000,previous);
  assert.equal(newGrant.view.state,'restricted_pending');
  assert.equal(newGrant.record.snapshot.revision,6);
  const rollbackToLegacy=api.fromServer({...legacy,revision:7},OWNER,T+5000,newGrant.record);
  assert.equal(rollbackToLegacy.view.state,'legacy');
  assert.equal(api.fromCache(rollbackToLegacy.record,OWNER,T+5001).state,'legacy');
});

test('Snapshot canonicalization is deterministic and does not accept same-revision reorder as grant change',()=>{
  const raw={...restricted,languages:['my','ja'],topics:[
    {language_code:'my',topic_id:'food'},
    {language_code:'ja',topic_id:'animals'},
  ],features:['quiz.words','chart']};
  const first=api.fromServer(raw,OWNER,T).record;
  const second=api.fromServer({...raw,languages:['ja','my'],
    topics:[...raw.topics].reverse(),features:['chart','quiz.words']},OWNER,T+1000,first);
  assert.equal(second.view.state,'restricted_pending');
  assert.deepEqual(JSON.parse(JSON.stringify(first.snapshot)),JSON.parse(JSON.stringify(second.record.snapshot)));
});

test('All U3D1 runtime controls are source-disabled and preserve original DB/outbox/cache identities',()=>{
  assert.match(runtime,/const U3D1_OFFLINE_ACCESS_ENABLED = false/);
  assert.match(html,/const U3C1_SCOPED_UI_ENABLED = false/);
  assert.match(runtime,/const DB_NAME = 'kg-chart-offline-v1'/);
  assert.match(runtime,/const DB_VERSION = 1/);
  assert.match(runtime,/const SCHEMA_VERSION = 1/);
  assert.match(runtime,/kv\.put\(result\.next,key\)/);
  assert.match(runtime,/out\.put\(event\)/);
  assert.match(runtime,/if\(U3D1_OFFLINE_ACCESS_ENABLED\)/);
  assert.match(runtime,/live\.rpc\('kg_chart_u3_my_access_snapshot'\)/);
  const verified=runtime.indexOf('const user=await fetchOwner();guard();');
  const snapshot=runtime.indexOf("live.rpc('kg_chart_u3_my_access_snapshot')");
  assert(verified>=0&&snapshot>verified,'server-auth identity check must precede policy retrieval');
  assert.match(runtime,/!legacyAccessReady\(\)\)return \{data:null,error:accessDenied\(\)\}/);
  assert.match(runtime,/await refreshVerifiedAccess\(\);guard\(\)/);
  assert.match(runtime,/worker\?\.postMessage\(\{type:'KG_OFFLINE_LOCK'\}\)/);
  assert.match(runtime,/restricted packs are not activated/);
});

test('Both offline and unified shells bundle policy parser before runtime without changing source UI',()=>{
  assert(build.includes("'offline/access-policy.js', 'js/offline-policy.js'"));
  assert(build.includes('<script src="./js/offline-policy.js"></script><script src="./js/offline-scoped-pack.js"></script><script src="./js/offline-runtime.js"></script>'));
  assert(build.indexOf("'offline/access-policy.js'")<build.indexOf("'offline/runtime.js'"));
  assert.equal((runtime.match(/const U3D1_OFFLINE_ACCESS_ENABLED = false/g)||[]).length,1);
});
