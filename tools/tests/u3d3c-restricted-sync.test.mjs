import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const root={};
for(const filename of ['js/kg-learner-access.js','js/kg-sentence-access.js',
  'offline/access-policy.js','offline/restricted-sync.js']){
  vm.runInNewContext(await fs.readFile(new URL('../../'+filename,import.meta.url),'utf8'),
    {window:root});
}
const API=root.KGRestrictedSync,uid='10000000-0000-4000-8000-000000000001';
const OTHER='20000000-0000-4000-8000-000000000002';
const WORD='30000000-0000-4000-8000-000000000003';
const SECRET='30000000-0000-4000-8000-000000000004';
const SESSION='40000000-0000-4000-8000-000000000005';
const SENTENCE='50000000-0000-4000-8000-000000000006';
const TIME=1785000000000;
const snapshot={contract:1,mode:'restricted',revision:7,server_enforced:true,
 languages:['my'],topics:[{language_code:'my',topic_id:'food'}],
 features:['chart','quiz.words','quiz.sentences','quiz.speak']};
const access=root.KGOfflineAccess,learner=root.KGLearnerAccess;
const policyRecord=access.fromServer(snapshot,uid,TIME).record;
const rp=API.TABLE;
const evt=(i,table,row,opts={})=>({
 id:'60000000-0000-4000-8000-'+String(i).padStart(12,'0'),
 ownerId:uid,table,kind:'insert',permissionRevision:7,filters:[],row,
 sequence:i,at:'2026-11-25T00:00:00.000Z',state:'pending',...opts,
});
const session={id:SESSION,user_id:uid,language_code:'my',
 topic_id:'food',quiz_type:'native_to_image',total_questions:2,correct_answers:1};
const sentenceSession={...session,quiz_type:'sentence_to_meaning'};
const rating=evt(1,rp.ratings,{user_id:uid,language_code:'my',
 vocabulary_id:WORD,rating:4},{kind:'upsert'});
const completion=evt(2,rp.completions,{user_id:uid,language_code:'my',
 topic_id:'food',completed_at:'2026-11-25T01:00:00.000Z'},{kind:'upsert'});
const quiz=evt(3,rp.sessions,session);
const answer=evt(4,rp.answers,{id:'70000000-0000-4000-8000-000000000008',
 session_id:SESSION,vocabulary_id:WORD,is_correct:true,answered_at:'2026-11-25T01:00:00.000Z'});
const sentenceAnswer=evt(5,rp.answers,{id:'70000000-0000-4000-8000-000000000009',
 session_id:SESSION,sentence_id:SENTENCE,is_correct:true});
const rows={
 kg_chart_vocabulary:[{id:WORD,topic_id:'food'},{id:SECRET,topic_id:'private_names'}],
 kg_chart_quiz_sessions:[session],
 kg_chart_sentences:[{id:SENTENCE,language_code:'my',group_name:'food_lines'}],
};
const groupData={contract:1,mode:'restricted',language_code:'my',
 server_enforced:true,groups:[{group_name:'food_lines',topic_id:'food'}]};
