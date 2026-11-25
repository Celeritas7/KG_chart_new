import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';

const base=new URL('../../',import.meta.url);
const files=['js/kg-learner-access.js','js/kg-sentence-access.js',
  'offline/access-policy.js','offline/scoped-pack.js'];
const root={};
for(const f of files)vm.runInNewContext(await fs.readFile(new URL(f,base),'utf8'),{window:root});
const api=root.KGScopedPack;
const T=1795550000000;
const OWNER='10000000-0000-4000-8000-000000000001';
const OTHER='20000000-0000-4000-8000-000000000002';
const W1='30000000-0000-4000-8000-000000000001';
const W2='30000000-0000-4000-8000-000000000002';
const PRIVATE='40000000-0000-4000-8000-000000000003';
const ANIMAL='40000000-0000-4000-8000-000000000004';
const S1='50000000-0000-4000-8000-000000000001';
const S2='50000000-0000-4000-8000-000000000002';
const C1='60000000-0000-4000-8000-000000000001';
const C2='60000000-0000-4000-8000-000000000002';
const tables=api.TABLES;
const source={
 [tables.languages]:[
  {code:'my',name_english:'Burmese',is_active:true,admin_notes:'SECRET'},
  {code:'ja',name_english:'Japanese',is_active:true},
 ],
 [tables.topics]:[
  {id:'food',icon:'🍜',sort_order:1,notes:'SECRET'},
  {id:'friends_names',icon:'👫',sort_order:2,notes:'secret friends topic'},
  {id:'animals',icon:'🐶',sort_order:3},
 ],
 [tables.topicTranslations]:[
  {topic_id:'food',language_code:'my',title_native:'Food',question_native:'Eat food'},
  {topic_id:'friends_names',language_code:'my',title_native:'Private friends'},
  {topic_id:'animals',language_code:'my',title_native:'Animals'},
  {topic_id:'food',language_code:'ja',title_native:'Japanese food secret'},
 ],
 [tables.vocabulary]:[
  {id:W1,topic_id:'food',english_text:'rice',image_filename:'rice.jpg',
   extra_data:{content_type:'word',staffNotes:'sensitive hidden'}},
  {id:W2,topic_id:'food',english_text:'soup',image_filename:'emoji:🍲',
   extra_data:{colorCode:'#123456',staffNotes:'sensitive hidden'}},
  {id:PRIVATE,topic_id:'friends_names',english_text:'Private Friend',image_filename:'friend.jpg'},
  {id:ANIMAL,topic_id:'animals',english_text:'dog',image_filename:'dog.jpg'},
 ],
 [tables.vocabularyTranslations]:[
  {vocabulary_id:W1,language_code:'my',native_text:'Rice',notes:'rice note'},
  {vocabulary_id:W2,language_code:'my',native_text:'Soup',notes:'soup note'},
  {vocabulary_id:PRIVATE,language_code:'my',native_text:'Never reveal this friend'},
  {vocabulary_id:ANIMAL,language_code:'my',native_text:'dog'},
  {vocabulary_id:W1,language_code:'ja',native_text:'Never reveal Japanese'},
 ],
 [tables.sentences]:[
  {id:S1,language_code:'my',group_name:'food_lines',native_text:'Eat food',
   english_text:'I eat',extra_data:{hidden:'secret'}},
  {id:S2,language_code:'my',group_name:'private_conversation',native_text:'secret sentence'},
 ],
 [tables.colours]:[
  {id:C1,language_code:'my',native_text:'Blue soup',colour_id:W1,noun_id:W2,picture:'🔵'},
  {id:C2,language_code:'my',native_text:'Private friend',colour_id:W1,noun_id:PRIVATE,picture:'🔴'},
 ],
 [tables.settings]:[
  {key:'private_lessons',value:[{emails:['another@example.invalid']}]},
  {key:'unlock_rules',value:{languages:{ja:{secret:'hidden'}}}},
  {key:'admin_bypass_lock',value:true},
 ],
};
const restricted={
 contract:1,mode:'restricted',revision:3,server_enforced:true,languages:['my'],
 topics:[{language_code:'my',topic_id:'food'},{language_code:'my',topic_id:'friends_names'}],
 features:['chart','quiz.words','quiz.sentences','quiz.speak','quiz.colours'],
};
const policyRecord=root.KGOfflineAccess.fromServer(restricted,OWNER,T).record;
const sentenceResponse={
 contract:1,mode:'restricted',server_enforced:true,language_code:'my',
 groups:[{group_name:'food_lines',topic_id:'food'},
  {group_name:'private_conversation',topic_id:'friends_names'}],
};
const privateVisibility={contract:1,topics:['friends_names'],groups:['private_conversation']};
const args={data:source,language:'my',ownerId:OWNER,checkedAt:T+1000,
 policyRecord,sentenceResponse,privateVisibility};
const plain=v=>JSON.parse(JSON.stringify(v));
const compile=overrides=>api.buildScopedPack({...args,...overrides});

