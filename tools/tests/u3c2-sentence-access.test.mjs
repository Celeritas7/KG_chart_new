import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
const src=await fs.readFile(new URL('../../js/kg-sentence-access.js',import.meta.url),'utf8');
const learnerSource=await fs.readFile(new URL('../../js/kg-learner-access.js',import.meta.url),'utf8');
const html=await fs.readFile(new URL('../../index.html',import.meta.url),'utf8');
const offlineBuild=await fs.readFile(new URL('../build-offline.mjs',import.meta.url),'utf8');

function getCore(){
  const window={};
  vm.runInNewContext(src+'\n'+learnerSource,{window});
  return {
    sentence:window.KGSentenceAccess,
    learner:window.KGLearnerAccess,
  };
}
const {sentence,learner}=getCore();
const restricted=learner.parseSnapshot({
  contract:1,mode:'restricted',revision:5,server_enforced:true,
  languages:['my'],topics:[
    {language_code:'my',topic_id:'food'},
    {language_code:'my',topic_id:'friends_names'}],
  features:['quiz.sentences','quiz.speak','quiz.words'],
});
const verified={contract:1,mode:'restricted',language_code:'my',
  groups:[{group_name:'food',topic_id:'food'}],
  server_enforced:true};
const sentences=[
  {id:'food-one',group_name:'food',native_text:'public fake sentence'},
  {id:'private-one',group_name:'private_conversation',native_text:'private fake sentence'},
  {id:'other',group_name:'unmapped_group',native_text:'unmapped fake sentence'}
];
test('Verified mapping filters restricted learner sentence and speaking groups',()=>{
  const state=sentence.parseGroupSnapshot(verified,restricted,'my');
  assert.equal(state.state,'restricted');
  assert.equal(state.serverEnforced,true);
  assert.deepEqual(Array.from(state.groups),['food']);
  assert.equal(sentence.isAllowed(state,'food'),true);
  assert.equal(sentence.isAllowed(state,'private_conversation'),false);
  assert.deepEqual(Array.from(sentence.filterSentences(state,sentences)).map(s=>s.id),['food-one']);
  assert.deepEqual(Array.from(learner.visibleQuizModes(restricted,state)),
    ['words','sentences','speak']);
});
test('No SQL mapping or server_enforced=false keeps restricted sentence modes hidden',()=>{
  for(const data of [null,{}, {...verified,server_enforced:false},
    {...verified,groups:null}, {...verified,contract:2}]){
    const scope=sentence.parseGroupSnapshot(data,restricted,'my');
    assert.equal(scope.state,'blocked');
    assert.deepEqual(Array.from(sentence.filterSentences(scope,sentences)),[]);
    assert.deepEqual(Array.from(learner.visibleQuizModes(restricted,scope)),['words']);
  }
});
test('An empty-but-valid verified mapping denies both sentence and speak',()=>{
  const state=sentence.parseGroupSnapshot({...verified,groups:[]},restricted,'my');
  assert.equal(state.state,'restricted');
  assert.deepEqual(Array.from(sentence.filterSentences(state,sentences)),[]);
  assert.deepEqual(Array.from(learner.visibleQuizModes(restricted,state)),['words']);
});
test('Forged groups, unassigned topics and mismatched language fail closed',()=>{
  const invalid=[
    {...verified,language_code:'ja'},
    {...verified,groups:[{group_name:'food',topic_id:'animals'}]},
    {...verified,groups:[{group_name:'food',topic_id:'food'},{group_name:'food',topic_id:'food'}]},
    {...verified,groups:[{group_name:'  food  ',topic_id:'food'}]},
    {...verified,groups:[{group_name:'__proto__',topic_id:'food'}]},
    {...verified,groups:[{group_name:null,topic_id:'food'}]},
    {...verified,groups:[{group_name:'food',topic_id:'food',emails:['somebody@example.invalid']}]},
    {...verified,mode:'legacy'},
  ];
  for(const item of invalid){
    const scope=sentence.parseGroupSnapshot(item,restricted,'my');
    assert.equal(scope.state,'blocked',JSON.stringify(item));
    assert.equal(sentence.isAllowed(scope,'food'),false);
  }
});
test('Legacy users keep old non-private group behavior, without requiring a mapping',()=>{
  const p=learner.parseSnapshot({contract:1,mode:'legacy',revision:0,
    languages:null,topics:null,features:null,server_enforced:false});
  const state=sentence.parseGroupSnapshot(null,p,'my');
  assert.equal(state.state,'legacy');
  assert.deepEqual(Array.from(sentence.filterSentences(state,sentences)).map(x=>x.id),
    ['food-one','private-one','other']);
  assert.ok(learner.visibleQuizModes(p).includes('sentences'));
  assert.ok(learner.visibleQuizModes(p).includes('speak'));
});
test('A mapping cannot override the verified parent topic grants',()=>{
  const p=learner.parseSnapshot({...{
    contract:1,mode:'restricted',revision:8,server_enforced:true,
    languages:['my'],features:['quiz.sentences'],
    topics:[{language_code:'my',topic_id:'food'}],
  }});
  const wrong=sentence.parseGroupSnapshot({...verified,
    groups:[{group_name:'private_conversation',topic_id:'friends_names'}]},p,'my');
  assert.equal(wrong.state,'blocked');
});
test('Staged UI consumes its own verified group RPC and never trusts free-form names',()=>{
  assert.match(html,/kg_chart_u3c2_my_sentence_groups', \{ p_language: languageCode \}/);
  assert.match(html,/window\.KGSentenceAccess\.parseGroupSnapshot/);
  assert.match(html,/window\.KGSentenceAccess\.filterSentences/);
  assert.match(html,/window\.KGSentenceAccess\.isAllowed/);
  assert.match(html,/visibleQuizModes\(\s*props\.accessPolicy,props\.sentenceAccess\)/);
  assert.match(html,/const U3C1_SCOPED_UI_ENABLED = false/);
  assert.match(offlineBuild,/js\/kg-sentence-access\.js/);
  assert.doesNotMatch(html,/localStorage\.clear\(\)|indexedDB\.deleteDatabase\(/);
});
