import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

// U4B1 deliberately uses synthetic accounts and does not connect to Supabase,
// touch the installed device, or enable any staged restricted-access switch.
const root={};
for(const path of [
  '../../js/kg-learner-access.js',
  '../../js/kg-sentence-access.js',
  '../../offline/access-policy.js',
  '../../offline/access-outbox.js',
  '../../offline/scoped-pack.js',
  '../../offline/restricted-packs.js',
  '../../offline/restricted-sync.js',
]){
  const source=await fs.readFile(new URL(path,import.meta.url),'utf8');
  vm.runInNewContext(source,{window:root},{filename:path});
}
const learner=root.KGLearnerAccess;
const sentence=root.KGSentenceAccess;
const offline=root.KGOfflineAccess;
const outbox=root.KGAccessOutbox;

const OWNER='10000000-0000-4000-8000-000000000001';
const OTHER='20000000-0000-4000-8000-000000000002';
const T=1795500000000;
const restricted={
  contract:1,mode:'restricted',revision:7,server_enforced:true,
  languages:['my'],
  topics:[{language_code:'my',topic_id:'food'}],
  features:['chart','cards','quiz.words','quiz.sentences','quiz.speak','offline.pack'],
};
const languages=[
  {code:'my',is_active:true},
  {code:'ja',is_active:true},
  {code:'zh',is_active:false},
];
const topics=[{id:'food'},{id:'friends_names'},{id:'animals'}];
const words=[
  {id:'word-a',topic_id:'food'},
  {id:'word-b',topic_id:'friends_names'},
  {id:'word-c',topic_id:'animals'},
];
const record=()=>offline.fromServer(restricted,OWNER,T).record;

