import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';

const runtime=await fs.readFile(new URL('../runtime.js',import.meta.url),'utf8');
const pictures=await fs.readFile(new URL('../pictures.js',import.meta.url),'utf8');
const UID='44444444-4444-4444-8444-444444444444';
const OTHER='55555555-5555-4555-8555-555555555555';
const SID='66666666-6666-4666-8666-666666666666';
const AID='77777777-7777-4777-8777-777777777777';
const SESSIONS='kg_chart_quiz_sessions',ANSWERS='kg_chart_quiz_answers';
const STAMP='2026-11-26T10:00:00.000Z';
const copy=value=>JSON.parse(JSON.stringify(value));
const session=fields=>({id:SID,user_id:UID,language_code:'my',topic_id:'food',
  quiz_type:'native_to_image',difficulty:1,total_questions:1,correct_answers:1,
  created_at:STAMP,completed_at:STAMP,...fields});
const answer=fields=>({id:AID,session_id:SID,vocabulary_id:'word-one',
  selected_vocabulary_id:'word-one',is_correct:true,answered_at:STAMP,...fields});

const open=indexedDB=>new Promise((resolve,reject)=>{
  const req=indexedDB.open('kg-chart-offline-v1',1);
  req.onupgradeneeded=()=>{req.result.createObjectStore('kv');req.result.createObjectStore('outbox',{keyPath:'id'});};
  req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
});
async function write(indexedDB,store,items) {
  const db=await open(indexedDB);
  await new Promise((resolve,reject)=>{
    const tx=db.transaction(store,'readwrite');
    for(const [key,value] of items) store==='outbox'
      ?tx.objectStore(store).put(copy(value)):tx.objectStore(store).put(copy(value),key);
    tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);tx.onerror=()=>reject(tx.error);
  });db.close();
}
async function read(indexedDB,store,key) {
  const db=await open(indexedDB);
  const result=await new Promise((resolve,reject)=>{
    const objectStore=db.transaction(store).objectStore(store),req=key===undefined?objectStore.getAll():objectStore.get(key);
    req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
  });db.close();return result;
}

class RemoteQuery {
  constructor(table,state){this.table=table;this.state=state;this.filters=[];this.mode='select';this.shape=false;}
  select(){return this;}
  eq(key,value){this.filters.push(row=>row[key]===value);return this;}
  in(key,values){this.filters.push(row=>values.includes(row[key]));return this;}
  is(key,value){return this.eq(key,value);}
  order(){return this;}
  range(from,to){this.bounds=[from,to];return this;}
  maybeSingle(){this.shape=true;return this;}
  single(){this.shape=true;return this;}
  insert(value){this.mode='insert';this.values=Array.isArray(value)?value:[value];return this;}
  upsert(value){this.mode='upsert';this.values=Array.isArray(value)?value:[value];return this;}
  then(resolve,reject){return Promise.resolve().then(()=>{
    const rows=this.state.rows[this.table]||=[];
    if(this.mode!=='select') {
      this.state.writes.push({table:this.table,rows:copy(this.values)});
      if(this.mode==='insert' && this.values.some(row=>rows.some(old=>row.id===old.id)))
        return {data:null,error:{code:'23505',message:'Duplicate key'}};
      rows.push(...copy(this.values));
      return {data:copy(this.values),error:null};
    }
    let data=rows.filter(row=>this.filters.every(matches=>matches(row)));
    if(this.bounds)data=data.slice(this.bounds[0],this.bounds[1]+1);
    return {data:copy(this.shape?(data[0]||null):data),error:null};
  }).then(resolve,reject);}
}

