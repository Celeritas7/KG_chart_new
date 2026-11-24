import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const coreSource=await fs.readFile(new URL('../../js/kg-admin-access-core.js',import.meta.url),'utf8');
const uiSource=await fs.readFile(new URL('../../js/kg-admin-access-ui.js',import.meta.url),'utf8');
const adminSource=await fs.readFile(new URL('../../kg-chart-admin.html',import.meta.url),'utf8');

function loadCore(){
  const window={};
  vm.runInNewContext(coreSource,{window});
  return window.KGAccessCore;
}
const lang=[{code:'my',name_english:'Burmese',is_active:true},
  {code:'ja',name_english:'Japanese',is_active:true},
  {code:'th',name_english:'Thai',is_active:false}];
const topics=[{id:'food',sort_order:1},{id:'friends_names',sort_order:2},
  {id:'animals',sort_order:3}];
const translations=[
  {topic_id:'food',language_code:'my',title_native:'Food'},
  {topic_id:'friends_names',language_code:'my',title_native:'Friends'},
  {topic_id:'animals',language_code:'ja',title_native:'Animals'}
];
const features=[{feature_key:'chart',label:'Chart',family:'navigation',is_active:true},
  {feature_key:'quiz.words',label:'Words',family:'quiz',is_active:true},
  {feature_key:'offline.pack',label:'Pack',family:'offline',is_active:false}];
const cat={languages:lang,topics,topicTranslations:translations,features};
const email='student@example.invalid';

test('U2 access core initializes no-grant draft without enabling restrictions',()=>{
  const core=loadCore(),draft=core.createDraft({});
  assert.equal(draft.languages.length,0);
  assert.equal(draft.topics.length,0);
  assert.equal(draft.features.length,0);
  assert.equal(core.validateDraft(draft,cat),null);
  assert.equal(core.previewDraft(draft,cat,email,[]).languages.length,0);
});
test('U2 preview intersects active languages, translated topics and private lessons',()=>{
  const core=loadCore();
  const draft=core.createDraft({languages:['my','ja'],topics:[
    {language_code:'my',topic_id:'food'},
    {language_code:'my',topic_id:'friends_names'},
    {language_code:'ja',topic_id:'animals'}
  ],features:['chart','quiz.words']});
  const privateLessons=[{topic_id:'friends_names',language_code:'my',emails:['other@example.invalid']}];
  const p=core.previewDraft(draft,cat,email,privateLessons);
  assert.equal(p.languages.length,2);
  assert.deepEqual([...p.topics.map(v=>v.topic_id)].sort(),['animals','food']);
  assert.equal(p.features.length,2);
  assert.equal(core.validateDraft(draft,cat),null);
});
test('U2 client rejects untranslated/unknown topics, disabled language and unsupported feature',()=>{
  const core=loadCore();
  assert.match(core.validateDraft(core.createDraft({languages:['th']}),cat),/inactive/);
  assert.match(core.validateDraft(core.createDraft({languages:['my'],features:['offline.pack']}),cat),/unavailable/);
  assert.match(core.validateDraft(core.createDraft({languages:['my'],topics:[{language_code:'my',topic_id:'animals'}]}),cat),/translation/);
  assert.match(core.validateDraft(core.createDraft({languages:['ja'],topics:[{language_code:'my',topic_id:'food'}]}),cat),/outside/);
});
test('U2 payload always sends explicit, sorted draft grants and expected revision',()=>{
  const core=loadCore(),d=core.createDraft({languages:['ja','my','my'],topics:[
    {language_code:'my',topic_id:'food'},{language_code:'ja',topic_id:'animals'}
  ],features:['quiz.words','chart']});
  const p=core.payload('STUDENT@EXAMPLE.INVALID',2,d);
  assert.equal(p.p_email,email);
  assert.equal(p.p_expected_revision,2);
  assert.deepEqual([...p.p_languages],['ja','my']);
  assert.deepEqual([...p.p_features],['chart','quiz.words']);
  assert.deepEqual([...p.p_topics.map(x=>x.topic_id)],['animals','food']);
});
test('U2 admin assets are wired without changing learner application, no automatic writes',()=>{
  assert.match(adminSource,/data-page="access"/);
  assert.match(adminSource,/KGAccessStudio\.render\(c/);
  assert.match(adminSource,/src="\.\/js\/kg-admin-access-core\.js"/);
  assert.match(adminSource,/src="\.\/js\/kg-admin-access-ui\.js"/);
  assert.match(uiSource,/Save permission draft \(no activation\)/);
  assert.match(uiSource,/ctx\.sb\.rpc\('kg_chart_u2_save_access_draft'/);
  assert.doesNotMatch(uiSource,/\.from\('kg_chart_access_(?:profiles|languages|topics|features)'\)\.(?:insert|update|delete|upsert)/);
  assert.doesNotMatch(uiSource,/window\.location\.href\s*=/);
});
test('U2 page opens in legacy draft-only mode without writing or publishing',async()=>{
  const core=loadCore();
  const row={isConnected:true,innerHTML:'',handlers:{},
    addEventListener(name,handler){this.handlers[name]=handler},
    removeEventListener(name){delete this.handlers[name]}};
  const payloads=[];
  const rows={
    kg_chart_access_feature_catalog:features.filter(f=>f.is_active),
    kg_chart_settings:[{value:[]}],
    kg_chart_access_profiles:[],
    kg_chart_access_languages:[],
    kg_chart_access_topics:[],
    kg_chart_access_features:[],
    kg_chart_access_draft_audit:[]
  };
  const sb={from(table){
    return {select(){return this},eq(){return this},order(){return this},limit(){return this},
      maybeSingle(){return Promise.resolve({data:rows[table][0]||null,error:null})},
      then(resolve,reject){return Promise.resolve({data:rows[table],error:null}).then(resolve,reject)}
    };
  },rpc(name,args){payloads.push({name,args});return Promise.resolve({data:{mode:'legacy',revision:1,applied_to_learners:false},error:null});}};
  const win={KGAccessCore:core};
  vm.runInNewContext(uiSource,{window:win,document:{getElementById:()=>row},confirm:()=>true,console});
  win.KGAccessStudio.render(row,{users:[{email,role:'operator',name:'Test'}],
    languages:lang,topics,topicTranslations:translations,sb});
  await new Promise(resolve=>setImmediate(resolve));
  await new Promise(resolve=>setImmediate(resolve));
  assert.match(row.innerHTML,/Current learner access: LEGACY/);
  assert.match(row.innerHTML,/Save permission draft \(no activation\)/);
  assert.equal(payloads.length,0,'Loading a learner must never apply or save a policy');
});
