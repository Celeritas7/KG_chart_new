import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const online = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
const offline = await readFile(new URL('../runtime.js', import.meta.url), 'utf8');

const hookStart=online.indexOf('function usePrivateLessons(');
const hookEnd=online.indexOf('function useLearningPath(',hookStart);
const privateHook=online.slice(hookStart,hookEnd);

function offlineRpcFor({settings,online=false,email='student1@example.invalid'}={}) {
  const start=offline.indexOf('  function localRPC(name,args={}) {');
  const end=offline.indexOf('\n  function wrapClient(',start);
  assert.ok(start>0 && end>start, 'Extract the real production offline RPC');
  const source=offline.slice(start,end)+'\nlocalRPC;';
  const sandbox={
    currentEnrollment:()=>true,
    enrollment:{email,admin:false},
    navigator:{onLine:online},
    TABLES:{settings:'kg_chart_settings'},
    selectRows:async()=>settings||[],
    owner:'fake-owner',
  };
  return vm.runInNewContext(source,sandbox);
}

test('Online learner uses caller-scoped RPC, never reads other learners email allowlist',()=>{
  assert.ok(hookStart>0 && hookEnd>hookStart);
  assert.match(privateHook,/supabase\.rpc\('kg_chart_my_private_lesson_visibility'/);
  assert.doesNotMatch(privateHook,/\.from\(TABLES\.settings\)/);
  assert.doesNotMatch(privateHook,/\.eq\('key',\s*'private_lessons'\)/);
  assert.match(privateHook,/Private lesson permissions could not be verified/);
  assert.match(online,/priv\.error \?/);
  assert.match(online,/priv\.loaded && !priv\.error/);
});

test('New offline pack never fetches raw email lists and keeps sanitized per-language scope',()=>{
  const start=offline.indexOf('  async function fetchContent(lang)');
  const end=offline.indexOf('  function requiredMedia(',start);
  const fetchContent=offline.slice(start,end);
  assert.match(fetchContent,/live\.rpc\('kg_chart_my_private_lesson_visibility'/);
  assert.match(fetchContent,/readPaged\(TABLES\.settings,q=>q\.in\('key',\['unlock_rules','admin_bypass_lock'\]\)\)/);
  assert.match(fetchContent,/key:'kg_private_visibility:'\+lang/);
  assert.match(fetchContent,/settings\.filter\(s=>s\.key!=='private_lessons'\)/);
  assert.match(fetchContent,/privateVis\.error/);
});

test('Disconnected PWA reads only its account-scoped sanitized language metadata',async()=>{
  const rpc=offlineRpcFor({settings:[
    {key:'kg_private_visibility:my',value:{contract:1,topics:['friends_names'],groups:['private_conversation']}},
    {key:'kg_private_visibility:ja',value:{contract:1,topics:[],groups:['other_group']}},
  ]});
  const result=await rpc('kg_chart_my_private_lesson_visibility',{p_language:'my'});
  assert.equal(result.error,null);
  assert.equal(result.data.contract,1);
  assert.deepEqual(Array.from(result.data.topics),['friends_names']);
  assert.deepEqual(Array.from(result.data.groups),['private_conversation']);
  assert.ok(!JSON.stringify(result.data).includes('@'));
});

test('Older offline pack compatibility derives safe visibility without exposing emails',async()=>{
  const settings=[{key:'private_lessons',value:[
    {topic_id:'friends_names',language_code:'my',
      emails:['student2@example.invalid'],
      sentence_groups:['private_conversation']},
    {topic_id:'child',language_code:'ja',
      emails:['student1@example.invalid'],sentence_groups:['story']},
  ]}];
  const rpc=offlineRpcFor({settings});
  const first=await rpc('kg_chart_my_private_lesson_visibility',{p_language:'my'});
  assert.equal(first.error,null);
  assert.deepEqual(Array.from(first.data.topics),['friends_names']);
  assert.deepEqual(Array.from(first.data.groups),['private_conversation']);
  assert.ok(!JSON.stringify(first.data).includes('@'));
  const second=offlineRpcFor({settings,email:'student2@example.invalid'});
  const allowed=await second('kg_chart_my_private_lesson_visibility',{p_language:'my'});
  assert.deepEqual(Array.from(allowed.data.topics),[]);
  assert.deepEqual(Array.from(allowed.data.groups),[]);
  const japanese=await rpc('kg_chart_my_private_lesson_visibility',{p_language:'ja'});
  assert.deepEqual(Array.from(japanese.data.topics),[]);
});

test('Missing or malformed offline private visibility fails closed without reset',async()=>{
  const missing=await offlineRpcFor({settings:[]})('kg_chart_my_private_lesson_visibility',{p_language:'my'});
  assert.equal(missing.data,null);
  assert.match(missing.error.message,/Reconnect/);
  const malformed=await offlineRpcFor({settings:[{key:'kg_private_visibility:my',value:{topics:[]}}]})(
    'kg_chart_my_private_lesson_visibility',{p_language:'my'});
  assert.equal(malformed.data,null);
  assert.ok(malformed.error);
  assert.doesNotMatch(offline,/indexedDB\.deleteDatabase\(/);
});

test('Connected PWA delegates permission checks to current server instead of stale pack',()=>{
  const rpc=offlineRpcFor({settings:[{key:'kg_private_visibility:my',
    value:{contract:1,topics:['friends_names'],groups:[]}}],online:true});
  assert.equal(rpc('kg_chart_my_private_lesson_visibility',{p_language:'my'}),null);
});