test('Granted food topic is copied, while hidden/private/other-language content and freeform metadata are omitted',()=>{
 const x=compile(),body=x.content;
 assert.equal(x.manifest.ownerId,OWNER);
 assert.equal(x.manifest.policyRevision,3);
 assert.equal(x.manifest.mediaVerified,false);
 assert.deepEqual(body[tables.languages].map(x=>x.code),['my']);
 assert.deepEqual(body[tables.topics].map(x=>x.id),['food']);
 assert.deepEqual(body[tables.topicTranslations].map(x=>x.topic_id),['food']);
 assert.deepEqual(body[tables.vocabulary].map(x=>x.id),[W1,W2]);
 assert.deepEqual(body[tables.vocabularyTranslations].map(x=>x.vocabulary_id),[W1,W2]);
 assert.deepEqual(body[tables.sentences].map(x=>x.id),[S1]);
 assert.deepEqual(body[tables.colours].map(x=>x.id),[C1]);
 assert.deepEqual(body[tables.settings].map(x=>x.key),['kg_private_visibility:my']);
 assert.deepEqual(plain(body[tables.settings][0].value),{contract:1,topics:[],groups:[]});
 assert.equal(body[tables.vocabulary][0].image_filename,null);
 assert.equal(body[tables.vocabulary][1].image_filename,'emoji:🍲');
 assert.deepEqual(plain(body[tables.vocabulary][0].extra_data),{content_type:'word'});
 assert.equal(body[tables.sentences][0].extra_data,undefined);
 const joined=JSON.stringify(body);
 for(const secret of ['Never reveal','Private friends','secret friends','@example.invalid',
   'Japanese food secret','admin_bypass_lock','sensitive hidden','secret sentence'])
   assert(!joined.includes(secret),secret+' must not enter restricted pack');
});

test('Media plan includes only source-bound IDs and voices, no shared public hashes, text or URLs',()=>{
 const x=compile();
 const planned=x.mediaPlan;
 assert(planned.some(p=>p.type==='word_image'&&p.id===W1));
 assert(planned.some(p=>p.type==='word_audio'&&p.id===W1&&p.voice==='f'));
 assert(planned.some(p=>p.type==='topic_audio'&&p.topicId==='food'&&p.voice==='m'));
 assert(planned.some(p=>p.type==='sentence_audio'&&p.id===S1&&p.groupName==='food_lines'));
 assert(planned.some(p=>p.type==='colour_audio'&&p.id===C1));
 assert(!planned.some(p=>p.id===PRIVATE||p.id===S2||p.id===C2||p.topicId==='friends_names'));
 assert.equal(x.manifest.counts.topics,1);
 assert.equal(x.manifest.counts.words,2);
 assert.equal(x.manifest.counts.sentences,1);
 assert.equal(x.manifest.counts.colours,1);
 for(const forbidden of ['vocabulary-assets','clips.json','token=','public/','text-hash','friend.jpg'])
   assert(!JSON.stringify(planned).includes(forbidden),forbidden);
});

test('Wrong account, unsupported language, stale or revoked policy cannot produce any preview',()=>{
 for(const changed of [
  {ownerId:OTHER},{language:'ja'},{checkedAt:T+25*60*60*1000},
  {policyRecord:{...policyRecord,ownerId:OTHER}},
  {policyRecord:{...policyRecord,snapshot:{...policyRecord.snapshot,server_enforced:false}}},
 ]){
  assert.throws(()=>compile(changed),/Restricted offline candidate refused/);
 }
});

test('Unverified sentence mappings, private visibility failure and forged group-topic pairs fail closed',()=>{
 for(const sentenceResponse2 of [
  null,{...sentenceResponse,server_enforced:false},
  {...sentenceResponse,groups:[{group_name:'food_lines',topic_id:'animals'}]},
  {...sentenceResponse,groups:[{group_name:'food_lines',topic_id:'food'},{group_name:'food_lines',topic_id:'food'}]},
 ]){
  assert.throws(()=>compile({sentenceResponse:sentenceResponse2}),/Restricted offline candidate refused/);
 }
 for(const v of [null,{}, {contract:1,topics:'all',groups:[]},{contract:1,topics:[],groups:['ok',null]}])
   assert.throws(()=>compile({privateVisibility:v}),/Restricted offline candidate refused/);
});

test('No sentence feature means no sentences or group metadata, regardless of stored source sentences',()=>{
 const without={...restricted,features:['chart','quiz.words']};
 const pr=root.KGOfflineAccess.fromServer(without,OWNER,T).record;
 const data=compile({policyRecord:pr,sentenceResponse:null}).content;
 assert.equal(data[tables.sentences].length,0);
 assert.equal(data[tables.colours].length,0);
 assert(!JSON.stringify(data).includes('food_lines'));
});

test('Dangerous embedded picture URLs, malformed word colour, duplicated source IDs cannot enter a scoped preview',()=>{
 const clone=()=>plain(source);
 {
  const d=clone();d[tables.colours][0].picture='https://evil.example/secret.jpg';
  assert.throws(()=>compile({data:d}),/Restricted offline candidate refused/);
 }
 {
  const d=clone();d[tables.vocabulary][0].extra_data.colorCode='url(https://other.example)';
  assert.throws(()=>compile({data:d}),/Restricted offline candidate refused/);
 }
 {
  const d=clone();d[tables.vocabulary].push(plain(d[tables.vocabulary][0]));
  assert.throws(()=>compile({data:d}),/Restricted offline candidate refused/);
 }
 {
  const d=clone();d[tables.sentences][0].id='not-a-uuid';
  assert.throws(()=>compile({data:d}),/Restricted offline candidate refused/);
 }
});

test('The scoped compiler is non-mutating and rejects missing source tables rather than assuming empty',()=>{
 const original=JSON.stringify(source);
 compile();
 assert.equal(JSON.stringify(source),original);
 const missing=plain(source);delete missing[tables.vocabularyTranslations];
 assert.throws(()=>compile({data:missing}),/Restricted offline candidate refused/);
});
