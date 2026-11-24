// No network, production data or real Azure accounts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeHandler } from '../../supabase/functions/kg-pronounce/core.ts';

function fakeWav(){
  const b=Buffer.alloc(44+16000);
  b.write('RIFF',0,'ascii');
  b.write('WAVE',8,'ascii');
  b.write('fmt ',12,'ascii');
  b.writeUInt16LE(1,20);
  b.writeUInt16LE(1,22);
  b.writeUInt32LE(16000,24);
  b.writeUInt16LE(16,34);
  return b.toString('base64');
}
const DEFAULT_ID='10000000-0000-4000-8000-000000000001';
const body={lang:'my',text:'my-food',audio:fakeWav(),vocabulary_id:DEFAULT_ID,source:'word'};

function setup({auth=true,allowed=true,permitted=true,rpcError=false}={}){
  const calls={allowed:0,permission:0,azure:0,admin:0,inserts:0,permissions:[]};
  const userDb={
    auth:{async getUser(){return auth?{data:{user:{id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'}},error:null}:{data:{user:null},error:{message:'Bad token'}};}},
    async rpc(name,args){
      if(name==='kg_chart_is_allowed'){calls.allowed++;return {data:allowed,error:null};}
      if(name==='kg_chart_u3b2_can_pronounce'){
        calls.permission++;calls.permissions.push(args);
        return rpcError?{data:null,error:{message:'Function missing'}}:{data:permitted,error:null};
      }
      throw Error('Unexpected RPC '+name);
    },
  };
  const adminDb={
    from(name){
      calls.admin++;
      if(name==='kg_chart_settings'){
        return {select(){return this},eq(){return this},
          async maybeSingle(){return {data:{value:100},error:null}}};
      }
      if(name==='kg_chart_pronunciation_attempts'){
        return {select(){return this},eq(){return this},gte(){return Promise.resolve({count:0,error:null})},
          async insert(){calls.inserts++;return {error:null}}};
      }
      throw Error('Unexpected table '+name);
    }
  };
  const deps={
    env(name){return name==='AZURE_SPEECH_KEY'?'fictional-key':
      name==='AZURE_SPEECH_REGION'?'fictional-region':undefined;},
    userClient(){return userDb;},
    adminClient(){return adminDb;},
    async fetch(url){
      calls.azure++;
      assert.match(String(url),/tts|stt\.speech/);
      return new Response(JSON.stringify({
        RecognitionStatus:'Success',
        NBest:[{PronunciationAssessment:{
          PronScore:89,AccuracyScore:92,FluencyScore:86,CompletenessScore:95,
        },Words:[]}],
      }),{status:200,headers:{'Content-Type':'application/json'}});
    },
  };
  return {handler:makeHandler(deps),calls};
}
async function send(handler,contents=body){
  return handler(new Request('https://synthetic.invalid/kg-pronounce',{
    method:'POST',
    headers:{Authorization:'Bearer fictional-token','Content-Type':'application/json'},
    body:JSON.stringify(contents),
  }));
}
test('Restricted denied pronunciation returns 403 before Azure or service-role writes',async()=>{
  const {handler,calls}=setup({permitted:false});
  const response=await send(handler);
  assert.equal(response.status,403);
  assert.equal((await response.json()).reason,'not_allowed');
  assert.equal(calls.allowed,1);
  assert.equal(calls.permission,1);
  assert.equal(calls.azure,0);
  assert.equal(calls.admin,0);
  assert.equal(calls.inserts,0);
  assert.equal(calls.permissions[0].p_vocabulary_id,DEFAULT_ID);
  assert.equal(calls.permissions[0].p_lang,'my');
});
test('Missing database permission function fails closed, not back to allowlist',async()=>{
  const {handler,calls}=setup({rpcError:true});
  const response=await send(handler);
  assert.equal(response.status,503);
  assert.equal((await response.json()).reason,'config');
  assert.equal(calls.azure,0);
  assert.equal(calls.admin,0);
});
test('Successful authorized request gets Azure score, then writes score',async()=>{
  const {handler,calls}=setup();
  const response=await send(handler);
  assert.equal(response.status,200);
  const b=await response.json();
  assert.equal(b.ok,true);
  assert.equal(b.score,89);
  assert.equal(b.saved,true);
  assert.equal(calls.permission,1);
  assert.equal(calls.azure,1);
  assert.equal(calls.inserts,1);
});
test('Unapproved or unauthenticated account never reaches permission check',async()=>{
  for(const state of [{allowed:false},{auth:false}]){
    const {handler,calls}=setup(state);
    const response=await send(handler);
    assert.ok([401,403].includes(response.status));
    assert.equal(calls.permission,0);
    assert.equal(calls.azure,0);
    assert.equal(calls.inserts,0);
  }
});
test('Sentence pronunciation forwards session language and trusted resource IDs',async()=>{
  const {handler,calls}=setup({permitted:false});
  const res=await send(handler,{...body,vocabulary_id:null,sentence_id:
    '20000000-0000-4000-8000-000000000001',source:'speak_lines'});
  assert.equal(res.status,403);
  assert.equal(calls.permissions.length,1);
  assert.equal(calls.permissions[0].p_source,'speak_lines');
  assert.equal(calls.permissions[0].p_vocabulary_id,null);
  assert.equal(calls.permissions[0].p_sentence_id,'20000000-0000-4000-8000-000000000001');
});
