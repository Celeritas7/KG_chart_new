import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const core=await fs.readFile(new URL('../../js/kg-learner-access.js',import.meta.url),'utf8');
const learner=await fs.readFile(new URL('../../index.html',import.meta.url),'utf8');
const build=await fs.readFile(new URL('../build-offline.mjs',import.meta.url),'utf8');

function access(){
  const sandbox={window:{}};
  vm.runInNewContext(core,sandbox);
  return sandbox.window.KGLearnerAccess;
}
const api=access();
const lang=[
  {code:'my',name_english:'Burmese',is_active:true},
  {code:'ja',name_english:'Japanese',is_active:true},
  {code:'zh',name_english:'Chinese',is_active:false},
];
const topics=[
  {id:'food',translation:{title_native:'Food'}},
  {id:'animals',translation:{title_native:'Animals'}},
  {id:'friends_names',translation:{title_native:'Friends'}},
];
const words=[
  {id:'w1',topic_id:'food'},{id:'w2',topic_id:'animals'},
  {id:'w3',topic_id:'friends_names'},
];
const snapshot={
  contract:1,mode:'restricted',revision:4,server_enforced:true,
  languages:['my'],topics:[{language_code:'my',topic_id:'food'}],
  features:['chart','quiz.words','quiz.typing','cards'],
};
const legacy={contract:1,mode:'legacy',revision:0,server_enforced:false,
  languages:null,topics:null,features:null};

test('Existing legacy learners keep current languages, lessons and all navigation',()=>{
  const policy=api.parseSnapshot(legacy);
  assert.equal(policy.state,'legacy');
  assert.deepEqual(Array.from(api.visibleLanguages(policy,lang)).map(x=>x.code),['my','ja']);
  assert.deepEqual(Array.from(api.visibleTopics(policy,'my',topics)).map(x=>x.id),
    ['food','animals','friends_names']);
  assert.deepEqual(Array.from(api.visibleViews(policy)),['chart','quiz','flashcard','progress']);
  assert.deepEqual(Array.from(api.visibleQuizModes(policy)),
    ['words','sentences','typing','speak','say','colours']);
});

test('Restricted learner sees only assigned language/topic/words and features',()=>{
  const policy=api.parseSnapshot(snapshot);
  assert.equal(policy.state,'restricted');
  assert.equal(policy.revision,4);
  assert.deepEqual(Array.from(api.visibleLanguages(policy,lang)).map(x=>x.code),['my']);
  assert.deepEqual(Array.from(api.visibleTopics(policy,'my',topics)).map(x=>x.id),['food']);
  assert.deepEqual(Array.from(api.visibleVocabulary(policy,'my',words,topics)).map(x=>x.id),['w1']);
  assert.deepEqual(Array.from(api.visibleViews(policy)),['chart','quiz','flashcard']);
  assert.deepEqual(Array.from(api.visibleQuizModes(policy)),['words','typing']);
  assert.equal(api.canFeature(policy,'progress'),false);
  assert.equal(api.canLanguage(policy,'ja'),false);
  assert.equal(api.canTopic(policy,'my','friends_names'),false);
});

test('Stale saved language, view or quiz mode resets to an authorized choice',()=>{
  const policy=api.parseSnapshot(snapshot);
  assert.equal(api.chooseLanguage(policy,'ja',lang),'my');
  assert.equal(api.chooseView(policy,'progress'),'chart');
  assert.equal(api.chooseQuizMode(policy,'speak'),'words');
  assert.equal(api.chooseLanguage(policy,'my',lang),'my');
  assert.equal(api.chooseQuizMode(policy,'typing'),'typing');
  assert.equal(api.chooseView(policy,'flashcard'),'flashcard');
});

test('A restricted account with empty grants has zero menu or content',()=>{
  const policy=api.parseSnapshot({...snapshot,languages:[],topics:[],features:[]});
  assert.equal(policy.state,'restricted');
  assert.equal(api.chooseLanguage(policy,'my',lang),null);
  assert.equal(api.chooseView(policy,'chart'),null);
  assert.equal(api.chooseQuizMode(policy,'words'),null);
  assert.deepEqual(Array.from(api.visibleVocabulary(policy,'my',words,topics)),[]);
  assert.deepEqual(Array.from(api.visibleViews(policy)),[]);
});

test('Pending U3A enforcement cannot be mistaken for unrestricted or active policy',()=>{
  const policy=api.parseSnapshot({...snapshot,server_enforced:false});
  assert.equal(policy.state,'blocked');
  assert.equal(policy.reason,'not_enforced');
  assert.equal(api.canFeature(policy,'chart'),false);
  assert.deepEqual(Array.from(api.visibleLanguages(policy,lang)),[]);
  assert.equal(api.chooseQuizMode(policy,'words'),null);
});

