import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { transform } from 'esbuild';

const html = await fs.readFile(new URL('../../index.html', import.meta.url), 'utf8');
const start = html.indexOf('    function TypingView(');
const end = html.indexOf('    // CARDS: sort every word', start);
const bestHelpers = html.slice(html.indexOf('    const TYPING_BEST_KEY ='), html.indexOf('    const TYPING_LANG_TAGS ='));
const code = (await transform(bestHelpers + html.slice(start, end), {loader:'jsx'})).code;
const name = {id:'name-id',topic_id:'friends_names',english_text:'Example friend',translation:{native_text:'နမူနာ'},extra_data:{content_type:'person_name'}};
const other = {id:'food-id',topic_id:'food',english_text:'Food',translation:{native_text:'အစားအစာ'}};

// Exercise the actual component's setup and Start handlers without network/storage.
function page(saved, languageCode='my') {
  const states=[],refs=[];let cursor=0,refCursor=0;
  const bestKeys=[], storageKeys=[], begun=[];
  const user={id:'11000000-0000-4000-8000-000000000001'};
  const rules={quizTypes:[]}, priv={groups:new Set()};
  const React={
    createElement:(type,props,...children)=>({type,props:props||{},children}),
    useContext:c=>c, useRef:value=>refs[refCursor++]||=( {current:value} ),
  };
  const ctx={React,RulesContext:rules,PrivateLessonsContext:priv,LANGUAGE_FONTS:{},
    KGPreferenceContext:null,KGMediaScopeContext:null,useContext:c=>c,
    TYPING_SETTINGS_KEY:'settings',TYPING_DURATIONS:[30,60],TYPING_LANG_TAGS:{my:'my-MM'},
    useState(initial){const i=cursor++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;return [states[i],v=>{states[i]=typeof v==='function'?v(states[i]):v;}];},
    useEffect(){},useMemo:fn=>fn(),useCallback:fn=>fn,
    loadFromStorage:key=>{storageKeys.push(key);return key==='settings'?saved:new Proxy({}, {get:(_,k)=>{bestKeys.push(k);return undefined;}});},
    languageName:()=> 'Burmese',shuffleArr:items=>items,Date,
    mmCanon:s=>s,typingMatch:()=>({ok:0,wrong:false}),
    // This fixture deliberately exercises only topic selection and Start,
    // with an invented legacy owner and no live auth or storage. The canonical
    // Chromium and quiz-saving suites exercise the real recovery hook/writes.
    useQuizSaving:()=>({restricted:false,state:{status:'idle'},begin:session=>begun.push(session)}),
    QuizRecoveryPanel:()=>null,QuizSaveStatus:()=>null,
    LoadingSpinner:()=>null,SpeakButton:()=>null,console};
  vm.runInNewContext(code,ctx);
  const topics=[{id:'friends_names',icon:'👥'},{id:'food',icon:'🍚'},{id:'locked',locked:true}];
  return {bestKeys,storageKeys,begun,render(){cursor=0;refCursor=0;return ctx.TypingView({topics,vocabulary:[name,other],languageCode,user,accessPolicy:{state:'legacy'}});}};
}
const flatten=n=>!n||typeof n!=='object'?[]:Array.isArray(n)?n.flatMap(flatten):[n,...n.children.flatMap(flatten)];
const text=n=>n==null?'':typeof n!=='object'?String(n):Array.isArray(n)?n.map(text).join(''):n.children.map(text).join('');
const find=(tree,p)=>flatten(tree).find(p);

test('one saved names topic starts copy and recall practice with only that name',()=>{
  for(const mode of ['copy','recall']) {
    const p=page({languageCode:'my',topicId:'friends_names',mode});
    const setup=p.render();
    assert.match(text(setup),/1 word available/);
    assert.equal(find(setup,n=>n.type==='select').props.value,'friends_names');
    assert(p.bestKeys.includes(`my|${mode}|words|friends_names`));
    assert(p.storageKeys.includes('kg_chart_typing_best:owner:11000000-0000-4000-8000-000000000001'));
    assert(!p.storageKeys.includes('kg_chart_typing_best'),'Unowned history is never imported into the invented learner');
    find(setup,n=>n.type==='button'&&text(n)==='Start').props.onClick();
    assert.equal(p.begun.length,1);
    assert.equal(p.begun[0].quiz_type, 'typing_'+mode);
    assert.equal(p.begun[0].time_spent_seconds,0);
    const run=p.render();
    assert.match(text(run),mode==='copy'?/နမူနာ/:/Example friend/);
    assert.doesNotMatch(text(run),/အစားအစာ|Food/);
    assert.equal(flatten(run).filter(n=>n.type==='img').length,0,'Text names never require images');
  }
});

test('missing topic never silently starts practice with unrelated words',()=>{
  const p=page({languageCode:'my',topicId:'removed'}), tree=p.render();
  assert.match(text(tree),/Saved topic is unavailable/);
  assert.equal(find(tree,n=>n.type==='button'&&text(n)==='No words to type').props.disabled,true);
  find(tree,n=>n.type==='select').props.onChange({target:{value:'all'}});
  assert.match(text(p.render()),/2 words available/);
});

test('switching language defaults to all topics and keeps legacy best-score keys',()=>{
  const p=page({languageCode:'my',topicId:'friends_names'},'ja'), tree=p.render();
  assert.equal(find(tree,n=>n.type==='select').props.value,'all');
  assert(p.bestKeys.includes('ja|copy|words'));
  assert.equal(flatten(tree).some(n=>n.type==='option'&&n.props.value==='locked'),false);
});

test('names do not become questions or distractors in picture and listening quizzes',async()=>{
  const from=html.indexOf('    function QuizView('), to=html.indexOf('    function SentenceQuizView(',from);
  const compiled=(await transform(html.slice(from,to),{loader:'jsx'})).code;
  const ctx={React:{createElement:(type,props)=>({type,props})},
    useState:fn=>[fn(),()=>{}],useEffect(){},loadFromStorage:()=> 'words',QUIZ_MODE_KEY:'mode',
    window:{KGLearnerAccess:{
      visibleQuizModes:()=>['words','sentences','typing','speak','say','colours'],
      chooseQuizMode:(_,mode)=>mode,
    }},
    QuizModeToggle:()=>null,WordQuizView:()=>null};
  vm.runInNewContext(compiled,ctx);
  const result=ctx.QuizView({topics:[{id:'friends_names'},{id:'food'}],vocabulary:[name,other],poolVocabulary:[name,other]});
  assert.deepEqual(result.props.vocabulary.map(v=>v.id),['food-id']);
  assert.deepEqual(result.props.poolVocabulary.map(v=>v.id),['food-id']);
  assert.deepEqual(result.props.topics.map(t=>t.id),['food']);
});