async function harness({indexedDB=new IDBFactory(),owner=UID,seed=true,restricted=false}={}) {
  const email=owner===UID?'learner@example.test':'other@example.test';
  const pack={ownerId:owner,lang:'my',schemaVersion:1,cacheName:'kg-offline-synthetic-pack',data:{
    kg_chart_languages:[{code:'my',name_english:'Burmese'}],
    kg_chart_topics:[{id:'food',sort_order:1}],
    kg_chart_settings:[{key:'unlock_rules',value:{level_up:{answers:1,pct:100}}}],
  }};
  if(seed)await write(indexedDB,'kv',[
    ['active-owner',owner],['enroll:'+owner,{id:owner,email,unlocked:true,admin:false}],
    ['active:'+owner+':my','fixture-pack'],['pack:fixture-pack',pack],
    ['active-caches:'+owner,[pack.cacheName]],
  ]);
  const state={rows:{},writes:[],levelCalls:0,exportBlob:null};
  const live={auth:{getUser:async()=>({data:{user:{id:owner,email}},error:null}),
    getSession:async()=>({data:{session:{user:{id:owner,email}}},error:null}),
    signOut:async()=>({error:null}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},
    from:table=>new RemoteQuery(table,state),
    rpc:async name=>{
      if(name==='kg_chart_check_level_up'){state.levelCalls++;return {data:2,error:null};}
      if(name==='kg_chart_my_private_lesson_visibility')return {data:{contract:1,topics:[],groups:[]},error:null};
      return {data:true,error:null};
    },functions:{invoke:async()=>({error:{message:'Not used'}})},
    storage:{from:()=>({getPublicUrl:name=>({data:{publicUrl:`https://example.supabase.co/storage/v1/object/public/vocabulary-assets/${name}`}})})}};
  const nav={onLine:false,serviceWorker:{controller:{postMessage(){}},addEventListener(){}},connection:{addEventListener(){}}};
  class TestURL extends URL {
    static createObjectURL(blob){state.exportBlob=blob;return 'blob:fixture';}
    static revokeObjectURL(){}
  }
  const context={window:{},document:{getElementById:()=>null,addEventListener(){},hidden:false,
      createElement:()=>({click(){},remove(){}}),body:{appendChild(){}}},
    navigator:nav,location:{href:'http://localhost/',hash:''},addEventListener(){},
    BroadcastChannel:class{addEventListener(){}postMessage(){}},indexedDB,
    URL:TestURL,Response,Headers,TextEncoder,Blob,AbortController,crypto:webcrypto,
    setTimeout:(fn,ms)=>{const id=setTimeout(fn,ms);id.unref?.();return id;},clearTimeout,
    fetch:async()=>({ok:false}),console};
  const source=restricted?runtime.replace('const U3D1_OFFLINE_ACCESS_ENABLED = false;','const U3D1_OFFLINE_ACCESS_ENABLED = true;'):runtime;
  vm.runInNewContext(pictures+'\n'+source,context,{filename:'offline/runtime.js'});
  await context.window.KGOffline.ready;
  const api=context.window.KGOffline,client=api.wrapClient(live);
  return {indexedDB,client,api,nav,state,pack,
    rows:table=>read(indexedDB,'kv',`rows:${owner}:${table}`),
    queue:()=>read(indexedDB,'outbox'),checks:()=>read(indexedDB,'kv','quiz-answer-checks:'+owner)};
}

test('exact retries acknowledge existing local quiz rows without duplicate outbox events or pack changes',async()=>{
  const h=await harness();
  const originalPack=copy(await read(h.indexedDB,'kv','pack:fixture-pack'));
  const legacy={id:'88888888-8888-4888-8888-888888888888',ownerId:UID,sequence:1,
    table:'kg_chart_user_ratings',kind:'upsert',row:{user_id:UID,vocabulary_id:'old-word',rating:3},
    filters:[],at:STAMP,state:'pending'};
  await write(h.indexedDB,'outbox',[[null,legacy]]);
  const s=await h.client.from(SESSIONS).insert(session()).select('*').single();
  assert.equal(s.error,null);assert.equal(s.saveDestination,'device');
  const a=await h.client.from(ANSWERS).insert([answer()]).select('*');
  assert.equal(a.error,null);assert.equal(a.saveDestination,'device');
  assert.deepEqual(await h.checks(),{});
  const before=copy(await h.queue());
  const sameInstant=STAMP.replace('Z','+00:00');
  const repeated=await h.client.from(SESSIONS).insert(session({created_at:sameInstant,completed_at:sameInstant})).select('*').single();
  assert.equal(repeated.error,null);assert.equal(repeated.data.id,SID);
  const repeatedAnswers=await h.client.from(ANSWERS).insert([answer({answered_at:sameInstant})]).select('*');
  assert.equal(repeatedAnswers.error,null);assert.equal(repeatedAnswers.data[0].id,AID);
  assert.deepEqual(await h.queue(),before,'Every prior pending event is unchanged');
  assert.equal((await h.rows(SESSIONS)).length,1);assert.equal((await h.rows(ANSWERS)).length,1);
  assert.deepEqual(await read(h.indexedDB,'kv','pack:fixture-pack'),originalPack);
  assert(h.api.status().readyLanguages.includes('my'));
  assert.equal(h.state.writes.length,0);
});

test('a conflicting session or answer retry aborts atomically and retains every existing result',async()=>{
  const h=await harness();
  await h.client.from(SESSIONS).insert(session());
  await h.client.from(ANSWERS).insert(answer());
  const queue=copy(await h.queue());
  const sessionFailure=await h.client.from(SESSIONS).insert(session({correct_answers:0}));
  assert.match(sessionFailure.error.message,/Existing saved quiz differs/);
  assert.equal(sessionFailure.saveDestination,undefined);
  const answerFailure=await h.client.from(ANSWERS).insert([
    answer({id:'99999999-9999-4999-8999-999999999999'}),answer({is_correct:false})]);
  assert.match(answerFailure.error.message,/is_correct/);
  assert.equal((await h.rows(ANSWERS)).length,1,'Earlier item in failed batch was rolled back');
  assert.equal((await h.rows(SESSIONS))[0].correct_answers,1);
  assert.equal((await h.rows(ANSWERS))[0].is_correct,true);
  assert.deepEqual(await h.queue(),queue);
});

test('an enrolled online adapter still reports a device save; remote fallback has no device receipt',async()=>{
  const h=await harness();h.nav.onLine=true;
  const local=await h.client.from(SESSIONS).insert(session()).select('*');
  assert.equal(local.saveDestination,'device');assert.equal(h.state.writes.length,0);
  await h.api.client.auth.signOut();
  const remote=await h.client.from(SESSIONS).insert(session()).select('*');
  assert.equal(remote.saveDestination,undefined);assert.equal(h.state.writes.length,1);
});

test('restricted access denial precedes duplicate acknowledgement and preserves the queue',async()=>{
  const h=await harness();
  await h.client.from(SESSIONS).insert(session());
  const queue=copy(await h.queue());
  const restricted=await harness({indexedDB:h.indexedDB,seed:false,restricted:true});
  const result=await restricted.client.from(SESSIONS).insert(session()).select('*');
  assert.equal(result.error.code,'KG_OFFLINE_ACCESS_PENDING');
  assert.equal(result.saveDestination,undefined);
  assert.deepEqual(await restricted.queue(),queue);
});

test('missing or rejected answers block local and server level checks until the same quiz is recovered',async()=>{
  const h=await harness();
  await h.client.from(SESSIONS).insert(session());
  assert.equal((await h.checks())[SID].total_questions,1);
  const local=await h.client.rpc('kg_chart_check_level_up',{p_lang:'my'});
  assert.equal(local.error.code,'KG_QUIZ_ANSWERS_PENDING');
  assert.equal(await h.rows('kg_chart_user_levels'),undefined);
  h.nav.onLine=true;
  await h.api.sync();
  assert.equal(h.state.rows[SESSIONS].length,1,'Session uploaded without falsely completing the quiz');
  assert.equal(h.state.levelCalls,0,'Incomplete session cannot run the server level RPC');
  assert.equal((await h.checks())[SID].correct_answers,1);

  const wrong=answer({session_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'});
  await h.client.from(ANSWERS).insert(wrong);
  const conflict=await h.client.from(ANSWERS).insert(answer());
  assert(conflict.error);assert((await h.checks())[SID]);
  const restored=await harness({indexedDB:h.indexedDB,seed:false});
  const stillPending=await restored.client.rpc('kg_chart_check_level_up',{p_lang:'my'});
  assert.equal(stillPending.error.code,'KG_QUIZ_ANSWERS_PENDING','Guard survives a cold reopen');
  const recovered=await h.client.from(ANSWERS).insert(answer({id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'}));
  assert.equal(recovered.error,null);assert.deepEqual(await h.checks(),{});
  const completed=await h.client.rpc('kg_chart_check_level_up',{p_lang:'my'});
  assert.equal(completed.error,null);assert.equal(completed.data,2);
  await h.api.sync();
  assert.equal(h.state.levelCalls,1,'Recovered answers permit the retained level check');
});

test('new pending markers do not change legacy history or another learner’s progress',async()=>{
  const h=await harness();
  const legacy=session({id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc'});
  await write(h.indexedDB,'kv',[[`rows:${UID}:${SESSIONS}`,[legacy]]]);
  assert.equal((await h.client.rpc('kg_chart_check_level_up',{p_lang:'my'})).data,2,
    'Historical sessions without a new marker keep their existing treatment');
  await h.client.from(SESSIONS).insert(session());
  const originalMarker=copy(await h.checks());
  const other=await harness({indexedDB:h.indexedDB,owner:OTHER});
  await other.client.from(SESSIONS).insert(session({id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',user_id:OTHER}));
  await other.client.from(ANSWERS).insert(answer({id:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',session_id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd'}));
  const otherResult=await other.client.rpc('kg_chart_check_level_up',{p_lang:'my'});
  assert.equal(otherResult.error,null);assert.equal(otherResult.data,2);
  assert.deepEqual(await read(h.indexedDB,'kv','quiz-answer-checks:'+UID),originalMarker);
  assert.equal((await read(h.indexedDB,'kv',`rows:${UID}:${SESSIONS}`))[0].id,legacy.id);
});

test('the existing session-only colour quiz cannot block ordinary word quiz levels',async()=>{
  const h=await harness();
  const colour=session({id:'abababab-abab-4bab-8bab-abababababab',quiz_type:'colour_phrase'});
  const savedColour=await h.client.from(SESSIONS).insert(colour).select('*');
  assert.equal(savedColour.error,null);
  assert.equal(await h.checks(),undefined,'No answer marker is created for the session-only colour mode');
  const beforeWord=await h.client.rpc('kg_chart_check_level_up',{p_lang:'my'});
  assert.equal(beforeWord.error,null);assert.equal(beforeWord.data,1,'Colour score does not advance word levels');
  await h.client.from(SESSIONS).insert(session());
  assert.equal((await h.client.rpc('kg_chart_check_level_up',{p_lang:'my'})).error.code,'KG_QUIZ_ANSWERS_PENDING');
  await h.client.from(ANSWERS).insert(answer());
  assert.deepEqual(await h.checks(),{});
  assert.equal((await h.client.rpc('kg_chart_check_level_up',{p_lang:'my'})).data,2);
  h.nav.onLine=true;await h.api.sync();
  assert.equal(h.state.levelCalls,1,'Colour session does not leave server level checks permanently held');
  assert.equal(h.state.rows[SESSIONS].length,2,'Both original session histories remain');
});

test('typed quiz metadata survives a session upload and pull before its answers are recovered',async()=>{
  const h=await harness();
  const typed=session({quiz_type:'type_word',quiz_level:'memory'});
  await h.client.from(SESSIONS).insert(typed).select('*');
  h.nav.onLine=true;await h.api.sync();
  assert.equal(h.state.rows[SESSIONS][0].quiz_level,undefined,'Existing upload compatibility omits quiz_level');
  assert.equal((await h.rows(SESSIONS))[0].quiz_level,'memory','Known local metadata survives the pull');
  const retried=await h.client.from(SESSIONS).insert(typed).select('*');
  assert.equal(retried.error,null);assert.equal(retried.data[0].quiz_level,'memory');
  assert.equal((await h.queue()).length,0,'The already uploaded session was not requeued');
  await h.client.from(ANSWERS).insert(answer());
  await h.api.sync();
  assert.equal(h.state.rows[SESSIONS].length,1);assert.equal(h.state.rows[ANSWERS].length,1);
  assert.deepEqual(await h.checks(),{});

  h.state.rows[SESSIONS][0].quiz_level='copy';
  await h.api.sync();
  assert.equal((await h.rows(SESSIONS))[0].quiz_level,'copy','A real server value is authoritative');
  const conflicting=await h.client.from(SESSIONS).insert(typed).select('*');
  assert.match(conflicting.error.message,/quiz_level/,'A changed server value is not falsely acknowledged');
});

test('recovery export and import preserve incomplete-quiz guards without changing older recovery formats',async()=>{
  const h=await harness();
  await h.client.from(SESSIONS).insert(session());
  await h.api.exportRecovery();
  const saved=JSON.parse(await h.state.exportBlob.text());
  assert.equal(saved.quizAnswerChecks[SID].total_questions,1);
  const restored=await harness();
  await restored.api.importRecovery(new Blob([JSON.stringify(saved)],{type:'application/json'}));
  assert.deepEqual(await restored.checks(),saved.quizAnswerChecks);
  assert.equal((await restored.client.rpc('kg_chart_check_level_up',{p_lang:'my'})).error.code,'KG_QUIZ_ANSWERS_PENDING');
  assert.equal((await restored.queue()).length,1);
  const bad={...saved,quizAnswerChecks:{[SID]:{...saved.quizAnswerChecks[SID],correct_answers:0}}};
  await assert.rejects(restored.api.importRecovery(new Blob([JSON.stringify(bad)])),/does not match/);
  assert.equal((await restored.queue()).length,1);
  const older={...saved};delete older.quizAnswerChecks;
  await restored.api.importRecovery(new Blob([JSON.stringify(older)]));
  assert.deepEqual(await restored.checks(),saved.quizAnswerChecks,'Old import cannot delete current pending markers');
  const colour=copy(saved);colour.tables[SESSIONS][0].quiz_type='colour_phrase';
  await assert.rejects(restored.api.importRecovery(new Blob([JSON.stringify(colour)])),/does not match/,
    'Recovery cannot attach an answer guard to a session-only quiz type');
  assert.deepEqual(await restored.checks(),saved.quizAnswerChecks);
});