test('Malformed, missing, contradictory and forged snapshots fail closed',()=>{
  const invalid=[
    null,{},false,{...legacy,contract:2},
    {...legacy,languages:[]},
    {...snapshot,topics:[{language_code:'ja',topic_id:'food'}]},
    {...snapshot,languages:['my',null]},
    {...snapshot,features:['quiz.say','../bad']},
    {...snapshot,revision:-1},
    {...snapshot,server_enforced:null},
    {...snapshot,mode:'anything'},
    {...snapshot,topics:'all'},
  ];
  for(const row of invalid){
    const p=api.parseSnapshot(row);
    assert.equal(p.state,'blocked',JSON.stringify(row));
    assert.equal(api.chooseLanguage(p,'my',lang),null);
  }
});

test('Restricted sentence and speak modes are withheld until topic mappings exist',()=>{
  const p=api.parseSnapshot({...snapshot,features:['quiz.sentences','quiz.speak']});
  assert.deepEqual(Array.from(api.visibleQuizModes(p)),[]);
  assert.equal(api.canView(p,'quiz'),false);
  assert.deepEqual(Array.from(api.visibleViews(p)),[]);
  assert.equal(api.canFeature(p,'quiz.sentences'),true,
    'The grant is recorded; UI only withholds the unsafe unmapped group');
  const l=api.parseSnapshot(legacy);
  assert.ok(api.visibleQuizModes(l).includes('sentences'));
});

test('U3C1 activation is explicitly disabled until server and offline acceptance',()=>{
  assert.match(learner,/const U3C1_SCOPED_UI_ENABLED = false/);
  assert.match(learner,/if \(!U3C1_SCOPED_UI_ENABLED\) return/);
  assert.match(learner,/policy: U3C1_LEGACY_POLICY, error: null, loading: false/);
});

test('Scoped rules are loaded by verified account; not by caller-supplied email',()=>{
  assert.match(learner,/supabase\.rpc\('kg_chart_u3_my_access_snapshot'\)/);
  assert.match(learner,/const policy = window\.KGLearnerAccess\.parseSnapshot\(data\)/);
  assert.match(learner,/result\.owner === user\?\.id/);
  assert.match(learner,/window\.addEventListener\('online', reload\)/);
  assert.match(learner,/window\.addEventListener\('focus', reload\)/);
  assert.doesNotMatch(learner,/kg_chart_u3_my_access_snapshot',\s*\{\s*(?:p_email|user_id)/);
});

test('Canonical app gates loaders and switches only into verified languages/topics',()=>{
  assert.match(learner,/useTopics\(selectedLanguage, meaningsInEnglish, user\?\.id\)/);
  assert.match(learner,/useVocabulary\(selectedLanguage, meaningsInEnglish, user\?\.id\)/);
  assert.match(learner,/const selectedLanguage = verified && desiredLanguage === currentLanguage/);
  assert.match(learner,/visibleVocabulary\(policy, selectedLanguage, allVocabulary, topics\)/);
  assert.match(learner,/allowedViews=\{allowedViews\}/);
  assert.match(learner,/if \(access\.error \|\| !verified\) return <LearnerAccessUnavailable/);
  assert.match(learner,/No learning access assigned/);
  assert.match(learner,/useEffect\(\(\) => \{\s*if \(!verified \|\| loadingLangs\) return/);
  assert.match(learner,/topicId: currentTopic\.id, languageCode: selectedLanguage/);
  assert.doesNotMatch(learner,/localStorage\.clear\(\)|indexedDB\.deleteDatabase\(/);
});

test('Quiz mode tabs enforce the allowlist, including stored old modes',()=>{
  assert.match(learner,/allowedModes\.includes\(id\)/);
  assert.match(learner,/const currentMode = window\.KGLearnerAccess\.chooseQuizMode\(/);
  assert.match(learner,/props\.accessPolicy, mode,props\.sentenceAccess/);
  assert.match(learner,/onChange=\{next => \{ if \(allowedModes\.includes\(next\)\) setMode\(next\); \}\}/);
  assert.match(learner,/if \(!currentMode\) return <div role="alert"/);
  assert.match(learner,/accessPolicy=\{props\.accessPolicy\}/);
});

test('Restricted Typing cannot reopen stored sentence source or inaccessible topic',()=>{
  assert.match(learner,/const safeSource = accessPolicy\?\.state === 'restricted' \? 'words' : source/);
  assert.match(learner,/const safeTopicId = topicId;/);
  assert.match(learner,/Do NOT silently select All when a previously saved topic is revoked/);
  assert.match(learner,/if \(safeSource !== 'sentences'\) return/);
  assert.match(learner,/accessPolicy\?\.state === 'restricted' \? \[\['words'/);
});

test('Offline edition bundles same policy parser, without changing PWA identity',()=>{
  assert.match(learner,/script src="\.\/js\/kg-learner-access\.js"/);
  assert.match(build,/js\/kg-learner-access\.js/);
  assert.match(build,/['"]dist-unified['"]/);
  assert.doesNotMatch(build,/deleteDatabase/);
});