function fakeClient({deny=[],errors=[],database=rows,groups=groupData}={}){
 const calls=[];
 return {calls,
  async rpc(name,args){
   calls.push(['rpc',name,args]);
   if(errors.includes(name))return {data:null,error:{message:'RPC not deployed'}};
   if(name==='kg_chart_u3c2_my_sentence_groups')
     return {data:groups,error:null};
   return {data:deny.includes(name)?false:true,error:null};
  },
  from(name){
   calls.push(['from',name]);
   const filters={};
   const q={
     select(cols){calls.push(['select',cols]);return q;},
     eq(k,v){filters[k]=v;return q;},
     async maybeSingle(){
       calls.push(['read',name,{...filters}]);
       const found=(database[name]||[]).find(row=>
         Object.entries(filters).every(([k,v])=>row[k]===v));
       return {data:found||null,error:null};
     },
   };
   return q;
  },
 };
}
const verify=(event,client,options={})=>API.authorize({
 event,ownerId:uid,policyRecord,client,clock:()=>TIME+500,
 offlineAccess:access,learnerAccess:learner,
 sentenceAccess:root.KGSentenceAccess,...options,
});
test('Verified restricted rating requires live private+mode RPC and source topic membership',async()=>{
 const c=fakeClient(),before=JSON.stringify(rating);
 const result=await verify(rating,c);
 assert.equal(result.approved,true);
 assert.equal(result.revision,7);
 assert.equal(JSON.stringify(rating),before);
 assert(c.calls.some(x=>x[1]==='kg_chart_u3b2_can_rating'));
 assert(c.calls.some(x=>x[1]==='kg_chart_u3b3b1_can_private_rating'));
 assert(c.calls.some(x=>x[1]==='kg_chart_vocabulary'));
 assert.equal((await verify(rating,fakeClient({deny:['kg_chart_u3b3b1_can_private_rating']}))).approved,false);
 assert.equal((await verify(rating,fakeClient({database:{...rows,
   kg_chart_vocabulary:[{id:WORD,topic_id:'private_names'}]}}))).reason,
   'server_word_scope_denied');
});
test('Topic completion requires exact topic grant and two current server/RLS checks',async()=>{
 const c=fakeClient();
 assert.equal((await verify(completion,c)).approved,true);
 assert(c.calls.some(x=>x[1]==='kg_chart_u3b2_can_completion'));
 assert(c.calls.some(x=>x[1]==='kg_chart_u3b3b1_can_private_session'));
 assert.equal((await verify(evt(12,rp.completions,{
  user_id:uid,language_code:'my',topic_id:'private_names'},{kind:'upsert'}),c)).approved,false);
 assert.equal((await verify(completion,fakeClient({errors:['kg_chart_u3b2_can_completion']}))).reason,
 'server_completion_denied');
});
test('Current word quiz session and answer verify server session ownership, source and mode',async()=>{
 const c=fakeClient();
 assert.equal((await verify(quiz,c)).approved,true);
 assert.equal((await verify(answer,c)).approved,true);
 assert(c.calls.some(x=>x[1]==='kg_chart_u3b2_can_answer'));
 assert(c.calls.some(x=>x[1]==='kg_chart_u3b3b1_can_private_answer'));
 const mixed=evt(11,rp.answers,{...answer.row,vocabulary_id:SECRET});
 assert.equal((await verify(mixed,c)).approved,false);
 const wrongParent=fakeClient({database:{...rows,kg_chart_quiz_sessions:[
   {...session,user_id:OTHER}]}});
 assert.equal((await verify(answer,wrongParent)).reason,'session_not_server_verified');
});
test('Sentence answers require server-reviewed sentence/group ↔ parent topic proof',async()=>{
 const c=fakeClient({database:{...rows,kg_chart_quiz_sessions:[sentenceSession]}});
 assert.equal((await verify(sentenceAnswer,c)).approved,true);
 assert(c.calls.some(x=>x[1]==='kg_chart_u3c2_can_sentence_group'));
 assert(c.calls.some(x=>x[1]==='kg_chart_u3c2_my_sentence_groups'));
 const badSnapshot=fakeClient({database:{...rows,
   kg_chart_quiz_sessions:[sentenceSession]},
   groups:{...groupData,server_enforced:false}});
 assert.equal((await verify(sentenceAnswer,badSnapshot)).reason,
   'sentence_parent_topic_mismatch');
 const denied=fakeClient({database:{...rows,
   kg_chart_quiz_sessions:[sentenceSession]},
   deny:['kg_chart_u3c2_can_sentence_group']});
 assert.equal((await verify(sentenceAnswer,denied)).reason,'sentence_group_denied');
 const wrongGroup=fakeClient({database:{...rows,
   kg_chart_quiz_sessions:[sentenceSession],
   kg_chart_sentences:[{id:SENTENCE,language_code:'my',group_name:'private_names'}]}});
 assert.equal((await verify(sentenceAnswer,wrongGroup)).approved,false);
});
test('Legacy, wrong account, changed revision, arbitrary table or source never contact server',async()=>{
 const c=fakeClient();
 const variants=[
  {...rating,permissionRevision:undefined},
  {...rating,permissionRevision:6},
  {...rating,ownerId:OTHER},
  {...rating,row:{...rating.row,user_id:OTHER}},
  {...rating,table:'kg_chart_access_profiles'},
  {...rating,row:{...rating.row,forged_column:true}},
  {...rating,kind:'update'},
  {...quiz,row:{...quiz.row,topic_id:null}},
  {...quiz,row:{...quiz.row,topic_id:'private_names'}},
  {...answer,row:{...answer.row,sentence_id:SENTENCE}},
  {...answer,row:{...answer.row,vocabulary_id:null}},
 ];
 for(const e of variants)assert.equal((await verify(e,c)).approved,false);
 assert.equal(c.calls.length,0);
 assert.equal((await verify(rating,c,{ownerId:OTHER})).approved,false);
 assert.equal((await verify(rating,c,{clock:()=>TIME+25*3600*1000})).approved,false);
 assert.equal(c.calls.length,0);
});
test('Source contract refuses unconfirmed server enforcement, even with optimistic RLS-only results',async()=>{
 const c=fakeClient();
 const unverified={...policyRecord,snapshot:{...policyRecord.snapshot,server_enforced:false}};
 const outcome=await verify(rating,c,{policyRecord:unverified});
 assert.equal(outcome.reason,'unverified_current_policy');
 assert.equal(c.calls.length,0);
});
test('Stale answer / session mode cannot cross from word question to sentence question',async()=>{
 const c=fakeClient({database:{...rows,kg_chart_quiz_sessions:[session]}});
 assert.equal((await verify(sentenceAnswer,c)).approved,false);
 const c2=fakeClient({database:{...rows,kg_chart_quiz_sessions:[sentenceSession]}});
 assert.equal((await verify(answer,c2)).approved,false);
 const denied=fakeClient({deny:['kg_chart_u3b2_can_quiz_session']});
 assert.equal((await verify(quiz,denied)).reason,'server_session_denied');
});
test('Reconciler ACKs ONLY server-confirmed current events after two verified fresh revisions',async()=>{
 const c=fakeClient(),events=[quiz,answer,rating,completion];
 const writes=[],acks=[],refreshes=[];
 const result=await API.reconcile({
  events,ownerId:uid,policyRecord,client:c,clock:()=>TIME+400,
  offlineAccess:access,learnerAccess:learner,
  sentenceAccess:root.KGSentenceAccess,
  refresh:async()=>{refreshes.push('refresh');return policyRecord;},
  apply:async e=>{writes.push(e.id);},
  ack:async e=>{acks.push(e.id);},
 });
 assert.equal(result.contract,1);
 assert.equal(result.acknowledged,4);
 assert.equal(result.held,0);
 assert.equal(result.publishable,false);
 assert.deepEqual(acks,writes);
 assert.deepEqual(writes,events.map(x=>x.id));
 assert.equal(refreshes.length,8);
});
test('Denied and untagged historical changes stay queued while unrelated eligible entries ACK',async()=>{
 const c=fakeClient(),held={...rating,permissionRevision:undefined};
 const old={...completion,permissionRevision:6};
 const secure={...rating,row:{...rating.row,vocabulary_id:SECRET}};
 const ack=[];
 const result=await API.reconcile({
   events:[held,quiz,old,secure,answer],ownerId:uid,policyRecord,
   client:c,clock:()=>TIME+100,offlineAccess:access,learnerAccess:learner,
   sentenceAccess:root.KGSentenceAccess,
   refresh:async()=>policyRecord,apply:async()=>{},
   ack:async e=>{ack.push(e.id);},
 });
 assert.equal(result.acknowledged,2);
 assert.equal(result.held,3);
 assert.equal(result.reasonCounts.untagged_legacy,1);
 assert.equal(result.reasonCounts.revision_changed,1);
 assert.equal(result.reasonCounts.server_word_scope_denied,1);
});
test('Change before upload stops without side effects, change after upload leaves retry record',async()=>{
 const c=fakeClient(),next=access.fromServer({
   ...snapshot,revision:8,topics:[],
 },uid,TIME+100,policyRecord).record;
 const first={applies:0,acks:0};
 const blocked=await API.reconcile({
  events:[rating],ownerId:uid,policyRecord,client:c,clock:()=>TIME+101,
  offlineAccess:access,learnerAccess:learner,
  refresh:async()=>next,apply:async()=>{first.applies++;},
  ack:async()=>{first.acks++;},
 });
 assert.equal(blocked.acknowledged,0);
 assert.equal(first.applies,0);assert.equal(first.acks,0);
 assert.equal(blocked.reasonCounts.grant_changed_before_write,1);
 let refreshes=0,applied=0,acknowledged=0;
 const post=await API.reconcile({
  events:[rating],ownerId:uid,policyRecord,client:c,clock:()=>TIME+101,
  offlineAccess:access,learnerAccess:learner,
  refresh:async()=>++refreshes===1?policyRecord:next,
  apply:async()=>{applied++;},ack:async()=>{acknowledged++;},
 });
 assert.equal(applied,1);
 assert.equal(acknowledged,0);
 assert.equal(post.held,1);
 assert.equal(post.reasonCounts.post_write_grant_changed,1);
});
test('Server failed write / missing RPC preserves the original outbox event without optimistic ACK',async()=>{
 const c=fakeClient(),acks=[];
 const result=await API.reconcile({
  events:[rating],ownerId:uid,policyRecord,client:c,
  clock:()=>TIME+101,offlineAccess:access,learnerAccess:learner,
  refresh:async()=>policyRecord,
  apply:async()=>{throw Error('403/409/0 rows affected');},
  ack:async e=>acks.push(e),
 });
 assert.equal(result.acknowledged,0);assert.equal(result.held,1);
 assert.equal(result.reasonCounts.server_write_not_acknowledged,1);
 assert.equal(acks.length,0);
 const missing=fakeClient({errors:['kg_chart_u3b2_can_rating']});
 const denied=await verify(rating,missing);
 assert.equal(denied.approved,false);
});
test('No completed local ACK if confirmation transaction errors or account changes',async()=>{
 let applied=0,acknowledged=0;
 const c=fakeClient();
 const result=await API.reconcile({
  events:[rating],ownerId:uid,policyRecord,client:c,
  clock:()=>TIME+100,offlineAccess:access,learnerAccess:learner,
  refresh:async()=>policyRecord,
  apply:async()=>{applied++;},
  ack:async()=>{acknowledged++;throw Error('IndexedDB transaction aborted');},
 });
 assert.equal(applied,1);assert.equal(acknowledged,1);
 assert.equal(result.acknowledged,0);assert.equal(result.held,1);
 assert.equal(result.reasonCounts.local_ack_not_committed,1);
});
test('Static production gate: restricted ACK is conditional KV+outbox transaction, never uses legacy unguarded loop',async()=>{
 const source=await fs.readFile(new URL('../../offline/runtime.js',import.meta.url),'utf8');
 const build=await fs.readFile(new URL('../build-offline.mjs',import.meta.url),'utf8');
 const html=await fs.readFile(new URL('../../index.html',import.meta.url),'utf8');
 for(const name of ['U3D1_OFFLINE_ACCESS_ENABLED','U3D2_SCOPED_PACK_PREVIEW_ENABLED',
   'U3D2B1_PRIVATE_MEDIA_STAGE_ENABLED','U3D2B2_PRIVATE_OFFLINE_PLAYBACK_ENABLED',
   'U3D3A_OUTBOX_HOLD_ENABLED','U3D3B_RESTRICTED_PACKS_ENABLED',
   'U3D3C_RESTRICTED_SYNC_ENABLED'])
   assert(source.includes('const '+name+' = false;'),name);
 assert.match(html,/const U3C1_SCOPED_UI_ENABLED = false/);
 assert.match(source,/const DB_NAME = 'kg-chart-offline-v1'/);
 assert.match(source,/const DB_VERSION = 1/);
 assert.match(source,/async function syncRestrictedQueue\(\)/);
 assert.match(source,/await transact\(\['kv','outbox'\],tx=>/);
 assert.match(source,/const policyReq=kv\.get\(policyKey\(id\)\)/);
 assert.match(source,/JSON\.stringify\(existing\)!==JSON\.stringify\(event\)/);
 assert.match(source,/disk\.checkedAt!==checked\.checkedAt/);
 assert.match(source,/await syncEvent\(event\);check\(\)/);
 assert.match(source,/await refreshVerifiedAccess\(\);check\(\)/);
 assert.match(source,/if\(U3D3C_RESTRICTED_SYNC_ENABLED\)/);
 assert.match(source,/await syncRestrictedQueue\(\);guard\(\);return/);
 assert.match(source,/const U3D3A_OUTBOX_HOLD_ENABLED = false/);
 assert(build.includes("'offline/restricted-sync.js', 'js/offline-restricted-sync.js'"));
 assert(build.includes('<script src="./js/offline-restricted-sync.js"></script><script src="./js/offline-runtime.js"></script>'));
});
