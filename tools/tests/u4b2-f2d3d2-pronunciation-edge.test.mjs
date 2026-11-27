import test from 'node:test';
import assert from 'node:assert/strict';
import { makePronunciationCandidate } from './u4b2-f2d3d2-pronunciation-edge-candidate.mjs';
const UID='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ID='99946000-0000-4000-8000-000000000001';
const WORD='10000000-0000-4000-8000-000000000001';
const TOKEN='Bearer fictional-token';
const b=Buffer.alloc(44+16000);b.write('RIFF',0);b.write('WAVE',8);b.write('fmt ',12);
b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(16000,24);b.writeUInt16LE(16,34);
const BODY={request_id:ID,expected_revision:7,lang:'my',text:'my-food',source:'word',
  vocabulary_id:WORD,sentence_id:null,audio:b.toString('base64')};
const SCORE={score:89,accuracy:92,fluency:86,completeness:95,words:[]};
const AZ={RecognitionStatus:'Success',NBest:[{PronunciationAssessment:{
  PronScore:89,AccuracyScore:92,FluencyScore:86,CompletenessScore:95},Words:[]}]};
const error=code=>Object.assign(new Error('synthetic failure'),{code});
const ack=(status,result=null)=>({request_id:ID,status,result,used:status==='saved'?1:0,
  reserved:status==='start'||status==='pending'?1:0,limit:100});
function setup(options={}) {
  let ticket=null;
  const calls={auth:0,begin:0,finish:0,provider:0,args:[]};
  const handler=makePronunciationCandidate({
    async authenticate(header){calls.auth++;return header===TOKEN?{id:UID}:null;},
    async begin(header,args){
      calls.begin++;assert.equal(header,TOKEN);calls.args.push(args);
      if(options.beginError)throw error(options.beginError);
      if(options.beginAck)return options.beginAck;
      if(ticket){
        if(args.p_audio_sha256!==ticket.hash)throw error('23505');
        return ack(ticket.state,ticket.result);
      }
      ticket={hash:args.p_audio_sha256,state:'pending',result:null};
      return ack('start');
    },
    async assess({wav,locale,text}){
      calls.provider++;assert.equal(locale,'my-MM');assert.equal(text,'my-food');
      assert.equal(wav.length,b.length);
      if(options.providerError)throw Error('provider failed');
      if(options.providerWait)await options.providerWait;
      return options.azure??AZ;
    },
    async finish(args){
      calls.finish++;assert.equal(args.p_owner,UID);assert.equal(args.p_expected_revision,7);
      assert.equal(args.p_request_id,ID);
      if(options.finishError)throw error(options.finishError);
      ticket.state=args.p_state;ticket.result=args.p_result;
      if(options.lostReply){options.lostReply=false;throw Error('lost reply');}
      return options.finishAck??ack(ticket.state,ticket.result);
    }
  });
  return {handler,calls};
}
test('preflight failures and malformed requests never contact provider',async()=>{
  for (const code of ['42501','40001','23505','unavailable']){
    const {handler,calls}=setup({beginError:code});
    assert.equal((await handler(TOKEN,BODY)).body.ok,false);
    assert.equal(calls.provider,0);assert.equal(calls.finish,0);
  }
  const {handler,calls}=setup();
  for (const bad of [{...BODY,owner:UID},{...BODY,score:100},{...BODY,sentence_id:WORD},
    {...BODY,request_id:'bad'},{...BODY,audio:'bad'},{...BODY,lang:'toString'}]){
    assert.equal((await handler(TOKEN,bad)).status,400);
  }
  assert.equal((await handler('bad',BODY)).status,401);
  assert.equal(calls.begin,0);assert.equal(calls.provider,0);
});
test('success requires confirmed service receipt and replay never calls provider again',async()=>{
  const {handler,calls}=setup({lostReply:true});
  assert.equal((await handler(TOKEN,BODY)).body.ok,false);
  const replay=await handler(TOKEN,BODY);
  assert.deepEqual(replay.body,{ok:true,saved:true,request_id:ID,...SCORE,used:1,limit:100});
  assert.equal(calls.provider,1);assert.equal(calls.finish,1);
  assert.match(calls.args[0].p_audio_sha256,/^[0-9a-f]{64}$/);
  assert.ok(!('audio' in calls.args[0]));
  const changed=Buffer.from(b);changed[100]=1;
  assert.equal((await handler(TOKEN,{...BODY,audio:changed.toString('base64')})).status,409);
  assert.equal(calls.provider,1);
});
test('permission revoked during provider interval never returns saved success',async()=>{
  for(const code of ['40001','42501']){
    const {handler,calls}=setup({finishError:code});
    const res=await handler(TOKEN,BODY);
    assert.equal(res.body.ok,false);assert.equal(calls.provider,1);assert.equal(calls.finish,1);
    assert.equal((await handler(TOKEN,BODY)).body.reason,'pending');
    assert.equal(calls.provider,1);
  }
});
test('pending duplicate request cannot start a second provider operation',async()=>{
  let unblock;const wait=new Promise(r=>{unblock=r;});
  const {handler,calls}=setup({providerWait:wait});
  const first=handler(TOKEN,BODY);
  while(!calls.provider)await new Promise(r=>setImmediate(r));
  assert.equal((await handler(TOKEN,BODY)).body.reason,'pending');
  unblock();assert.equal((await first).body.saved,true);
  assert.equal(calls.provider,1);
});
test('unknown acknowledgements and incorrect score receipts fail closed',async()=>{
  for(const beginAck of [{...ack('start'),request_id:WORD},ack('unknown'),{...ack('start'),used:null}]){
    const {handler,calls}=setup({beginAck});
    assert.equal((await handler(TOKEN,BODY)).body.ok,false);assert.equal(calls.provider,0);
  }
  const {handler,calls}=setup({finishAck:ack('saved',{...SCORE,score:100})});
  assert.equal((await handler(TOKEN,BODY)).body.ok,false);assert.equal(calls.provider,1);
});
test('no speech, known failure and quota do not claim saved results',async()=>{
  for(const [opts,reason] of [[{azure:{RecognitionStatus:'NoMatch'}},'no_speech'],
    [{providerError:true},'assessment_failed'],[{beginAck:ack('limit')},'limit'],
    [{beginAck:ack('expired')},'expired']]){
    const {handler,calls}=setup(opts);
    assert.equal((await handler(TOKEN,BODY)).body.reason,reason);
    assert.equal(calls.provider,opts.beginAck?0:1);
    assert.equal(calls.finish,opts.beginAck?0:1);
    if(!opts.beginAck){assert.equal((await handler(TOKEN,BODY)).body.reason,reason);assert.equal(calls.provider,1);}
  }
});
