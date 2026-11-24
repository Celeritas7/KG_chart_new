import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceRequest,resolveContextMedia} from '../../js/kg-protected-media-context.mjs';

const WORD='10000000-0000-4000-8000-000000000001';
const SENTENCE='20000000-0000-4000-8000-000000000001';
const COLOUR='30000000-0000-4000-8000-000000000001';
const ASSET='81000000-0000-4000-8000-000000000001';
const URL='https://fakeproject.supabase.co/storage/v1/object/sign/kg-chart-private-media/protected/'+ASSET+'.mp3?token=fake';
const policy={
  state:'restricted',languages:['my'],topics:['my|food'],
  features:['chart','quiz.words','quiz.sentences']
};
const sentenceScope={state:'restricted',serverEnforced:true,groups:['food']};

test('A protected word-audio request identifies a real KG resource, not a hashed text',()=>{
 const request=sourceRequest({
   type:'word_audio',language:'my',id:WORD,topicId:'food',voice:'m'
 },policy,sentenceScope);
 assert.equal(request.sourceType,'word_audio');
 assert.equal(request.sourceId,WORD);
 assert.equal(request.topicId,null);
 assert.equal(request.language,'my');
 assert.equal(request.voice,'m');
 assert.equal(Object.hasOwn(request,'text'),false);
});
test('Private word with ungranted topic cannot request a protected asset',()=>{
 assert.equal(sourceRequest({
  type:'word_audio',language:'my',id:WORD,topicId:'friends_names',voice:'f'
 },policy,sentenceScope),null);
 assert.equal(sourceRequest({
  type:'word_image',language:'ja',id:WORD,topicId:'food'
 },policy,sentenceScope),null);
});
test('A verified mapped sentence group is required for restricted pronunciation',()=>{
 const r={type:'sentence_audio',language:'my',id:SENTENCE,groupName:'food',voice:'m'};
 assert.equal(sourceRequest(r,policy,sentenceScope)?.sourceType,'sentence_audio');
 assert.equal(sourceRequest({...r,groupName:'private_conversation'},policy,sentenceScope),null);
 assert.equal(sourceRequest(r,policy,{state:'blocked',groups:[]}),null);
 assert.equal(sourceRequest(r,policy,{state:'restricted',serverEnforced:false,groups:['food']}),null);
});
test('Word pictures require no voice and map to the exact word UUID',()=>{
 const r=sourceRequest({type:'word_image',language:'my',id:WORD,topicId:'food'},policy,sentenceScope);
 assert.equal(r.sourceType,'word_image');assert.equal(r.voice,null);
 assert.equal(r.sourceId,WORD);
});
test('Topic and colour media have independent source-ID shapes',()=>{
 const t=sourceRequest({type:'topic_audio',language:'my',topicId:'food',voice:'f'},policy,sentenceScope);
 assert.equal(t.sourceId,null);assert.equal(t.topicId,'food');
 assert.equal(sourceRequest({type:'topic_audio',language:'my',topicId:'friends_names',voice:'f'},policy,sentenceScope),null);
 assert.equal(sourceRequest({type:'colour_audio',id:COLOUR,language:'my',voice:'f'},policy,sentenceScope),null);
 const allowed={...policy,features:[...policy.features,'quiz.colours']};
 assert.equal(sourceRequest({type:'colour_audio',id:COLOUR,language:'my',voice:'f'},allowed,sentenceScope).sourceId,COLOUR);
});
test('Missing UUID, language or protected resource are denied before network',async()=>{
 const supabase={
   rpc:()=>{throw Error('An invalid client request must not invoke the RPC');},
 };
 const bad={type:'sentence_audio',language:'my',id:'hash-abcdef01',groupName:'food',voice:'m'};
 assert.equal(sourceRequest(bad,policy,sentenceScope),null);
 const result=await resolveContextMedia({resource:bad,policy,sentenceScope,supabase,projectUrl:'https://fakeproject.supabase.co'});
 assert.equal(result,null);
});
test('Authorized source requests the existing private signer and rejects public fallback',async()=>{
 const called=[];
 const supabase={
  rpc:async(name,args)=>{
   called.push({name,args});
   return {data:ASSET,error:null};
  },
  functions:{
    invoke:async(name,args)=>{
      called.push({name,args});
      return {data:{ok:true,asset_id:ASSET,url:URL,expires_in:30,content_type:'audio/mpeg'},error:null};
    }
  }
 };
 const resource={type:'word_audio',language:'my',id:WORD,topicId:'food',voice:'m'};
 const result=await resolveContextMedia({resource,policy,sentenceScope,supabase,
   projectUrl:'https://fakeproject.supabase.co'});
 assert.equal(result.url,URL);
 assert.equal(called[0].name,'kg_chart_u3b3b2_my_media_asset');
 assert.equal(called[1].name,'kg-private-media');
 assert.deepEqual(called[1].args,{body:{asset_id:ASSET}});
 const none=await resolveContextMedia({resource,policy,sentenceScope,
   supabase:{rpc:async()=>({data:null,error:null})},
   projectUrl:'https://fakeproject.supabase.co'});
 assert.equal(none,null);
});
test('Legacy request keeps resource context while not requiring U3C2 mapping',()=>{
 const r=sourceRequest({type:'sentence_audio',language:'my',id:SENTENCE,groupName:'old',voice:'f'},
   {state:'legacy'},null);
 assert.equal(r.sourceId,SENTENCE);
});