test('U4B1 source preflight: canonical learner and restricted offline release switches remain OFF',async()=>{
  const html=await fs.readFile(new URL('../../index.html',import.meta.url),'utf8');
  const runtime=await fs.readFile(new URL('../../offline/runtime.js',import.meta.url),'utf8');
  assert.match(html,/const U3C1_SCOPED_UI_ENABLED = false;/);
  for(const flag of [
    'U3D1_OFFLINE_ACCESS_ENABLED',
    'U3D2_SCOPED_PACK_PREVIEW_ENABLED',
    'U3D2B1_PRIVATE_MEDIA_STAGE_ENABLED',
    'U3D2B2_PRIVATE_OFFLINE_PLAYBACK_ENABLED',
    'U3D3A_OUTBOX_HOLD_ENABLED',
    'U3D3B_RESTRICTED_PACKS_ENABLED',
    'U3D3C_RESTRICTED_SYNC_ENABLED',
  ])assert(runtime.includes('const '+flag+' = false;'),flag);
  for(const path of [
    '../../sql/kg-chart-u3a-access-snapshot.sql',
    '../../sql/kg-chart-u3c2-sentence-topic-mapping.sql',
  ]){
    const sql=await fs.readFile(new URL(path,import.meta.url),'utf8');
    assert(/['"]server_enforced['"]\s*,\s*false/.test(sql),
      path+' must not imply live authorization before a reviewed deployment');
    assert(!sql.includes("'server_enforced', true"),
      path+' would require a new backend security review');
  }
  assert.match(runtime,/const DB_NAME = 'kg-chart-offline-v1'/);
  assert.match(runtime,/const DB_VERSION = 1/);
});

test('Absent or false backend enforcement fails closed, never silently becomes legacy',()=>{
  const invalid=[
    null,{...restricted,server_enforced:false},
    {...restricted,topics:[{language_code:'ja',topic_id:'food'}]},
    {...restricted,revision:-1},
    {...restricted,features:['chart','not/valid']},
  ];
  for(const raw of invalid){
    const policy=learner.parseSnapshot(raw);
    assert.equal(policy.state,'blocked');
    assert.equal(learner.chooseLanguage(policy,'my',languages),null);
    assert.equal(learner.chooseQuizMode(policy,'words'),null);
    assert.equal(offline.fromServer(raw,OWNER,T).record,null);
  }
  assert.equal(learner.parseSnapshot({...restricted,server_enforced:false}).reason,'not_enforced');
});

test('Synthetic restricted learner sees granted Burmese/Food only, no stale saved topic or mode',()=>{
  const policy=learner.parseSnapshot(restricted);
  assert.equal(policy.state,'restricted');
  assert.deepEqual(Array.from(learner.visibleLanguages(policy,languages)).map(x=>x.code),['my']);
  assert.deepEqual(Array.from(learner.visibleTopics(policy,'my',topics)).map(x=>x.id),['food']);
  assert.deepEqual(Array.from(learner.visibleVocabulary(policy,'my',words,topics)).map(x=>x.id),['word-a']);
  assert.deepEqual(Array.from(learner.visibleViews(policy)),['chart','quiz','flashcard']);
  assert.deepEqual(Array.from(learner.visibleQuizModes(policy)),['words']);
  assert.equal(learner.canTopic(policy,'my','friends_names'),false);
  assert.equal(learner.canLanguage(policy,'ja'),false);
  assert.equal(learner.chooseLanguage(policy,'ja',languages),'my');
  assert.equal(learner.chooseView(policy,'progress'),'chart');
  assert.equal(learner.chooseQuizMode(policy,'speak'),'words');
  assert.equal(learner.canView(policy,'progress'),false);
});

test('Sentence/speak remain hidden without a separately enforced group-to-topic proof',()=>{
  const policy=learner.parseSnapshot(restricted);
  const unsafe=sentence.parseGroupSnapshot({
    contract:1,mode:'restricted',server_enforced:false,
    language_code:'my',
    groups:[{group_name:'allowed-group',topic_id:'food'}],
  },policy,'my');
  assert.equal(unsafe.state,'blocked');
  assert.deepEqual(Array.from(learner.visibleQuizModes(policy,unsafe)),['words']);
  const mapped=sentence.parseGroupSnapshot({
    contract:1,mode:'restricted',server_enforced:true,
    language_code:'my',
    groups:[{group_name:'allowed-group',topic_id:'food'}],
  },policy,'my');
  assert.equal(mapped.state,'restricted');
  assert.deepEqual(Array.from(learner.visibleQuizModes(policy,mapped)),
    ['words','sentences','speak']);
  assert.deepEqual(Array.from(sentence.filterSentences(mapped,[
    {group_name:'allowed-group'}, {group_name:'private-group'},
  ])).map(x=>x.group_name),['allowed-group']);
  const forged=sentence.parseGroupSnapshot({
    contract:1,mode:'restricted',server_enforced:true,
    language_code:'my',
    groups:[{group_name:'private-group',topic_id:'friends_names'}],
  },policy,'my');
  assert.equal(forged.state,'blocked');
  assert.deepEqual(Array.from(learner.visibleQuizModes(policy,forged)),['words']);
});

test('Offline snapshot is owner-bound, expires, and never unlocks broad legacy packs',()=>{
  const saved=record();
  assert(saved);
  assert.equal(offline.fromCache(saved,OWNER,T+1000).state,'restricted_pending');
  assert.equal(offline.mayUseLegacyPack(offline.fromCache(saved,OWNER,T+1000),OWNER),false);
  assert.equal(offline.fromCache(saved,OTHER,T+1000).state,'blocked');
  assert.equal(offline.fromCache(saved,OWNER,T+offline.MAX_AGE_MS+1).reason,'offline_policy_expired');
  assert.equal(offline.fromCache({...saved,ownerId:OTHER},OWNER,T+1000).state,'blocked');
  const revoked=offline.fromServer({...restricted,revision:8,topics:[],features:[]},
    OWNER,T+2000,saved);
  assert.equal(revoked.view.state,'restricted_pending');
  assert(revoked.record);
  assert.deepEqual(Array.from(learner.visibleTopics(
    learner.parseSnapshot(revoked.record.snapshot),'my',topics)),[]);
  assert.equal(offline.fromServer({...restricted,revision:6},OWNER,T+2000,saved)
    .view.reason,'policy_revision_rollback');
  assert.equal(offline.fromServer({...restricted,topics:[]},OWNER,T+2000,saved)
    .view.reason,'same_revision_policy_changed');
});

test('Restricted offline quiz event is held for server review; revoke and account switch cannot publish it',()=>{
  const evt={
    id:'60000000-0000-4000-8000-000000000001',
    ownerId:OWNER,permissionRevision:7,
    kind:'insert',table:'kg_chart_quiz_sessions',filters:[],
    row:{user_id:OWNER,language_code:'my',topic_id:'food',quiz_type:'words'},
  };
  const before=JSON.stringify(evt);
  const saved=record();
  const initial=outbox.analyzeOutbox({
    events:[evt],ownerId:OWNER,policyRecord:saved,checkedAt:T+1000,
  });
  assert.equal(initial.total,1);
  assert.equal(initial.held,1);
  assert.equal(initial.publishable,false);
  assert.equal(initial.reasonCounts.requires_server_review,1);
  const revoked=offline.fromServer({...restricted,revision:8,topics:[]},OWNER,T+2000,saved);
  const after=outbox.analyzeOutbox({
    events:[evt],ownerId:OWNER,policyRecord:revoked.record,checkedAt:T+3000,
  });
  assert.equal(after.held,1);
  assert.equal(after.reasonCounts.revision_changed,1);
  const switched=outbox.analyzeOutbox({
    events:[evt],ownerId:OTHER,policyRecord:saved,checkedAt:T+1000,
  });
  assert.equal(switched.held,1);
  assert.equal(switched.publishable,false);
  assert.equal(JSON.stringify(evt),before,'never mutate the original queued answer/session');
});

test('U4B1 is a source-only preflight, not physical-device evidence or friend-sharing approval',async()=>{
  const documentation=await fs.readFile(
    new URL('../../docs/U4B1-RESTRICTED-DEVICE-PREFLIGHT.md',import.meta.url),'utf8');
  for(const phrase of [
    'Android','iPad','NO-GO','PR #95','never enable','not a hardware PASS',
    'separate test account','private recovery','revocation','expired',
  ])assert(documentation.toLowerCase().includes(phrase.toLowerCase()),'Missing explicit reviewer warning: '+phrase);
  assert.equal(typeof root.KGRestrictedPacks.prepare,'function');
  assert.equal(typeof root.KGRestrictedPacks.verify,'function');
  assert.equal(typeof root.KGRestrictedSync.authorize,'function');
  assert.equal(typeof root.KGRestrictedSync.reconcile,'function');
});
